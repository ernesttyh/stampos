"use client";

/** Bowl-with-steam stamp icon used in filled cells (brand colours via CSS vars) */
export function StampIcon({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 40 40" className={className} style={style} aria-hidden="true">
      <path d="M6 18c0 8 6 15 14 15s14-7 14-15H6z" fill="rgb(var(--brand-rgb))" />
      <path d="M4 16.5c0-1.4 1.1-2.5 2.5-2.5h27c1.4 0 2.5 1.1 2.5 2.5S34.9 19 33.5 19h-27C5.1 19 4 17.9 4 16.5z" fill="rgb(var(--brand-dark-rgb))" />
      <path d="M13 11c2-4 6-5 9-4-2 1-3 3-3 5m4-6c3 0 5 2 6 5" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function StampGrid({ total, filled, animateFrom }: { total: number; filled: number; animateFrom: number | null }) {
  const cols = total <= 8 ? 4 : 5;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: total }).map((_, i) => {
        const isFilled = i < filled;
        const animate = animateFrom !== null && i >= animateFrom && isFilled;
        const delay = animate ? `${(i - (animateFrom ?? 0)) * 160}ms` : undefined;
        return (
          <div key={i} className={`stamp-cell ${isFilled ? "filled" : ""}`}>
            {isFilled ? (
              <StampIcon className={`h-[72%] w-[72%] ${animate ? "animate-drop" : ""}`} style={delay ? { animationDelay: delay } : undefined} />
            ) : (
              <span className="font-display text-sm font-semibold text-ink/25">{i + 1}</span>
            )}
            {animate && <span className="absolute inset-0 rounded-full bg-brand/20 animate-pop" style={{ animationDelay: delay }} />}
          </div>
        );
      })}
    </div>
  );
}
