"use client";
import { useState } from "react";

export function PhoneVerification({ slug, phone, verified, onVerified }: { slug: string; phone: string; verified: boolean; onVerified: () => void }) {
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const codeRequested = Boolean(phone && sentTo && sentTo === phone);
  async function call(verify: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/card/otp/${verify ? "verify" : "request"}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, phone, code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Phone verification failed. Please try again.");
      if (verify) { onVerified(); setMessage("Mobile number verified."); }
      else { setSentTo(phone); setCode(""); setMessage("Code sent. Check your text messages."); }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 rounded-xl bg-white/70 p-3 text-sm">
    {verified ? <p>Mobile number verified.</p> : <>
      <button type="button" className="btn-ghost text-sm" disabled={busy || !phone} onClick={() => call(false)}>{busy ? "Please wait…" : codeRequested ? "Send a new code" : "Send verification code"}</button>
      {codeRequested && <div className="mt-3">
        <label className="label" htmlFor="phone-code">Text message code</label>
        <input id="phone-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={10} />
        <button type="button" className="btn-ghost mt-2" disabled={busy || code.length < 6} onClick={() => call(true)}>Verify code</button>
      </div>}
    </>}
    {message && !verified && <p className="mt-2" role="status">{message}</p>}
  </div>;
}
