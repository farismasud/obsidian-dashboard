"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Link2, X } from "lucide-react";
import { api, type NoteDetail } from "@/lib/api";
import type { GNode } from "./graph-types";

export function NotePanel({ node, color, onClose }: { node: GNode; color: string; onClose: () => void }) {
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .note(node.id)
      .then((n) => !cancelled && setNote(n))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [node.id]);

  return (
    <aside className="animate-slide-in absolute bottom-4 right-4 top-4 z-30 flex w-[380px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card/85 shadow-2xl backdrop-blur-xl">
      <header className="flex items-start gap-3 border-b border-border p-4">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold leading-snug">{node.title}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {node.folder === "root" ? "vault" : node.folder.replaceAll("\\", "/")} · {node.link_count ?? 0} links
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <X size={16} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {failed && <p className="text-sm text-muted-foreground">Could not load this note.</p>}
        {!note && !failed && (
          <div className="space-y-2">
            {[80, 95, 60, 90].map((w) => (
              <div key={w} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {note && (
          <>
            {note.tags.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1">
                {note.tags.map((t) => (
                  <span key={t} className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] text-primary">#{t}</span>
                ))}
              </div>
            )}
            <div className="prose text-sm" dangerouslySetInnerHTML={{ __html: note.html_content }} />
            {note.backlinks.length > 0 && (
              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 size={12} /> {note.backlinks.length} backlink{note.backlinks.length === 1 ? "" : "s"}
              </p>
            )}
          </>
        )}
      </div>
      <footer className="border-t border-border p-3">
        <Link
          href={`/knowledge?note=${encodeURIComponent(node.id)}`}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary/12 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
        >
          Open note <ArrowUpRight size={14} />
        </Link>
      </footer>
    </aside>
  );
}
