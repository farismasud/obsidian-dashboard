"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Eye, Maximize2, Palette, Search, Sparkles, Square, X, ZoomIn, ZoomOut } from "lucide-react";
import { api, type GraphData, type GraphifyInfo } from "@/lib/api";
import { useVaultEvents } from "@/hooks/use-vault-events";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { folderColor, normPath, paletteColor, topFolder } from "./graph-colors";
import type { GGraph, GNode, GraphCommand, RenderProps } from "./graph-types";
import { NotePanel } from "./note-panel";

const Graph2D = dynamic(() => import("./graph-2d").then((m) => m.Graph2D), { ssr: false });
const Graph3D = dynamic(() => import("./graph-3d").then((m) => m.Graph3D), { ssr: false });

type Mode = "2d" | "3d";
type Scope = "all" | "core";
type ColorBy = "folder" | "community";

const isGraphify = (n: { folder: string }) => normPath(n.folder).startsWith("graphify-out");

function useStored<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      if (s && allowed.includes(s)) setValue(s);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {}
    },
    [key]
  );
  return [value, set] as const;
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: React.ElementType }[];
}) {
  return (
    <div className="flex items-center rounded-xl border border-border bg-card/70 p-1 text-xs backdrop-blur-md">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors ${
            value === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon size={13} />
          {label}
        </button>
      ))}
    </div>
  );
}

