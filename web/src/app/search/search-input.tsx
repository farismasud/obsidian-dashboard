"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useCallback, useTransition } from "react";

export function SearchInput({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      startTransition(() => {
        router.replace(`/search${q ? `?q=${encodeURIComponent(q)}` : ""}`, { scroll: false });
      });
    },
    [router]
  );

  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        defaultValue={defaultValue}
        onChange={handleChange}
        placeholder="Search notes…"
        autoFocus
        className="w-full pl-9 pr-4 py-2.5 text-sm bg-card border border-border rounded-lg outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors placeholder:text-muted-foreground"
      />
    </div>
  );
}
