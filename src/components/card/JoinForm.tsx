"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneVerification } from "./PhoneVerification";

export function JoinForm({
  slug, brandName, pdpaText, refCode, birthdayEnabled,
}: { slug: string; brandName: string; pdpaText: string | null; refCode: string | null; birthdayEnabled: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [consent, setConsent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!verified) { setError("Please verify your mobile number first."); return; }
    setBusy(true);
    setError(null);
    let res: Response | null = null;
    let json: { error?: string; created?: boolean } = {};
    try {
      res = await fetch("/api/card/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, name, phone, birthday: birthday || null, marketingConsent: consent, ref: refCode }),
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
    router.replace(`/${slug}${json.created ? "?welcome=1" : ""}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-8 rounded-3xl card-paper text-ink p-5 shadow-xl shadow-black/20">
      <label className="label" htmlFor="name">Your name</label>
      <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder="What should we call you?" />
      <label className="label mt-4" htmlFor="phone">Mobile number</label>
      <input id="phone" className="input" value={phone} onChange={(e) => { setPhone(e.target.value); setVerified(false); }} inputMode="tel" autoComplete="tel" required placeholder="9123 4567" />
      <PhoneVerification key={phone} slug={slug} phone={phone} verified={verified} onVerified={() => setVerified(true)} />
      {birthdayEnabled && (
        <>
          <label className="label mt-4" htmlFor="bday">Birthday <span className="text-ink/40 font-normal">(optional — we send a treat)</span></label>
          <input id="bday" className="input" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
        </>
      )}
      <label className="mt-5 flex items-start gap-3 text-sm text-ink/80">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--brand-rgb))]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Send me offers and reminders from {brandName} (you can switch this off any time).</span>
      </label>
      {pdpaText && <p className="mt-3 text-xs leading-relaxed text-ink/50">{pdpaText}</p>}
      {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button className="btn-brand mt-5 w-full text-lg" disabled={busy || !verified}>
        {busy ? "Making your card…" : "Get my card"}
      </button>
      <p className="mt-3 text-center text-xs text-ink/50">Already have a card? Verify the mobile number on your card to open it. Existing details and preferences are kept.</p>
    </form>
  );
}
