import { api, type Note, type Stats } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, FolderKanban, Clock, TrendingUp } from "lucide-react";
import Link from "next/link";

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon size={18} className="text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NoteCard({ note }: { note: Note }) {
  return (
    <Link href={`/knowledge?note=${encodeURIComponent(note.path)}`}>
      <Card className="border-border/50 hover:border-primary/30 hover:bg-accent/30 transition-all cursor-pointer group">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-1">
              {note.title}
            </p>
            <Badge variant="outline" className="text-xs shrink-0 capitalize">
              {note.folder === "root" ? "vault" : note.folder.split("/")[0]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{note.excerpt}</p>
          <p className="text-xs text-muted-foreground/60 mt-2">{formatDate(note.mod_time)}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  let stats: Stats | null = null;

  try {
    stats = await api.stats();
  } catch {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground text-sm">Cannot connect to API</p>
          <p className="text-xs text-muted-foreground/60">
            Run: <code className="bg-muted px-1.5 py-0.5 rounded">cd api && go run main.go</code>
          </p>
        </div>
      </div>
    );
  }

  const folderList = Object.entries(stats.folders)
    .sort((a, b) => b[1] - a[1])
    .filter(([f]) => f !== "root");

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Last updated {formatDate(stats.last_modified)}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
        <StatCard icon={FileText} label="Total Notes" value={stats.total_notes} />
        <StatCard icon={FolderKanban} label="Projects" value={stats.project_count} />
        <StatCard icon={TrendingUp} label="Folders" value={folderList.length} />
        <StatCard
          icon={Clock}
          label="Last Modified"
          value={formatDate(stats.last_modified).split(",")[0]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Notes */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Recent Notes
          </h2>
          {stats.recent_notes.map((note) => (
            <NoteCard key={note.path} note={note} />
          ))}
        </div>

        {/* Folders */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Folders
          </h2>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-4 space-y-3">
              {folderList.map(([folder, count]) => (
                <div key={folder} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{folder}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 rounded-full bg-primary/20 w-16 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(count / stats.total_notes) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-4 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
