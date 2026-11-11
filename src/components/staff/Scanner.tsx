"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Lookup = {
  customer: { id: string; name: string; phone: string; kind: string; stamp_balance: number; lifetime_stamps: number; visits: number; last_visit_at: string | null; created_at: string };
  rewards: { id: string; code: string; title: string; type: string; status: string; expires_at: string | null }[];
  migrationOpen: boolean;
  migrationCap: number;
  maxPerVisit: number;
  stampsPerReward: number;
  tier: string;
  activeDouble: { title: string; multiplier: number } | null;
};

type Outcome = { added: number; multiplier: number; balance: number; minted: number; bonuses: { label: string }[] };

export function Scanner({
  brand, staffName, outletName, role, slug,
}: { brand: { name: string; stamp_label: string; stamps_per_reward: number; max_stamps_per_visit: number }; staffName: string; outletName: string; role: string; slug: string }) {
  const [mode, setMode] = useState<"scan" | "customer" | "done">("scan");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ kind: "stamp"; o: Outcome } | { kind: "redeem"; title: string } | { kind: "migrate"; qty: number } | null>(null);
  const [manual, setManual] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  // html5-qrcode throws *synchronously* (a string, not an Error) if you stop/pause/resume it in the
  // wrong state, so every call goes through these guards. 2 = SCANNING, 3 = PAUSED.
  type Html5QrcodeLike = { getState: () => number; stop: () => Promise<void>; clear: () => void; pause: (freeze?: boolean) => void; resume: () => void };
  const scannerRef = useRef<Html5QrcodeLike | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const handlingRef = useRef(false);

  async function safeStop(s: Html5QrcodeLike | null) {
    if (!s) return;
    try {
      const st = s.getState();
      if (st === 2 || st === 3) await s.stop();
    } catch {
      /* already stopped */
    }
    try {
      s.clear();
    } catch {
      /* ignore */
    }
  }
  function safePause() {
    try {
      if (scannerRef.current?.getState() === 2) scannerRef.current.pause(true);
    } catch {
      /* ignore */
    }
  }
  function safeResume() {
    try {
      if (scannerRef.current?.getState() === 3) scannerRef.current.resume();
    } catch {
      /* ignore */
    }
  }

  const loadCustomer = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/lookup?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `Could not load customer (${res.status})`);
        return false;
      }
      setLookup(json);
      setQty(1);
      setMode("customer");
      return true;
    } catch {
      setError("Network problem — check the connection and try again");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  // Camera scanning
  useEffect(() => {
    if (mode !== "scan") return;
    let cancelled = false;
    handlingRef.current = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode("qr-reader", { verbose: false }) as unknown as Html5QrcodeLike;
        scannerRef.current = scanner;
        await (scanner as unknown as InstanceType<typeof Html5Qrcode>).start(
          { facingMode: "environment" },
          { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.7, height: Math.min(w, h) * 0.7 }) },
          (text) => {
            if (handlingRef.current) return;
            const now = Date.now();
            if (text === lastCodeRef.current.code && now - lastCodeRef.current.at < 4000) return;
            lastCodeRef.current = { code: text, at: now };
            const m = /^SO:([0-9a-f-]{36})$/i.exec(text.trim());
            if (!m) {
              setError("That's not a stamp card QR");
              return;
            }
            handlingRef.current = true;
            try {
              if (navigator.vibrate) navigator.vibrate(60);
            } catch {
              /* ignore */
            }
            // Freeze the preview while we look the customer up; the effect cleanup stops the camera
            // once the customer view takes over.
            safePause();
            loadCustomer(m[1]).then((ok) => {
              if (!ok) {
                handlingRef.current = false;
                safeResume();
              }
            });
          },
          () => undefined
        );
        if (cancelled) await safeStop(scanner);
      } catch (e) {
        setCameraError("Camera not available — type the customer's number below instead.");
        void e;
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      void safeStop(s);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loadCustomer]);

  /** POST/GET JSON and never throw: network failures become a readable error instead of a crash. */
  async function api(url: string, body?: unknown): Promise<{ ok: boolean; json: Record<string, unknown> & { error?: string; ok?: boolean }; status: number }> {
    try {
      const res = await fetch(url, body === undefined
        ? { cache: "no-store" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, json, status: res.status };
    } catch {
      return { ok: false, json: { error: "Network problem — check the connection and try again" }, status: 0 };
    }
  }

  async function findManual(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, json } = await api(`/api/staff/find?q=${encodeURIComponent(manual)}`);
    setBusy(false);
    if (!ok) {
      setError(json.error || "Not found");
      return;
    }
    setLookup(json as unknown as Lookup);
    setQty(1);
    setMode("customer");
  }

  async function addStamps() {
    if (!lookup) return;
    setBusy(true);
    setError(null);
    const { ok, json } = await api("/api/staff/stamp", { customerId: lookup.customer.id, qty });
    setBusy(false);
    if (!ok) {
      setError(json.error || "Could not add stamps");
      return;
    }
    setOutcome({ kind: "stamp", o: json as unknown as Outcome });
    setMode("done");
  }

  async function redeem(code: string, title: string) {
    setBusy(true);
    setError(null);
    const { ok, json } = await api("/api/staff/redeem", { code });
    setBusy(false);
    if (!ok || !json.ok) {
      setError(json.error || "Could not redeem");
      return;
    }
    setOutcome({ kind: "redeem", title });
    setMode("done");
  }

  async function migrate(n: number) {
    if (!lookup) return;
    if (!confirm(`Credit ${n} stamp${n > 1 ? "s" : ""} from ${lookup.customer.name}'s old card?`)) return;
    setBusy(true);
    setError(null);
    const { ok, json } = await api("/api/staff/migrate", { customerId: lookup.customer.id, qty: n });
    setBusy(false);
    if (!ok) {
      setError(json.error || "Could not credit");
      return;
    }
    setOutcome({ kind: "migrate", qty: n });
    setMode("done");
  }

  function reset() {
    setLookup(null);
    setOutcome(null);
    setError(null);
    setManual("");
    setMode("scan");
  }

  const max = lookup?.maxPerVisit ?? brand.max_stamps_per_visit;

  return (
    <main className="min-h-screen bg-ink text-cream">
      <header className="flex items-center justify-between px-5 pt-5">
        <div>
          <p className="font-display text-lg font-extrabold">{brand.name}</p>
          <p className="text-xs text-cream/60">{outletName} · {staffName}{role === "manager" ? " (manager)" : ""}</p>
        </div>
        <a href={`/api/staff/logout?brand=${slug}`} className="text-xs text-cream/50 underline">Sign out</a>
      </header>

      {mode === "scan" && (
        <section className="mx-auto max-w-md px-5 pt-5">
          <p className="font-display text-2xl font-extrabold">Scan the customer&apos;s QR</p>
          <div className="relative mt-4 overflow-hidden rounded-3xl bg-black" style={{ minHeight: 320 }}>
            <div id="qr-reader" className="w-full" />
            {cameraError && <p className="p-6 text-center text-sm text-cream/70">{cameraError}</p>}
          </div>
          <form onSubmit={findManual} className="mt-4 flex gap-2">
            <input className="input !bg-cream/10 !text-cream !border-cream/20" placeholder="Or type mobile number / reward code" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button className="btn-ghost shrink-0" disabled={busy || !manual}>Find</button>
          </form>
          {error && <p className="mt-3 rounded-xl bg-red-500/20 px-3 py-2 text-sm text-red-200">{error}</p>}
        </section>
      )}

      {mode === "customer" && lookup && (
        <section className="mx-auto max-w-md px-5 pt-5">
          <button onClick={reset} className="text-sm text-cream/60">← Back to scanner</button>
          <div className="mt-3 rounded-3xl card-paper p-5 text-ink">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-display text-2xl font-extrabold">{lookup.customer.name}</p>
                <p className="text-sm text-ink/60">{lookup.tier}{lookup.customer.kind === "influencer" ? " · creator" : ""} · {lookup.customer.visits} visit{lookup.customer.visits === 1 ? "" : "s"}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-3xl font-extrabold">{lookup.customer.stamp_balance}<span className="text-base text-ink/40">/{lookup.stampsPerReward}</span></p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full bg-brand" style={{ width: `${(lookup.customer.stamp_balance / lookup.stampsPerReward) * 100}%` }} />
            </div>
            {lookup.activeDouble && <p className="mt-2 text-xs font-semibold text-brand">{lookup.activeDouble.multiplier}× stamps active — {lookup.activeDouble.title}</p>}
          </div>

          {/* Rewards to redeem */}
          {lookup.rewards.filter((r) => r.status === "available").length > 0 && (
            <div className="mt-4 space-y-2">
              {lookup.rewards.filter((r) => r.status === "available").map((r) => (
                <button key={r.id} onClick={() => redeem(r.code, r.title)} disabled={busy} className="flex w-full items-center justify-between rounded-2xl bg-[var(--accent)] px-5 py-4 text-left text-ink">
                  <div>
                    <p className="font-display text-lg font-extrabold">Redeem: {r.title}</p>
                    <p className="text-xs text-ink/60">{r.type === "influencer" ? "Creator reward" : "Stamp card reward"} · {r.code}</p>
                  </div>
                  <span className="font-display text-xl font-extrabold">→</span>
                </button>
              ))}
            </div>
          )}

          {/* Add stamps */}
          <div className="mt-4 rounded-3xl bg-cream/10 p-5">
            <p className="font-display text-lg font-extrabold">How many {brand.stamp_label}s?</p>
            <div className="mt-3 grid grid-cols-6 gap-2">
              {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setQty(n)} className={`rounded-xl py-3 font-display text-lg font-extrabold ${qty === n ? "bg-cream text-ink" : "bg-cream/10 text-cream"}`}>
                  {n}
                </button>
              ))}
            </div>
            <button onClick={addStamps} disabled={busy} className="btn-brand mt-4 w-full text-xl !py-4">
              {busy ? "Adding…" : `Add ${qty} stamp${qty > 1 ? "s" : ""}`}
            </button>
          </div>

          {lookup.migrationOpen && (
            <details className="mt-4 rounded-2xl bg-cream/5 p-4">
              <summary className="cursor-pointer font-display font-bold">Credit stamps from an old paper card</summary>
              <p className="mt-1 text-xs text-cream/60">Once per customer, up to {lookup.migrationCap}. Check the paper card first.</p>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {Array.from({ length: lookup.migrationCap }, (_, i) => i + 1).map((n) => (
                  <button key={n} onClick={() => migrate(n)} disabled={busy} className="rounded-xl bg-cream/10 py-2 font-display font-bold">{n}</button>
                ))}
              </div>
            </details>
          )}

          {error && <p className="mt-3 rounded-xl bg-red-500/20 px-3 py-2 text-sm text-red-200">{error}</p>}
        </section>
      )}

      {mode === "done" && outcome && (
        <section className="mx-auto flex max-w-md flex-col items-center px-5 pt-16 text-center">
          <div className="animate-pop">
            {outcome.kind === "stamp" && (
              <>
                <p className="font-display text-7xl font-extrabold text-[var(--accent)]">+{outcome.o.added}</p>
                <p className="mt-2 font-display text-2xl font-extrabold">{outcome.o.multiplier > 1 ? `${outcome.o.multiplier}× day — ` : ""}Stamped</p>
                <p className="mt-1 text-cream/70">{lookup?.customer.name} now has {outcome.o.balance} of {lookup?.stampsPerReward}</p>
                {outcome.o.minted > 0 && <p className="mt-3 rounded-2xl bg-[var(--accent)] px-4 py-2 font-display font-bold text-ink">Card complete — tell them a reward is ready!</p>}
                {outcome.o.bonuses.map((b) => (
                  <p key={b.label} className="mt-2 text-sm text-cream/80">+1 {b.label}</p>
                ))}
              </>
            )}
            {outcome.kind === "redeem" && (
              <>
                <p className="font-display text-5xl font-extrabold text-[var(--accent)]">Redeemed</p>
                <p className="mt-2 text-cream/80">{outcome.title} for {lookup?.customer.name}</p>
              </>
            )}
            {outcome.kind === "migrate" && (
              <>
                <p className="font-display text-6xl font-extrabold text-[var(--accent)]">+{outcome.qty}</p>
                <p className="mt-2 text-cream/80">Old card credited for {lookup?.customer.name}</p>
              </>
            )}
          </div>
          <button onClick={reset} className="btn-ghost mt-10 w-full text-lg">Next customer</button>
        </section>
      )}
    </main>
  );
}
