"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BookOpen, Command, FolderKanban, LayoutDashboard, Network, Search } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { BrandMark } from "./brand-mark";
import { openCommandPalette } from "./command-palette";
import { cn } from "@/lib/utils";
import { useVaultEvents } from "@/hooks/use-vault-events";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/graph", label: "Graph Galaxy", icon: Network },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/search", label: "Search", icon: Search },
];

const ROW = 40; // h-9 (36px) + mb-1 (4px)

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [pulse, setPulse] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useVaultEvents(() => {
    setPulse((p) => p + 1);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 400);
  });

  const activeIndex = NAV.findIndex(({ href }) => (href === "/" ? pathname === "/" : pathname.startsWith(href)));

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-2.5 px-4">
        <BrandMark className="size-8" />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Second Brain</p>
          <p className="text-[11px] text-muted-foreground">rnd-agent vault</p>
        </div>
      </div>

      <button
        onClick={openCommandPalette}
        className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Search size={13} />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="flex items-center gap-0.5 rounded border border-border px-1 font-mono text-[10px]">
          <Command size={10} />K
        </kbd>
      </button>

      <nav className="relative flex-1 px-3 py-2">
        <span
          aria-hidden
          className="nav-indicator absolute left-3 right-3 top-2 h-9 rounded-lg bg-primary/12 ring-1 ring-primary/25"
          style={{ transform: `translateY(${Math.max(activeIndex, 0) * ROW}px)`, opacity: activeIndex < 0 ? 0 : 1 }}
        />
        {NAV.map(({ href, label, icon: Icon }, i) => {
          const active = i === activeIndex;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative z-10 mb-1 flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
                active ? "font-medium text-foreground" : "text-sidebar-foreground/65 hover:text-foreground"
              )}
            >
              <Icon size={16} className={active ? "text-primary" : ""} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-sidebar-border px-4 py-3">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span key={pulse} className={cn("live-dot", pulse > 0 && "live-dot-ping")} />
          Live
        </span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
