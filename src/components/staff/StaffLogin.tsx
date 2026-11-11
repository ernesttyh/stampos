"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function StaffLogin({ slug, outlets }: { slug: string; outlets: { id: string; name: string }[] }) {
  const router = useRouter();
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let res: Response | null = null;
    let json: { error?: string } = {};
    try {
      res = await fetch("/api/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, outletId, pin }) });
      json = await res.json().catch(() => ({}));
    } catch {
      /* network */
    }
    setBusy(false);
    if (!res || !res.ok) {
      setError(json.error || "Could not sign in — check the connection and try again");
      return;
    }
    router.replace(`/${slug}/staff/scan`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <div>
        <label className="label !text-cream/70" htmlFor="outlet">Outlet</label>
        <select id="outlet" className="input !bg-cream/10 !text-cream !border-cream/20" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
          {outlets.map((o) => (
            <option key={o.id} value={o.id} className="text-ink">{o.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label !text-cream/70" htmlFor="pin">PIN</label>
        <input id="pin" className="input !bg-cream/10 !text-cream !border-cream/20 tracking-[0.5em] text-center text-2xl" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} maxLength={8} required />
      </div>
      {error && <p className="rounded-xl bg-red-500/20 px-3 py-2 text-sm text-red-200">{error}</p>}
      <button className="btn-brand w-full text-lg" disabled={busy || !outletId}>{busy ? "Signing in…" : "Open scanner"}</button>
    </form>
  );
}
