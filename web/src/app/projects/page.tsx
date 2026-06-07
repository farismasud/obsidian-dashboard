import { api, type Note } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Clock } from "lucide-react";
import Link from "next/link";

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ProjectCard({ note }: { note: Note }) {
  return (
    <Link href={`/knowledge?note=${encodeURIComponent(note.path)}`}>
      <Card className="border-border/50 hover:border-primary/30 hover:bg-accent/20 transition-all cursor-pointer group h-full">
        <CardContent className="pt-5 pb-5 h-full flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FileText size={15} className="text-primary" />
            </div>
            {note.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-end">
                {note.tags.slice(0, 2).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <h3 className="font-semibold text-sm group-hover:text-primary transition-colors mb-1.5">
            {note.title}
          </h3>
          <p className="text-xs text-muted-foreground line-clamp-3 flex-1">{note.excerpt}</p>

          <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-border/50 text-xs text-muted-foreground">
            <Clock size={11} />
            {formatDate(note.mod_time)}
            {note.backlinks.length > 0 && (
              <>
                <span className="mx-1">·</span>
                {note.backlinks.length} backlink{note.backlinks.length !== 1 ? "s" : ""}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function ProjectsPage() {
  let projects: Note[] = [];

  try {
    projects = await api.projects();
  } catch {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-sm">Cannot connect to API — is the Go server running?</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{projects.length} projects in vault</p>
      </div>

      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">No notes found in Projects/ folder.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard key={p.path} note={p} />
          ))}
        </div>
      )}
    </div>
  );
}
