const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

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
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
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
    get<Note[]>(`/api/notes${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`),
  note: (path: string) => get<NoteDetail>(`/api/note/${encodeURIComponent(path)}`),
  projects: () => get<Note[]>("/api/projects"),
  graph: () => get<GraphData>("/api/graph"),
  search: (q: string) => get<Note[]>(`/api/search?q=${encodeURIComponent(q)}`),
  stats: () => get<Stats>("/api/stats"),
};
