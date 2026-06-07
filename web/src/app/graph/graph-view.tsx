"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "@/lib/api";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const FOLDER_COLORS: Record<string, string> = {
  Projects:    "#a78bfa",
  Knowledge:   "#22d3ee",
  Journal:     "#fbbf24",
  Claude:      "#34d399",
  Gemini:      "#60a5fa",
  Antigravity: "#fb7185",
  Inbox:       "#94a3b8",
  root:        "#64748b",
};

function folderColor(folder: string): string {
  const top = folder.split("/")[0];
  return FOLDER_COLORS[top] ?? "#94a3b8";
}

interface Star { x: number; y: number; r: number; a: number; twinkle: number }

function makeStars(count: number, w: number, h: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: Math.random() * 1.4 + 0.2,
    a: Math.random() * 0.55 + 0.1,
    twinkle: Math.random() * Math.PI * 2,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FGRef = any;

export function GraphView({ data }: { data: GraphData }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FGRef>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const starsRef = useRef<Star[]>([]);
  const frameRef = useRef(0);

  // Generate stars on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        setDims({ w, h });
        starsRef.current = makeStars(220, w, h);
      }
    });
    ro.observe(el);
    const w = el.clientWidth, h = el.clientHeight;
    setDims({ w, h });
    starsRef.current = makeStars(220, w, h);
    return () => ro.disconnect();
  }, []);

  // Tune d3 forces after mount
  useEffect(() => {
    if (!fgRef.current) return;
    const fg = fgRef.current;
    fg.d3Force("charge")?.strength(-60);
    fg.d3Force("link")?.distance(35).strength(1);
    fg.d3Force("center")?.strength(0.4);
  }, [data]);

  // Starfield drawn pre-frame in screen space
  const onRenderFramePre = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      frameRef.current += 0.012;
      const t = frameRef.current;

      // Save graph transform, switch to screen coords
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Background
      if (dark) {
        const bg = ctx.createRadialGradient(
          dims.w * 0.5, dims.h * 0.45, 0,
          dims.w * 0.5, dims.h * 0.5, Math.max(dims.w, dims.h) * 0.75
        );
        bg.addColorStop(0, "#0d1a2e");
        bg.addColorStop(0.5, "#07101e");
        bg.addColorStop(1, "#030810");
        ctx.fillStyle = bg;
      } else {
        ctx.fillStyle = "#f0f5ff";
      }
      ctx.fillRect(0, 0, dims.w, dims.h);

      // Stars (dark only)
      if (dark) {
        for (const star of starsRef.current) {
          const alpha = star.a * (0.6 + 0.4 * Math.sin(t + star.twinkle));
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(210,230,255,${alpha.toFixed(2)})`;
          ctx.shadowBlur = star.r * 4;
          ctx.shadowColor = "rgba(160,200,255,0.7)";
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    },
    [dark, dims]
  );

  // Glowing constellation links
  const linkCanvasObject = useCallback(
    (link: object, ctx: CanvasRenderingContext2D) => {
      const l = link as {
        source: { x: number; y: number };
        target: { x: number; y: number };
      };
      if (!l.source || !l.target) return;
      const { x: sx, y: sy } = l.source;
      const { x: tx, y: ty } = l.target;
      if (!isFinite(sx) || !isFinite(sy) || !isFinite(tx) || !isFinite(ty)) return;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);

      if (dark) {
        // Glow pass
        ctx.strokeStyle = "rgba(148,180,255,0.18)";
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(148,180,255,0.5)";
        ctx.stroke();
        // Core line
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = "rgba(200,220,255,0.45)";
        ctx.lineWidth = 0.7;
        ctx.shadowBlur = 0;
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(30,50,100,0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    },
    [dark]
  );

  // Glowing star nodes
  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode & { x: number; y: number };
      if (!isFinite(n.x) || !isFinite(n.y)) return;
      const color = folderColor(n.folder);
      const isHovered = hoveredNode?.id === n.id;
      const r = isHovered ? 8 : 5;

      ctx.save();

      if (dark) {
        // Outer nebula glow
        const outer = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.5);
        outer.addColorStop(0, color + "40");
        outer.addColorStop(1, color + "00");
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 3.5, 0, Math.PI * 2);
        ctx.fillStyle = outer;
        ctx.fill();

        // Corona
        ctx.shadowBlur = 16;
        ctx.shadowColor = color;
      }

      // Core
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      const core = ctx.createRadialGradient(n.x - r * 0.25, n.y - r * 0.25, 0, n.x, n.y, r);
      core.addColorStop(0, "#ffffff");
      core.addColorStop(0.35, color);
      core.addColorStop(1, color + (dark ? "cc" : "99"));
      ctx.fillStyle = core;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Hover ring
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = color + "88";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Label
      const fontSize = Math.max(8.5, 10.5 / globalScale);
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = n.title.length > 18 ? n.title.slice(0, 16) + "…" : n.title;

      if (dark) {
        // subtle text shadow for readability
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillText(label, n.x + 0.5, n.y + r + 3.5);
        ctx.fillStyle = "rgba(220,235,255,0.85)";
        ctx.fillText(label, n.x, n.y + r + 3);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillText(label, n.x + 0.5, n.y + r + 3.5);
        ctx.fillStyle = "rgba(15,23,42,0.85)";
        ctx.fillText(label, n.x, n.y + r + 3);
      }

      ctx.restore();
    },
    [dark, hoveredNode]
  );

  const legendEntries = useMemo(
    () => Object.entries(FOLDER_COLORS).filter(([f]) =>
      data.nodes.some((n) => n.folder.startsWith(f))
    ),
    [data.nodes]
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ background: dark ? "#030810" : "#f0f5ff" }}
    >
      {data.nodes.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground text-sm">No connected notes in vault</p>
        </div>
      ) : (
        <>
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
              ctx.arc(n.x, n.y, 10, 0, Math.PI * 2);
              ctx.fill();
            }}
            onNodeHover={(node) => setHoveredNode(node as GraphNode | null)}
            onNodeClick={(node) => {
              router.push(`/knowledge?note=${encodeURIComponent((node as GraphNode).id)}`);
            }}
            warmupTicks={120}
            cooldownTicks={300}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.35}
            onEngineStop={() => fgRef.current?.zoomToFit(400, 60)}
          />

          {/* Hover tooltip */}
          {hoveredNode && (
            <div className="absolute bottom-6 left-6 bg-card/90 backdrop-blur-sm border border-border rounded-xl px-3.5 py-2.5 text-xs shadow-xl pointer-events-none">
              <div
                className="w-2 h-2 rounded-full mb-1.5"
                style={{
                  background: folderColor(hoveredNode.folder),
                  boxShadow: `0 0 6px ${folderColor(hoveredNode.folder)}`,
                }}
              />
              <p className="font-semibold">{hoveredNode.title}</p>
              <p className="text-muted-foreground capitalize mt-0.5">
                {hoveredNode.folder === "root" ? "vault" : hoveredNode.folder}
              </p>
              <p className="text-muted-foreground/60 mt-0.5">Click to open note</p>
            </div>
          )}

          {/* Legend — only folders present in data */}
          <div className="absolute top-4 right-4 bg-card/75 backdrop-blur-sm border border-border/60 rounded-xl p-3 text-xs space-y-2">
            <p className="text-muted-foreground/60 font-medium mb-1 uppercase tracking-wider text-[10px]">
              Folders
            </p>
            {legendEntries.map(([folder, color]) => (
              <div key={folder} className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: color, boxShadow: `0 0 5px ${color}` }}
                />
                <span className="text-muted-foreground">{folder}</span>
              </div>
            ))}
          </div>

          {/* Tip */}
          <p className="absolute bottom-4 right-4 text-[11px] text-muted-foreground/40 pointer-events-none">
            scroll to zoom · drag to pan · click node to open
          </p>
        </>
      )}
    </div>
  );
}
