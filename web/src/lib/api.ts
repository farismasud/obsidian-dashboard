// Server components call the loopback-only internal API; the browser uses same-origin relative URLs.
const BASE = typeof window === "undefined" ? (process.env.API_URL ?? "http://127.0.0.1:8081") : "";

export interface Note {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  links: string[];
  backlinks: string[];
  frontmatter: Record<string, unknown>;
  mod_time: string;
  excerpt: string;
}

export interface NoteDetail extends Note {
  html_content: string;
  content: string;
}

export interface GraphNode {
  id: string;
  title: string;
  folder: string;
  group: string;
  link_count?: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphifyInfo {
  available: boolean;
  communities: Record<string, { id: number; label: string }>;
}

export interface Stats {
  total_notes: number;
  project_count: number;
  folders: Record<string, number>;
  last_modified: string;
  recent_notes: Note[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  notes: (folder?: string) =>
    get<Note[] | null>(`/api/notes${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`).then((r) => r ?? []),
  note: (path: string) => get<NoteDetail>(`/api/note/${encodeURIComponent(path)}`),
  projects: () => get<Note[] | null>("/api/projects").then((r) => r ?? []),
  graph: () => get<GraphData>("/api/graph"),
  graphify: () => get<GraphifyInfo>("/api/graphify"),
  search: (q: string) => get<Note[] | null>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r ?? []),
  stats: () => get<Stats>("/api/stats"),
};
