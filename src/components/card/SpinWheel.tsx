"use client";
import { useState } from "react";

export function SpinWheel({ onDone }: { onDone: (r: { won: boolean; balance: number; minted: number }) => void }) {
  const [spinning, setSpinning] = useState(false);
  const [angle, setAngle] = useState<number | null>(null);
  const [result, setResult] = useState<{ won: boolean; balance: number; minted: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function spin() {
    setSpinning(true);
    setError(null);
    let res: Response | null = null;
    let json: { ok?: boolean; error?: string; wedge?: number; won?: boolean; balance?: number; minted?: number } = {};
    try {
      res = await fetch("/api/card/spin", { method: "POST" });
      json = await res.json().catch(() => ({}));
    } catch {
      /* network */
    }
    if (!res || !res.ok || !json.ok) {
      setSpinning(false);
      setError(json.error || "Spin unavailable");
      return;
    }
    // 8 wedges, wedge 0 = win (gold). Stop so the pointer (top) lands in the middle of the wedge.
    const wedge = json.wedge as number;
    const target = 360 * 5 + (360 - (wedge * 45 + 22.5));
    setAngle(target);
    setTimeout(() => {
      setResult({ won: Boolean(json.won), balance: Number(json.balance ?? 0), minted: Number(json.minted ?? 0) });
      setSpinning(false);
    }, 3300);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/60 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-3xl card-paper p-6 text-center shadow-2xl">
        {!result ? (
          <>
            <p className="font-display text-2xl font-extrabold">Lucky spin</p>
            <p className="mt-1 text-sm text-ink/60">Land on gold for a bonus stamp.</p>
            <div className="relative mx-auto mt-5 h-56 w-56">
              <div className="absolute left-1/2 top-[-6px] z-10 h-0 w-0 -translate-x-1/2 border-l-[10px] border-r-[10px] border-t-[18px] border-l-transparent border-r-transparent border-t-ink" />
              <div
                className="wheel h-56 w-56 border-[6px] border-white shadow-lg"
                style={{
                  transform: angle !== null ? `rotate(${angle}deg)` : "rotate(0deg)",
                  transition: angle !== null ? "transform 3.2s cubic-bezier(.15,.75,.2,1)" : "none",
                }}
              />
              <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" />
            </div>
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
            <button className="btn-brand mt-6 w-full" onClick={spin} disabled={spinning}>
              {spinning ? "Spinning…" : "Spin"}
            </button>
          </>
        ) : (
          <>
            <p className="font-display text-3xl font-extrabold">{result.won ? "Gold! +1 stamp" : "Not this time"}</p>
            <p className="mt-2 text-ink/70">{result.won ? "A bonus stamp just landed on your card." : "Every bowl gives you another spin."}</p>
            <button className="btn-brand mt-6 w-full" onClick={() => onDone(result)}>Back to my card</button>
          </>
        )}
      </div>
    </div>
  );
}
