import Link from "next/link";
import { Clock, Command, Link2 } from "lucide-react";
import { api, type Note, type NoteDetail } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiOffline } from "@/components/api-offline";
import { folderColor } from "@/app/graph/graph-colors";
import { formatDate, relativeTime } from "@/lib/format";

function groupByFolder(notes: Note[]) {
  const groups: Record<string, Note[]> = {};
  for (const note of notes) {
    const key = note.folder === "root" ? "vault" : note.folder.replaceAll("\\", "/");
    (groups[key] ??= []).push(note);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const { note: notePath } = await searchParams;
  let notes: Note[];
  let active: NoteDetail | null = null;
  try {
    notes = await api.notes();
    if (notePath) active = await api.note(notePath);
  } catch {
    return <ApiOffline />;
  }
  const groups = groupByFolder(notes);
  const recent = [...notes].sort((a, b) => b.mod_time.localeCompare(a.mod_time)).slice(0, 6);

  return (
    <div className="flex h-full">
      <div className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-sidebar/40">
        <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
          <h1 className="text-sm font-semibold">Knowledge</h1>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{notes.length}</span>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-5 p-3">
            {groups.map(([folder, folderNotes]) => (
              <div key={folder}>
                <p className="mb-1 flex items-center gap-2 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <span className="size-1.5 rounded-full" style={{ background: folderColor(folder) }} />
                  {folder}
                </p>
                {folderNotes.map((n) => {
                  const on = notePath === n.path;
                  return (
                    <Link
                      key={n.path}
                      href={`/knowledge?note=${encodeURIComponent(n.path)}`}
                      className={`block truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
                        on ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {n.title}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 overflow-y-auto">
        {active ? (
          <article key={active.path} className="animate-enter mx-auto max-w-3xl px-10 py-10">
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: folderColor(active.folder) }} />
              <span>{active.folder === "root" ? "vault" : active.folder.replaceAll("\\", "/")}</span>
              <span>·</span>
              <Clock size={11} />
              <span>{formatDate(active.mod_time)}</span>
            </div>
            <h1 className="mb-4 text-4xl font-semibold tracking-tight">{active.title}</h1>
            {active.tags.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-1.5">
                {active.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">#{t}</Badge>
                ))}
              </div>
            )}
            <div className="prose" dangerouslySetInnerHTML={{ __html: active.html_content }} />
            {active.backlinks.length > 0 && (
              <div className="mt-12 border-t border-border pt-6">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Link2 size={12} /> Backlinks ({active.backlinks.length})
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {active.backlinks.map((bp) => (
                    <Link key={bp} href={`/knowledge?note=${encodeURIComponent(bp)}`} className="surface hover-lift px-3 py-2 text-sm">
                      {notes.find((n) => n.path === bp)?.title ?? bp}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </article>
        ) : (
          <div className="mx-auto flex h-full max-w-3xl flex-col justify-center px-10 py-10">
            <p className="animate-enter text-xs font-medium uppercase tracking-[0.18em] text-primary">Knowledge</p>
            <h2 className="animate-enter mt-2 text-3xl font-semibold tracking-tight" style={{ "--i": 1 } as React.CSSProperties}>
              Pick a note, or jump anywhere
            </h2>
            <p className="animate-enter mt-2 flex items-center gap-1.5 text-sm text-muted-foreground" style={{ "--i": 2 } as React.CSSProperties}>
              Press
              <kbd className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 font-mono text-[11px]">
                <Command size={10} />K
              </kbd>
              to search {notes.length} notes.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {recent.map((n, i) => (
                <Link
                  key={n.path}
                  href={`/knowledge?note=${encodeURIComponent(n.path)}`}
                  className="surface hover-lift animate-enter p-4"
                  style={{ "--i": i + 3 } as React.CSSProperties}
                >
                  <p className="text-[11px] text-muted-foreground">{relativeTime(n.mod_time)}</p>
                  <p className="mt-1 line-clamp-1 font-medium">{n.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.excerpt}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
