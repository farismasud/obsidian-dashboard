"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "@/lib/api";
import { Search, ZoomIn, ZoomOut, RotateCcw, Filter, Eye, Sparkles } from "lucide-react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const FOLDER_COLORS: Record<string, string> = {
  Projects:     "#8b5cf6",
  Knowledge:    "#06b6d4",
  Orchestrator: "#f43f5e",
  Journal:      "#f59e0b",
  Claude:       "#10b981",
  Gemini:       "#3b82f6",
  Antigravity:  "#fb7185",
  Hermes:       "#ec4899",
  "graphify-out": "#64748b",
  root:         "#94a3b8",
};

function folderColor(folder: string): string {
  const top = folder.split("/")[0];
  return FOLDER_COLORS[top] ?? "#64748b";
}

interface Star { x: number; y: number; r: number; a: number; twinkle: number }

function makeStars(count: number, w: number, h: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: Math.random() * 1.2 + 0.2,
    a: Math.random() * 0.4 + 0.1,
    twinkle: Math.random() * Math.PI * 2,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FGRef = any;

export function GraphView({ initialData }: { initialData: GraphData }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  const fgRef = useRef<FGRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [graphMode, setGraphMode] = useState<"all" | "core">("all");
  const [data, setData] = useState<GraphData>(initialData);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 900, h: 600 });

  // Fetch data on mode change
  useEffect(() => {
    let active = true;
    async function fetchFiltered() {
      setLoading(true);
      try {
        const res = await fetch(`http://localhost:8080/api/graph${graphMode === "core" ? "?filter=core" : ""}`);
        const json = await res.json();
        if (active) setData(json);
      } catch (err) {
        console.error("fetch graph error:", err);
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchFiltered();
    return () => { active = false; };
  }, [graphMode]);

  // Window resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stars = useMemo(() => makeStars(160, dims.w, dims.h), [dims]);

  const onRenderFramePre = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      const bg = dark ? "#0a0c10" : "#f8fafc";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, dims.w, dims.h);

      if (dark) {
        // Deep background nebula
        const grad = ctx.createRadialGradient(dims.w / 2, dims.h / 2, 80, dims.w / 2, dims.h / 2, dims.w * 0.7);
        grad.addColorStop(0, "rgba(20, 26, 45, 0.45)");
        grad.addColorStop(0.6, "rgba(10, 12, 16, 0.85)");
        grad.addColorStop(1, "#0a0c10");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, dims.w, dims.h);

        // Constellation stars
        for (const s of stars) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(180, 210, 255, ${s.a * 0.8})`;
          ctx.fill();
        }
      }
      ctx.restore();
    },
    [dark, dims, stars]
  );

  // Filter nodes matching search or folder
  const searchMatchedIds = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    const set = new Set<string>();
    for (const n of data.nodes) {
      if (n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
        set.add(n.id);
      }
    }
    return set;
  }, [data.nodes, searchQuery]);

  // Constellation links
  const linkCanvasObject = useCallback(
    (link: object, ctx: CanvasRenderingContext2D) => {
      const l = link as {
        source: { x: number; y: number; id: string };
        target: { x: number; y: number; id: string };
      };
      if (!l.source || !l.target) return;
      const { x: sx, y: sy } = l.source;
      const { x: tx, y: ty } = l.target;
      if (!isFinite(sx) || !isFinite(sy) || !isFinite(tx) || !isFinite(ty)) return;

      const isConnectedToHover = hoveredNode && (l.source.id === hoveredNode.id || l.target.id === hoveredNode.id);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);

      if (isConnectedToHover) {
        ctx.strokeStyle = dark ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.8)";
        ctx.lineWidth = 2.0;
        ctx.shadowBlur = 8;
        ctx.shadowColor = dark ? "#38bdf8" : "#0284c7";
        ctx.stroke();
      } else if (dark) {
        ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(100, 116, 139, 0.22)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.restore();
    },
    [dark, hoveredNode]
  );

  // Nodes render
  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode & { x: number; y: number; link_count?: number };
      if (!isFinite(n.x) || !isFinite(n.y)) return;

      const color = folderColor(n.folder);
      const isHovered = hoveredNode?.id === n.id;
      const isSearchHit = searchMatchedIds?.has(n.id);
      const isDimmed = (searchMatchedIds && !isSearchHit) || (selectedFolder && !n.folder.startsWith(selectedFolder));

      // Radius scales slightly with connectivity degree
      const degree = n.link_count ?? 1;
      const baseR = Math.min(10, Math.max(3.5, Math.log2(degree + 1) * 2.2));
      const r = isHovered ? baseR * 1.5 : isSearchHit ? baseR * 1.3 : baseR;

      ctx.save();
      if (isDimmed) {
        ctx.globalAlpha = 0.15;
      }

      // Outer glow
      if (dark && (isHovered || isSearchHit || degree > 8)) {
        const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
        glow.addColorStop(0, color + "60");
        glow.addColorStop(1, color + "00");
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Core
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isHovered || isSearchHit ? "#ffffff" : color;
      ctx.shadowBlur = isHovered ? 12 : 4;
      ctx.shadowColor = color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Smart label rendering: avoid clutter
      const isHighDegree = degree >= 10;
      const showLabel = isHovered || isSearchHit || (globalScale > 1.8 && degree > 2) || (globalScale > 3.0);

      if (showLabel) {
        const fontSize = Math.max(9, Math.min(13, 11 / globalScale));
        ctx.font = `${isHovered || isSearchHit ? "600 " : ""}${fontSize}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const title = n.title || n.id.replace(/\.md$/, "");
        const label = isHovered ? title : title.length > 22 ? title.slice(0, 20) + "…" : title;

        ctx.fillStyle = dark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.9)";
        ctx.fillText(label, n.x + 0.5, n.y + r + 3.5);

        ctx.fillStyle = isHovered || isSearchHit ? (dark ? "#38bdf8" : "#0284c7") : (dark ? "#e2e8f0" : "#1e293b");
        ctx.fillText(label, n.x, n.y + r + 3);
      }

      ctx.restore();
    },
    [dark, hoveredNode, searchMatchedIds, selectedFolder]
  );

  const legendFolders = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of data.nodes) {
      const top = n.folder.split("/")[0];
      counts[top] = (counts[top] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [data.nodes]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none bg-background">
      {/* Top Controls Bar */}
      <div className="absolute top-4 left-6 right-6 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Left: Search input */}
        <div className="pointer-events-auto flex items-center gap-2 bg-card/85 backdrop-blur-md border border-border/70 rounded-xl px-3 py-1.5 shadow-lg w-72">
          <Search size={15} className="text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Cari note di canvas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground w-full"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-xs text-muted-foreground hover:text-foreground">
              ✕
            </button>
          )}
        </div>

        {/* Right: Switch Mode & Zoom Controls */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Mode Switch: Core Notes vs Full Galaxy */}
          <div className="flex items-center bg-card/85 backdrop-blur-md border border-border/70 rounded-xl p-1 shadow-lg text-xs">
            <button
              onClick={() => setGraphMode("all")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all ${
                graphMode === "all"
                  ? "bg-primary text-primary-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles size={13} />
              Full Galaxy ({data.nodes.length})
            </button>
            <button
              onClick={() => setGraphMode("core")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all ${
                graphMode === "core"
                  ? "bg-primary text-primary-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye size={13} />
              Core Notes (36)
            </button>
          </div>

          {/* Quick Zoom Actions */}
          <div className="flex items-center bg-card/85 backdrop-blur-md border border-border/70 rounded-xl p-1 shadow-lg">
            <button
              onClick={() => fgRef.current?.zoom(fgRef.current.zoom() * 1.3, 300)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Zoom In"
            >
              <ZoomIn size={15} />
            </button>
            <button
              onClick={() => fgRef.current?.zoom(fgRef.current.zoom() * 0.7, 300)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Zoom Out"
            >
              <ZoomOut size={15} />
            </button>
            <button
              onClick={() => fgRef.current?.zoomToFit(400, 50)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Fit View"
            >
              <RotateCcw size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Force Graph Canvas */}
      <ForceGraph2D
        ref={fgRef}
        width={dims.w}
        height={dims.h}
        graphData={data}
        backgroundColor="transparent"
        onRenderFramePre={onRenderFramePre}
        linkCanvasObject={linkCanvasObject}
        linkCanvasObjectMode={() => "replace"}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as { x: number; y: number };
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 8, 0, Math.PI * 2);
          ctx.fill();
        }}
        onNodeHover={(node) => setHoveredNode(node as GraphNode | null)}
        onNodeClick={(node) => {
          router.push(`/knowledge?note=${encodeURIComponent((node as GraphNode).id)}`);
        }}
        warmupTicks={80}
        cooldownTicks={180}
        d3AlphaDecay={0.025}
        d3VelocityDecay={0.35}
        onEngineStop={() => fgRef.current?.zoomToFit(400, 60)}
      />

      {/* Top Right Legend with interactive folder filter */}
      <div className="absolute top-16 right-6 bg-card/85 backdrop-blur-md border border-border/70 rounded-xl p-3 shadow-xl max-h-72 overflow-y-auto w-52 z-20">
        <div className="flex items-center justify-between mb-2 pb-1 border-b border-border/50">
          <span className="text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">Filter Folder</span>
          {selectedFolder && (
            <button
              onClick={() => setSelectedFolder(null)}
              className="text-[10px] text-primary hover:underline"
            >
              Reset
            </button>
          )}
        </div>
        <div className="space-y-1">
          {legendFolders.map(([folder, count]) => {
            const active = selectedFolder === folder;
            return (
              <button
                key={folder}
                onClick={() => setSelectedFolder(active ? null : folder)}
                className={`w-full flex items-center justify-between px-2 py-1 rounded-lg text-xs transition-all ${
                  active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: folderColor(folder) }}
                  />
                  <span className="truncate capitalize">{folder === "root" ? "Vault Root" : folder}</span>
                </div>
                <span className="text-[10px] text-muted-foreground/80 ml-1">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hover Info Tooltip */}
      {hoveredNode && (
        <div className="absolute bottom-6 left-6 bg-card/90 backdrop-blur-md border border-border/80 rounded-xl px-4 py-3 text-xs shadow-2xl pointer-events-none max-w-sm z-30 animate-in fade-in duration-150">
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: folderColor(hoveredNode.folder),
                boxShadow: `0 0 8px ${folderColor(hoveredNode.folder)}`,
              }}
            />
            <span className="font-semibold text-foreground text-sm truncate">{hoveredNode.title}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-1.5 capitalize">
            Folder: {hoveredNode.folder === "root" ? "Vault Root" : hoveredNode.folder}
          </p>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/90 border-t border-border/50 pt-1.5">
            <span>Koneksi: {(hoveredNode as any).link_count ?? 0} link</span>
            <span className="text-primary font-medium">Klik untuk buka note →</span>
          </div>
        </div>
      )}

      {/* Bottom Right Navigation Helper */}
      <div className="absolute bottom-4 right-6 text-[11px] text-muted-foreground/60 pointer-events-none bg-background/50 backdrop-blur-sm px-2.5 py-1 rounded-md">
        Scroll: zoom · Drag: pan · Klik node: buka catatan
      </div>
    </div>
  );
}