export function GraphExplorer({ initialData, initialGraphify }: { initialData: GraphData; initialGraphify: GraphifyInfo }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const reducedMotion = useReducedMotion();

  const [mode, setMode] = useStored<Mode>("graph.mode", "3d", ["2d", "3d"]);
  const [colorByPref, setColorBy] = useStored<ColorBy>("graph.colorBy", "folder", ["folder", "community"]);
  const [scope, setScope] = useState<Scope>("all");
  const [full, setFull] = useState<GraphData>(initialData);
  const [graphify, setGraphify] = useState<GraphifyInfo>(initialGraphify);
  const [query, setQuery] = useState("");
  const [legendPick, setLegendPick] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [command, setCommand] = useState<GraphCommand>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const nodeCache = useRef(new Map<string, GNode>());
  const bornAt = useRef(new Map<string, number>());

  const colorBy: ColorBy = graphify.available ? colorByPref : "folder";

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const update = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useVaultEvents(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      try {
        const [g, gi] = await Promise.all([api.graph(), api.graphify().catch(() => null)]);
        const now = performance.now();
        for (const n of g.nodes) if (!nodeCache.current.has(n.id)) bornAt.current.set(n.id, now);
        if (gi) setGraphify(gi);
        setFull(g);
      } catch {}
    }, 500);
  });

  // Keep node objects stable across refreshes so the simulation keeps positions.
  const data = useMemo<GGraph>(() => {
    const nodes: GNode[] = [];
    for (const n of full.nodes) {
      if (scope === "core" && isGraphify(n)) continue;
      let g = nodeCache.current.get(n.id);
      if (!g) {
        g = { ...n };
        nodeCache.current.set(n.id, g);
      } else {
        g.title = n.title;
        g.folder = n.folder;
        g.group = n.group;
        g.link_count = n.link_count;
      }
      g.__born = bornAt.current.get(n.id);
      nodes.push(g);
    }
    const ids = new Set(nodes.map((n) => n.id));
    const links = full.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ source: l.source, target: l.target }));
    return { nodes, links };
  }, [full, scope]);

  const counts = useMemo(() => ({ all: full.nodes.length, core: full.nodes.filter((n) => !isGraphify(n)).length }), [full]);

  const legendKey = useCallback(
    (n: GNode) => (colorBy === "community" ? graphify.communities[normPath(n.id)]?.label ?? "Unclustered" : topFolder(n.folder)),
    [colorBy, graphify]
  );

  const colorOf = useCallback(
    (n: GNode) => {
      if (colorBy === "community") {
        const c = graphify.communities[normPath(n.id)];
        return c ? paletteColor(c.id) : "#475569";
      }
      return folderColor(n.folder);
    },
    [colorBy, graphify]
  );

  const legend = useMemo(() => {
    const m = new Map<string, { color: string; count: number }>();
    for (const n of data.nodes) {
      const k = legendKey(n);
      const e = m.get(k);
      if (e) e.count++;
      else m.set(k, { color: colorOf(n), count: 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [data, legendKey, colorOf]);

  const highlight = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !legendPick) return null;
    const s = new Set<string>();
    for (const n of data.nodes) {
      if (q && !n.title.toLowerCase().includes(q)) continue;
      if (legendPick && legendKey(n) !== legendPick) continue;
      s.add(n.id);
    }
    return s;
  }, [data, query, legendPick, legendKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cmd = (kind: NonNullable<GraphCommand>["kind"]) => setCommand((c) => ({ kind, seq: (c?.seq ?? 0) + 1 }));

  const props: RenderProps = {
    data,
    width: dims.w,
    height: dims.h,
    colorOf,
    highlight,
    selectedId: selected?.id ?? null,
    onSelect: setSelected,
    command,
    dark,
    reducedMotion,
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <h1 className="text-sm font-semibold">Graph Galaxy</h1>
        <span className="text-xs tabular-nums text-muted-foreground">
          {data.nodes.length} notes · {data.links.length} links
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "2d", label: "2D", icon: Square },
              { value: "3d", label: "3D", icon: Box },
            ]}
          />
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: `All ${counts.all}`, icon: Sparkles },
              { value: "core", label: `Core ${counts.core}`, icon: Eye },
            ]}
          />
          {graphify.available && (
            <Segmented
              value={colorBy}
              onChange={(v) => {
                setColorBy(v);
                setLegendPick(null);
              }}
              options={[
                { value: "folder", label: "Folder", icon: Palette },
                { value: "community", label: "Community", icon: Sparkles },
              ]}
            />
          )}
        </div>
      </header>

      <div
        ref={stage}
        className="relative flex-1 overflow-hidden"
        style={{ background: dark ? "radial-gradient(ellipse at 50% 40%, #120d26 0%, #07060f 70%)" : "radial-gradient(ellipse at 50% 40%, #ffffff 0%, #f1f0f7 75%)" }}
      >
        {dims.w > 0 && dims.h > 0 && (mode === "3d" ? <Graph3D {...props} /> : <Graph2D {...props} />)}

        <div className="absolute left-4 top-4 z-20 flex w-72 items-center gap-2 rounded-xl border border-border bg-card/75 px-3 py-2 shadow-lg backdrop-blur-md">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a note in the graph…"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
              <X size={13} />
            </button>
          )}
        </div>

        {!selected && legend.length > 0 && (
          <div className="absolute bottom-4 left-4 z-20 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-card/75 p-2 shadow-lg backdrop-blur-md">
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {colorBy === "community" ? "Communities" : "Folders"}
            </p>
            {legend.map(([key, { color, count }]) => {
              const on = legendPick === key;
              return (
                <button
                  key={key}
                  onClick={() => setLegendPick(on ? null : key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors ${
                    on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                  <span className="flex-1 truncate text-left">{key === "root" ? "vault" : key}</span>
                  <span className="tabular-nums text-[10px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="absolute bottom-4 z-20 flex flex-col gap-1 rounded-xl border border-border bg-card/75 p-1 shadow-lg backdrop-blur-md" style={{ right: selected ? 412 : 16 }}>
          {[
            { k: "zoomIn" as const, icon: ZoomIn, label: "Zoom in" },
            { k: "zoomOut" as const, icon: ZoomOut, label: "Zoom out" },
            { k: "fit" as const, icon: Maximize2, label: "Fit" },
          ].map(({ k, icon: Icon, label }) => (
            <button key={k} onClick={() => cmd(k)} title={label} aria-label={label} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Icon size={15} />
            </button>
          ))}
        </div>

        {data.nodes.length < 5 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 text-center text-xs text-muted-foreground">
            The vault is still small — agents add notes to <code className="font-mono text-primary">Research/</code>; link them with{" "}
            <code className="font-mono text-primary">[[wikilinks]]</code> to grow the galaxy.
          </div>
        )}

        {selected && <NotePanel key={selected.id} node={selected} color={colorOf(selected)} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
