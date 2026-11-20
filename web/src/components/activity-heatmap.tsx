const WEEKS = 12;
const DAY = 86_400_000;

/** Notes per day (by last-modified date, UTC) for the last 12 weeks, GitHub-style. */
export function ActivityHeatmap({ dates }: { dates: string[] }) {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = today - (WEEKS * 7 - 1 + now.getUTCDay()) * DAY;
  const cells: { key: string; count: number }[] = [];
  for (let t = start; t <= today; t += DAY) {
    const key = new Date(t).toISOString().slice(0, 10);
    cells.push({ key, count: counts.get(key) ?? 0 });
  }
  const max = Math.max(1, ...cells.map((c) => c.count));
  const total = cells.reduce((s, c) => s + c.count, 0);

  return (
    <div>
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
        {cells.map((c, i) => (
          <div
            key={c.key}
            title={`${c.key}: ${c.count} note${c.count === 1 ? "" : "s"}`}
            className="heat-cell size-3 rounded-[3px]"
            style={{ "--lvl": c.count ? 0.25 + 0.75 * (c.count / max) : 0, animationDelay: `${i * 5}ms` } as React.CSSProperties}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{total}</span> notes changed in the last {WEEKS} weeks
      </p>
    </div>
  );
}
