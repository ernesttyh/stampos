"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function InviteForm({ slug, code, deliverable, agreement }: { slug: string; code: string; deliverable: string; agreement: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agree) {
      setError("Please accept the creator agreement to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    let res: Response | null = null;
    let json: { error?: string } = {};
    try {
      res = await fetch("/api/card/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, code, name, phone }),
      });
      json = await res.json().catch(() => ({}));
    } catch {
      /* network */
    }
    setBusy(false);
    if (!res || !res.ok || json.error) {
      setError(json.error || "Something went wrong. Please check your connection and try again.");
      return;
    }
    router.replace(`/${slug}?tab=rewards`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-8 rounded-3xl card-paper p-5 text-ink shadow-xl shadow-black/20">
      <p className="font-display text-lg font-extrabold">The deal</p>
      <p className="mt-1 text-sm text-ink/70">{deliverable}</p>
      <div className="mt-3 max-h-40 overflow-y-auto rounded-xl bg-white/70 p-3 text-xs leading-relaxed text-ink/70 whitespace-pre-line">{agreement}</div>

      <label className="label mt-5" htmlFor="name">Your name</label>
      <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="As on your card" />
      <label className="label mt-4" htmlFor="phone">Mobile number</label>
      <input id="phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required placeholder="9123 4567" />

      <label className="mt-5 flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I accept the creator agreement above.</span>
      </label>
      {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button className="btn-brand mt-5 w-full text-lg" disabled={busy}>{busy ? "Unlocking…" : "Accept and unlock my first bowl"}</button>
    </form>
  );
}
