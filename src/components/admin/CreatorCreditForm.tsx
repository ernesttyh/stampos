"use client";
import Link from "next/link";
import { useActionState } from "react";
import { creditCreatorAccount, type CreatorCreditState } from "@/app/admin/actions";

export function CreatorCreditForm({ slug, requestId, validDays }: { slug: string; requestId: string; validDays: number }) {
  const initial: CreatorCreditState = { ok: false, message: "" };
  const [state, action, pending] = useActionState(creditCreatorAccount.bind(null, slug), initial);
  return <form action={action} className="adm-card space-y-3">
    <h2 className="font-display text-lg font-bold">Create creator account · 4 complimentary bowls</h2>
    <p className="text-sm text-ink/65">Add their mobile number. All four rewards are available immediately—there is no content-unlock condition for this allocation. Each bowl is redeemed separately by staff. Rewards follow the programme's current validity: {validDays} days from credit.</p>
    <input type="hidden" name="request_id" value={requestId} />
    <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2 disabled:opacity-60">
      <label className="label">Creator name<input name="name" autoComplete="name" minLength={2} maxLength={60} required className="adm-input mt-1" /></label>
      <label className="label">Mobile number<input name="phone" type="tel" autoComplete="tel" placeholder="+65 9123 4567" required className="adm-input mt-1" /><span className="text-xs font-normal text-ink/60">Singapore numbers may be entered without +65.</span></label>
      <label className="label">Social handle<input name="handle" placeholder="@creator" maxLength={100} required className="adm-input mt-1" /></label>
      <label className="label">Platform<select name="platform" className="adm-input mt-1"><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="lemon8">Lemon8</option><option value="xiaohongshu">Xiaohongshu</option><option value="youtube">YouTube</option><option value="other">Other</option></select></label>
      <p className="text-xs text-ink/60 sm:col-span-2">An existing account with this phone is reused without replacing its name, balances or consent. A phone that already received this allocation will not receive four more. No SMS or marketing message is sent by this form. The creator must verify ownership of their phone before opening the card.</p>
      <button disabled={pending} className="adm-btn-brand sm:col-span-2" aria-busy={pending}>{pending ? "Saving and checking rewards…" : "Create account & credit 4 bowls"}</button>
    </fieldset>
    {state.message && <div role={state.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${state.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>
      <p>{state.message}</p>
      {state.ok && state.customerId && <Link className="mt-2 inline-block font-semibold underline" href={`/admin/${slug}/customers/${state.customerId}`}>View account and reward history →</Link>}
    </div>}
  </form>;
}
