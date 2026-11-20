export interface GNode {
  id: string;
  title: string;
  folder: string;
  group: string;
  link_count?: number;
  x?: number;
  y?: number;
  z?: number;
  __born?: number; // performance.now() when the node first appeared live
}

export interface GLink {
  source: string | GNode;
  target: string | GNode;
}

export interface GGraph {
  nodes: GNode[];
  links: GLink[];
}

export type GraphCommand = { kind: "zoomIn" | "zoomOut" | "fit"; seq: number } | null;

export interface RenderProps {
  data: GGraph;
  width: number;
  height: number;
  colorOf: (n: GNode) => string;
  highlight: Set<string> | null; // search/legend matches; null = no filter
  selectedId: string | null;
  onSelect: (n: GNode | null) => void;
  command: GraphCommand;
  dark: boolean;
  reducedMotion: boolean;
}

export const idOf = (end: string | GNode) => (typeof end === "string" ? end : end.id);

export function neighborMap(links: GLink[]) {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let s = m.get(a);
    if (!s) m.set(a, (s = new Set()));
    s.add(b);
  };
  for (const l of links) {
    const s = idOf(l.source);
    const t = idOf(l.target);
    add(s, t);
    add(t, s);
  }
  return m;
}
