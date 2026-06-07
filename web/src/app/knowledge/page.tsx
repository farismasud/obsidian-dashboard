import { api, type Note, type NoteDetail } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Clock, Link2 } from "lucide-react";
import Link from "next/link";

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function groupByFolder(notes: Note[]) {
  const groups: Record<string, Note[]> = {};
  for (const note of notes) {
    const key = note.folder === "root" ? "vault" : note.folder;
    if (!groups[key]) groups[key] = [];
    groups[key].push(note);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string }>;
}) {
  const { note: notePath } = await searchParams;

  let notes: Note[] = [];
  let activeNote: NoteDetail | null = null;

  try {
    notes = await api.notes();
    if (notePath) {
      activeNote = await api.note(notePath);
    }
  } catch {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-sm">Cannot connect to API</p>
      </div>
    );
  }

  const groups = groupByFolder(notes);

  return (
    <div className="flex h-full">
      {/* Note list sidebar */}
      <div className="w-64 shrink-0 border-r border-border/50 flex flex-col h-full">
        <div className="px-4 h-14 flex items-center border-b border-border/50">
          <h1 className="text-sm font-semibold">Knowledge</h1>
          <span className="ml-auto text-xs text-muted-foreground">{notes.length}</span>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-4">
            {groups.map(([folder, folderNotes]) => (
              <div key={folder}>
                <p className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {folder}
                </p>
                <div className="space-y-0.5">
                  {folderNotes.map((note) => {
                    const isActive = notePath === note.path;
                    return (
                      <Link
                        key={note.path}
                        href={`/knowledge?note=${encodeURIComponent(note.path)}`}
                        className={`block px-2 py-1.5 rounded-md text-sm transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        {note.title}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Note content */}
      <div className="flex-1 overflow-y-auto">
        {activeNote ? (
          <div className="p-8 max-w-3xl mx-auto">
            {/* Note header */}
            <div className="mb-6">
              <h1 className="text-3xl font-bold tracking-tight mb-3">{activeNote.title}</h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {formatDate(activeNote.mod_time)}
                </span>
                <span className="capitalize bg-muted px-2 py-0.5 rounded-full">
                  {activeNote.folder === "root" ? "vault" : activeNote.folder}
                </span>
                {activeNote.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>

            <Separator className="mb-6" />

            {/* Rendered markdown */}
            <div
              className="prose"
              dangerouslySetInnerHTML={{ __html: activeNote.html_content }}
            />

            {/* Backlinks */}
            {activeNote.backlinks.length > 0 && (
              <div className="mt-10 pt-6 border-t border-border/50">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Link2 size={11} />
                  Backlinks ({activeNote.backlinks.length})
                </p>
                <div className="space-y-1.5">
                  {activeNote.backlinks.map((bp) => {
                    const linked = notes.find((n) => n.path === bp);
                    return (
                      <Link
                        key={bp}
                        href={`/knowledge?note=${encodeURIComponent(bp)}`}
                        className="block text-sm text-primary hover:underline underline-offset-2"
                      >
                        {linked?.title ?? bp}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2">
            <p className="text-muted-foreground text-sm">Select a note to read</p>
            <p className="text-xs text-muted-foreground/60">{notes.length} notes available</p>
          </div>
        )}
      </div>
    </div>
  );
}
