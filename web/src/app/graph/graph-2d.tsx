"use client";

import ForceGraph2D from "react-force-graph-2d";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { idOf, neighborMap, type GLink, type GNode, type RenderProps } from "./graph-types";

interface Star {
  x: number;
  y: number;
  r: number;
  base: number;
  phase: number;
  speed: number;
}

function makeStars(n: number): Star[] {
  return Array.from({ length: n }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.1 + 0.3,
    base: Math.random() * 0.5 + 0.15,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 1.2 + 0.4,
  }));
}

function phaseOf(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h % 628) / 100;
}

const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FG = any;

export function Graph2D(p: RenderProps) {
  const fg = useRef<FG>(null);
  const hovered = useRef<string | null>(null);
  const fitted = useRef(false);
  const stars = useMemo(() => makeStars(240), []);
  const neighbors = useMemo(() => neighborMap(p.data.links), [p.data]);
  const font = useMemo(() => (typeof window === "undefined" ? "system-ui" : getComputedStyle(document.body).fontFamily), []);

  // Frame the graph early; onEngineStop refits once the layout settles.
  // Capping repulsion range keeps unlinked notes near the cluster instead of drifting off-screen.
  useEffect(() => {
    fg.current?.d3Force("charge")?.distanceMax(180);
    const t = setTimeout(() => fg.current?.zoomToFit(600, 60), 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const g = fg.current;
    if (!g || !p.command) return;
    if (p.command.kind === "zoomIn") g.zoom(g.zoom() * 1.4, 400);
    if (p.command.kind === "zoomOut") g.zoom(g.zoom() / 1.4, 400);
    if (p.command.kind === "fit") g.zoomToFit(600, 60);
  }, [p.command]);

  useEffect(() => {
    const g = fg.current;
    const n = p.data.nodes.find((x) => x.id === p.selectedId);
    if (!g || !n || n.x == null || n.y == null) return;
    g.centerAt(n.x, n.y, 700);
    g.zoom(Math.max(g.zoom(), 2.4), 700);
  }, [p.selectedId, p.data]);

  const focusId = () => hovered.current ?? p.selectedId;
  const isFocusLink = (l: GLink) => {
    const f = focusId();
    return !!f && (idOf(l.source) === f || idOf(l.target) === f);
  };

  const onRenderFramePre = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const { width: W, height: H } = ctx.canvas;
      const dpr = window.devicePixelRatio || 1;
      const t = performance.now() / 1000;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // screen space: stars do not pan/zoom
      const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.7);
      g.addColorStop(0, p.dark ? "rgba(124, 58, 237, 0.16)" : "rgba(124, 58, 237, 0.06)");
      g.addColorStop(0.55, p.dark ? "rgba(8, 145, 178, 0.05)" : "rgba(8, 145, 178, 0.03)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      if (p.dark) {
        ctx.fillStyle = "#c7d2fe";
        for (const s of stars) {
          ctx.globalAlpha = p.reducedMotion ? s.base : s.base * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase));
          ctx.beginPath();
          ctx.arc(s.x * W, s.y * H, s.r * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    },
    [p.dark, p.reducedMotion, stars]
  );

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node as GNode & { x: number; y: number };
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
      const color = p.colorOf(n);
      const deg = n.link_count ?? 0;
      const now = performance.now();
      const f = focusId();
      const isFocus = n.id === f;
      const isNeighbor = !!f && !!neighbors.get(f)?.has(n.id);
      const dimFilter = !!p.highlight && !p.highlight.has(n.id);
      const dimFocus = !!f && !isFocus && !isNeighbor;
      const pulse = p.reducedMotion ? 1 : 1 + 0.07 * Math.sin(now / 650 + phaseOf(n.id));
      const age = n.__born ? (now - n.__born) / 900 : 1;
      const born = age >= 1 ? 1 : easeOutBack(Math.max(0, age));
      const r = (3 + Math.sqrt(deg) * 1.7) * pulse * (isFocus ? 1.35 : 1) * (0.45 + 0.55 * born);

      ctx.save();
      ctx.globalAlpha = dimFilter ? 0.08 : dimFocus ? 0.2 : 1;

      const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.4);
      glow.addColorStop(0, color + (isFocus ? "aa" : "4d"));
      glow.addColorStop(1, color + "00");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 3.4, 0, Math.PI * 2);
      ctx.fill();

      if (age < 1.6 && n.__born && !p.reducedMotion) {
        const ring = Math.min(1, age / 1.6);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1 - ring;
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * (1 + ring * 5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = dimFilter ? 0.08 : dimFocus ? 0.2 : 1;
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(n.x - r * 0.3, n.y - r * 0.3, r * 0.32, 0, Math.PI * 2);
      ctx.fill();

      // Labels scale in with zoom: hubs first, everything only when zoomed in close.
      const showLabel = isFocus || isNeighbor || !!p.highlight?.has(n.id) || scale > 3 || (deg >= 10 && scale > 1.6);
      if (showLabel && !dimFilter) {
        const fs = 12 / scale; // constant 12px on screen
        ctx.font = `${isFocus ? 600 : 500} ${fs}px ${font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = !isFocus && n.title.length > 28 ? n.title.slice(0, 26) + "…" : n.title;
        const y = n.y + r + 4 / scale;
        ctx.lineWidth = 3 / scale;
        ctx.strokeStyle = p.dark ? "rgba(7,6,15,0.85)" : "rgba(255,255,255,0.9)";
        ctx.strokeText(label, n.x, y);
        ctx.fillStyle = isFocus ? (p.dark ? "#ffffff" : "#4c1d95") : p.dark ? "rgba(226,232,240,0.9)" : "#1e293b";
        ctx.fillText(label, n.x, y);
      }
      ctx.restore();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.colorOf, p.highlight, p.selectedId, p.dark, p.reducedMotion, neighbors, font]
  );

  return (
    <ForceGraph2D
      ref={fg}
      width={p.width}
      height={p.height}
      graphData={p.data}
      backgroundColor="rgba(0,0,0,0)"
      autoPauseRedraw={false}
      onRenderFramePre={onRenderFramePre}
      nodeCanvasObject={nodeCanvasObject}
      nodePointerAreaPaint={(node, color, ctx) => {
        const n = node as GNode & { x: number; y: number };
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 3 + Math.sqrt(n.link_count ?? 0) * 1.7 + 3, 0, Math.PI * 2);
        ctx.fill();
      }}
      linkColor={(l) =>
        isFocusLink(l as GLink)
          ? p.dark
            ? "rgba(196,181,253,0.9)"
            : "rgba(109,40,217,0.75)"
          : p.dark
            ? "rgba(148,163,184,0.13)"
            : "rgba(71,85,105,0.16)"
      }
      linkWidth={(l) => (isFocusLink(l as GLink) ? 1.6 : 0.6)}
      linkDirectionalParticles={p.reducedMotion ? 0 : 1}
      linkDirectionalParticleSpeed={0.0055}
      linkDirectionalParticleWidth={1.6}
      linkDirectionalParticleColor={(l) => {
        const s = (l as GLink).source;
        return typeof s === "object" ? p.colorOf(s) : "#a78bfa";
      }}
      onNodeHover={(node) => {
        hovered.current = (node as GNode | null)?.id ?? null;
        const canvas = document.querySelector<HTMLElement>(".force-graph-container canvas");
        if (canvas) canvas.style.cursor = node ? "pointer" : "grab";
      }}
      onNodeClick={(node) => p.onSelect(node as GNode)}
      onBackgroundClick={() => p.onSelect(null)}
      cooldownTicks={140}
      d3VelocityDecay={0.3}
      onEngineStop={() => {
        if (!fitted.current) {
          fitted.current = true;
          fg.current?.zoomToFit(600, 60);
        }
      }}
    />
  );
}
