"use client";
import { useState } from "react";

/**
 * Thin-bar daily chart: single series (no legend), recessive baseline, hover tooltip.
 * Values are text-coloured (never series-coloured); the bar carries identity.
 */
export function BarChart({ data, label, color = "#1F1A17" }: { data: { day: string; value: number }[]; label: string; color?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 640, h = 160, padL = 8, padB = 22, padT = 18;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length);
  const slot = (w - padL) / n;
  const bw = Math.max(4, Math.min(14, slot - 4));
  const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={label}>
        <line x1={padL} x2={w} y1={h - padB} y2={h - padB} stroke="#1F1A17" strokeOpacity="0.15" />
        {data.map((d, i) => {
          const bh = ((h - padB - padT) * d.value) / max;
          const x = padL + i * slot + (slot - bw) / 2;
          const y = h - padB - bh;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * slot} y={padT} width={slot} height={h - padB - padT} fill="transparent" />
              <rect x={x} y={y} width={bw} height={bh} rx={bh > 4 ? 4 : 0} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />
              {(i === 0 || i === data.length - 1 || i % 7 === 0) && (
                <text x={x + bw / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="#1F1A17" fillOpacity="0.5">{fmt(d.day)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-ink px-2 py-1 text-xs text-white" style={{ left: `${(hover / n) * 100}%` }}>
          {fmt(data[hover].day)}: {data[hover].value} {label}
        </div>
      )}
    </div>
  );
}
