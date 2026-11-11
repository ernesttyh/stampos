"use client";

export function Confetti({ count = 40 }: { count?: number }) {
  const colors = ["rgb(var(--brand-rgb))", "var(--accent)", "#1F1A17", "#FBF4E8"];
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0 overflow-visible" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.6;
        const size = 6 + Math.random() * 8;
        return (
          <span
            key={i}
            className="absolute top-0 animate-confetti"
            style={{
              left: `${left}%`,
              width: size,
              height: size * 1.6,
              background: colors[i % colors.length],
              animationDelay: `${delay}s`,
              borderRadius: i % 3 === 0 ? "9999px" : "2px",
            }}
          />
        );
      })}
    </div>
  );
}
