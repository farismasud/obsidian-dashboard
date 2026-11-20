"use client";

import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { mix } from "./graph-colors";
import { idOf, neighborMap, type GLink, type GNode, type RenderProps } from "./graph-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FG = any;

function makeStarfield(dark: boolean) {
  const count = 1800;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 1400 + Math.random() * 1400;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: dark ? 0xc7d2fe : 0x7c3aed, size: 2.2, transparent: true, opacity: dark ? 0.75 : 0.25, depthWrite: false });
  return new THREE.Points(geo, mat);
}

// Glow = additive sprite per node. (UnrealBloomPass washes out the alpha canvas react-force-graph uses.)
let glowTexture: THREE.Texture | null = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.55)");
  g.addColorStop(0.5, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

const glowMaterials = new Map<string, THREE.SpriteMaterial>();
function glowMaterial(color: string, dark: boolean) {
  const key = `${color}|${dark}`;
  let m = glowMaterials.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color,
      transparent: true,
      opacity: dark ? 0.9 : 0.45,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    });
    glowMaterials.set(key, m);
  }
  return m;
}

const REL_SIZE = 4;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function Graph3D(p: RenderProps) {
  const fg = useRef<FG>(null);
  const fitted = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const neighbors = useMemo(() => neighborMap(p.data.links), [p.data]);
  const bg = p.dark ? "#07060f" : "#f4f3fa";

  // Scene setup: fog, starfield, auto-rotate that pauses while the user interacts.
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    const scene = g.scene();
    scene.fog = new THREE.FogExp2(new THREE.Color(bg).getHex(), p.dark ? 0.0011 : 0.0007);
    const stars = makeStarfield(p.dark);
    scene.add(stars);

    const controls = g.controls();
    controls.autoRotate = !p.reducedMotion;
    controls.autoRotateSpeed = 0.55;
    let resume: ReturnType<typeof setTimeout> | undefined;
    const pause = () => {
      controls.autoRotate = false;
      clearTimeout(resume);
      if (!p.reducedMotion) resume = setTimeout(() => (controls.autoRotate = true), 8000);
    };
    controls.addEventListener("start", pause);
    return () => {
      controls.removeEventListener("start", pause);
      clearTimeout(resume);
      scene.remove(stars);
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.dark, p.reducedMotion]);

  // Frame the graph early; onEngineStop refits once the layout settles.
  // Capping repulsion range keeps unlinked notes near the cluster instead of drifting off-screen.
  useEffect(() => {
    fg.current?.d3Force("charge")?.distanceMax(220);
    const t = setTimeout(() => fg.current?.zoomToFit(800, 40), 1800);
    return () => clearTimeout(t);
  }, []);

  // Re-render once newborn highlights expire.
  useEffect(() => {
    if (!p.data.nodes.some((n) => n.__born)) return;
    const t = setTimeout(() => setTick((x) => x + 1), 3000);
    return () => clearTimeout(t);
  }, [p.data]);

  useEffect(() => {
    const g = fg.current;
    if (!g || !p.command) return;
    if (p.command.kind === "fit") {
      g.zoomToFit(800, 40);
      return;
    }
    const cam = g.camera().position;
    const k = p.command.kind === "zoomIn" ? 0.7 : 1.4;
    g.cameraPosition({ x: cam.x * k, y: cam.y * k, z: cam.z * k }, undefined, 500);
  }, [p.command]);

  useEffect(() => {
    const g = fg.current;
    const n = p.data.nodes.find((x) => x.id === p.selectedId);
    if (!g || !n || n.x == null || n.y == null || n.z == null) return;
    const dist = 110;
    const len = Math.hypot(n.x, n.y, n.z) || 1;
    const k = 1 + dist / len;
    g.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, { x: n.x, y: n.y, z: n.z }, 1200);
  }, [p.selectedId, p.data]);

  const focus = hovered ?? p.selectedId;
  const isFocusLink = (l: GLink) => !!focus && (idOf(l.source) === focus || idOf(l.target) === focus);
  const now = typeof performance !== "undefined" ? performance.now() : 0;

  const valOf = (g: GNode) => {
    const fresh = g.__born && now - g.__born < 3000 ? 2.5 : 1;
    return (1 + (g.link_count ?? 0) * 0.7) * fresh * (g.id === focus ? 1.8 : 1);
  };
  const colorFor = (g: GNode) => {
    if (g.__born && now - g.__born < 3000) return "#ffffff";
    const c = p.colorOf(g);
    const dimFilter = !!p.highlight && !p.highlight.has(g.id);
    const dimFocus = !!focus && g.id !== focus && !neighbors.get(focus)?.has(g.id);
    return dimFilter ? mix(c, bg, 0.85) : dimFocus ? mix(c, bg, 0.65) : c;
  };

  return (
    <ForceGraph3D
      ref={fg}
      width={p.width}
      height={p.height}
      graphData={p.data}
      backgroundColor={bg}
      controlType="orbit"
      showNavInfo={false}
      nodeRelSize={REL_SIZE}
      nodeResolution={16}
      nodeOpacity={0.95}
      nodeVal={(n) => valOf(n as GNode)}
      nodeColor={(n) => colorFor(n as GNode)}
      nodeThreeObjectExtend
      nodeThreeObject={(n) => {
        const g = n as GNode;
        const sprite = new THREE.Sprite(glowMaterial(colorFor(g), p.dark));
        const r = Math.cbrt(valOf(g)) * REL_SIZE;
        sprite.scale.set(r * 7, r * 7, 1);
        return sprite;
      }}
      nodeLabel={(n) => `<div class="graph-tip">${escapeHtml((n as GNode).title)}</div>`}
      linkColor={(l) => (isFocusLink(l as GLink) ? (p.dark ? "#c4b5fd" : "#6d28d9") : p.dark ? "#475569" : "#a8a3c4")}
      linkOpacity={0.28}
      linkWidth={(l) => (isFocusLink(l as GLink) ? 1.2 : 0)}
      linkDirectionalParticles={p.reducedMotion ? 0 : 2}
      linkDirectionalParticleSpeed={0.005}
      linkDirectionalParticleWidth={1.5}
      linkDirectionalParticleColor={(l) => {
        const s = (l as GLink).source;
        return typeof s === "object" ? p.colorOf(s) : "#a78bfa";
      }}
      onNodeHover={(n) => setHovered((n as GNode | null)?.id ?? null)}
      onNodeClick={(n) => p.onSelect(n as GNode)}
      onBackgroundClick={() => p.onSelect(null)}
      cooldownTicks={160}
      onEngineStop={() => {
        if (!fitted.current) {
          fitted.current = true;
          fg.current?.zoomToFit(800, 40);
        }
      }}
    />
  );
}
