export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-from)" />
          <stop offset="1" stopColor="var(--brand-to)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#brand-grad)" opacity="0.16" />
      <path d="M9 21 L15 10 L23 15 L19 23 Z M15 10 L19 23" stroke="url(#brand-grad)" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <circle cx="9" cy="21" r="2.2" fill="url(#brand-grad)" />
      <circle cx="15" cy="10" r="2.7" fill="url(#brand-grad)" />
      <circle cx="23" cy="15" r="2" fill="url(#brand-grad)" />
      <circle cx="19" cy="23" r="1.8" fill="url(#brand-grad)" />
    </svg>
  );
}
