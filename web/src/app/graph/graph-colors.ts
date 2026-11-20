export const FOLDER_COLORS: Record<string, string> = {
  Research: "#a78bfa",
  Projects: "#8b5cf6",
  Knowledge: "#22d3ee",
  Sessions: "#f59e0b",
  Journal: "#fbbf24",
  Claude: "#34d399",
  Agents: "#f472b6",
  Gemini: "#60a5fa",
  Antigravity: "#fb7185",
  Hermes: "#ec4899",
  "graphify-out": "#64748b",
  root: "#cbd5e1",
  vault: "#cbd5e1",
};

const PALETTE = ["#a78bfa", "#22d3ee", "#f472b6", "#34d399", "#fbbf24", "#60a5fa", "#fb7185", "#c084fc", "#2dd4bf", "#f97316"];

export const normPath = (p: string) => p.replaceAll("\\", "/");
export const topFolder = (folder: string) => normPath(folder).split("/")[0];

export function paletteColor(i: number) {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

export function folderColor(folder: string) {
  const top = topFolder(folder);
  if (FOLDER_COLORS[top]) return FOLDER_COLORS[top];
  let h = 0;
  for (const ch of top) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return paletteColor(h);
}

/** Blend a hex color toward a background hex (amount 0..1). */
export function mix(hex: string, bg: string, amount: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(bg)];
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}
