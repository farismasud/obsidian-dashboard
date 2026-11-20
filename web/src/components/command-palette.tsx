"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CornerDownLeft, FileText, FolderKanban, LayoutDashboard, Network, Search } from "lucide-react";
import { api, type Note } from "@/lib/api";

const OPEN_EVENT = "open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const PAGES = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Graph Galaxy", href: "/graph", icon: Network },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Search", href: "/search", icon: Search },
];

interface Item {
  key: string;
  label: string;
  hint: string;
  href: string;
  icon: React.ElementType;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || !term) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.search(term).then((r) => !cancelled && setNotes(r.slice(0, 8))).catch(() => {});
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const noteItems = term
      ? notes.map((n) => ({
          key: n.path,
          label: n.title,
          hint: n.folder === "root" ? "vault" : n.folder.replaceAll("\\", "/"),
          href: `/knowledge?note=${encodeURIComponent(n.path)}`,
          icon: FileText,
        }))
      : [];
    const pageItems = PAGES.filter((p) => !term || p.label.toLowerCase().includes(term)).map((p) => ({
      key: p.href,
      label: p.label,
      hint: "Page",
      href: p.href,
      icon: p.icon,
    }));
    return [...noteItems, ...pageItems];
  }, [q, notes]);

  function close() {
    setOpen(false);
    setQ("");
    setNotes([]);
    setActive(0);
  }

  function go(item?: Item) {
    if (!item) return;
    close();
    router.push(item.href);
  }

  if (!open) return null;

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-background/60 px-4 pt-[14vh] backdrop-blur-sm"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-pop w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover/95 shadow-2xl shadow-primary/10"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search size={16} className="text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(items[active]);
              }
            }}
            placeholder="Search notes or jump to a page…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">No results</li>}
          {items.map((item, i) => {
            const Icon = item.icon;
            const on = i === active;
            return (
              <li key={item.key}>
                <button
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    on ? "bg-primary/12 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Icon size={15} className={on ? "text-primary" : ""} />
                  <span className="flex-1 truncate">{item.label}</span>
                  <span className="max-w-40 truncate text-[11px] text-muted-foreground/70">{item.hint}</span>
                  {on && <CornerDownLeft size={13} className="text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
