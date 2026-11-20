import Link from "next/link";
import { ArrowUpRight, Clock, FileText, FolderTree, Link2 } from "lucide-react";
import { api, type GraphData, type Note, type Stats } from "@/lib/api";
import { CountUp } from "@/components/count-up";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { ApiOffline } from "@/components/api-offline";
import { folderColor, topFolder } from "@/app/graph/graph-colors";
import { relativeTime } from "@/lib/format";

function StatCard({ icon: Icon, label, children, i, tint }: { icon: React.ElementType; label: string; children: React.ReactNode; i: number; tint: string }) {
  return (
    <div className="surface hover-lift animate-enter p-5" style={{ "--i": i } as React.CSSProperties}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className="grid size-8 place-items-center rounded-lg" style={{ background: `${tint}1f`, color: tint }}>
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{children}</p>
    </div>
  );
}

function NoteCard({ note, i }: { note: Note; i: number }) {
  const color = folderColor(note.folder);
  return (
    <Link
      href={`/knowledge?note=${encodeURIComponent(note.path)}`}
      className="surface hover-lift animate-enter group block p-4"
      style={{ "--i": i } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="truncate">{note.folder === "root" ? "vault" : note.folder.replaceAll("\\", "/")}</span>
        <span className="ml-auto shrink-0">{relativeTime(note.mod_time)}</span>
      </div>
      <p className="mt-2 line-clamp-1 font-medium transition-colors group-hover:text-primary">{note.title}</p>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{note.excerpt}</p>
    </Link>
  );
}

export default async function DashboardPage() {
  let stats: Stats;
  let notes: Note[];
  let graph: GraphData;
  try {
    [stats, notes, graph] = await Promise.all([api.stats(), api.notes(), api.graph()]);
  } catch {
    return <ApiOffline />;
  }

  const folders = Object.entries(stats.folders)
    .map(([f, n]) => [topFolder(f), n] as const)
    .reduce((m, [f, n]) => m.set(f, (m.get(f) ?? 0) + n), new Map<string, number>());
  const folderList = [...folders.entries()].sort((a, b) => b[1] - a[1]);
  const maxFolder = Math.max(1, ...folderList.map(([, n]) => n));

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header className="animate-enter mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">rnd-agent · Second Brain</p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last activity {relativeTime(stats.last_modified)}</p>
        </div>
        <Link
          href="/graph"
          className="group inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
        >
          Open Graph Galaxy
          <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard i={0} icon={FileText} label="Notes" tint="#a78bfa"><CountUp value={stats.total_notes} /></StatCard>
        <StatCard i={1} icon={Link2} label="Connections" tint="#22d3ee"><CountUp value={graph.links.length} /></StatCard>
        <StatCard i={2} icon={FolderTree} label="Folders" tint="#f472b6"><CountUp value={folderList.length} /></StatCard>
        <StatCard i={3} icon={Clock} label="Last activity" tint="#34d399">
          <span className="text-xl">{relativeTime(stats.last_modified)}</span>
        </StatCard>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="surface animate-enter p-5 lg:col-span-2" style={{ "--i": 4 } as React.CSSProperties}>
          <h2 className="mb-4 text-sm font-medium">Activity</h2>
          <ActivityHeatmap dates={notes.map((n) => n.mod_time)} />
        </div>
        <div className="surface animate-enter p-5" style={{ "--i": 5 } as React.CSSProperties}>
          <h2 className="mb-4 text-sm font-medium">Folders</h2>
          <ul className="space-y-3">
            {folderList.map(([folder, count]) => (
              <li key={folder}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="capitalize">{folder === "root" ? "vault" : folder}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${(count / maxFolder) * 100}%`, background: folderColor(folder) }} />
                </div>
              </li>
            ))}
            {folderList.length === 0 && <li className="text-xs text-muted-foreground">No folders yet</li>}
          </ul>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="animate-enter mb-3 text-sm font-medium" style={{ "--i": 6 } as React.CSSProperties}>Recent notes</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {stats.recent_notes.map((note, i) => (
            <NoteCard key={note.path} note={note} i={i + 7} />
          ))}
        </div>
      </section>
    </div>
  );
}
