import { api, type Note } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { SearchInput } from "./search-input";

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  let results: Note[] = [];

  if (q?.trim()) {
    try {
      results = await api.search(q.trim());
    } catch {
      // API offline
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Full-text search across vault</p>
      </div>

      <SearchInput defaultValue={q} />

      <div className="mt-6 space-y-3">
        {q && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <SearchX size={32} className="text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">No results for &ldquo;{q}&rdquo;</p>
          </div>
        )}

        {results.map((note) => (
          <Link key={note.path} href={`/knowledge?note=${encodeURIComponent(note.path)}`}>
            <Card className="border-border/50 hover:border-primary/30 hover:bg-accent/20 transition-all cursor-pointer group">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-sm font-medium group-hover:text-primary transition-colors">
                    {note.title}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-xs capitalize">
                      {note.folder === "root" ? "vault" : note.folder.split("/")[0]}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{note.excerpt}</p>
                <p className="text-xs text-muted-foreground/50 mt-2">{formatDate(note.mod_time)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}

        {q && results.length > 0 && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            {results.length} result{results.length !== 1 ? "s" : ""} for &ldquo;{q}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
