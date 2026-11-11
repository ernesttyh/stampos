import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBrand } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { prettyPhone } from "@/lib/phone";
import { tierFor } from "@/lib/brand";
import { manualStamp, saveCustomerNote, issueManualReward } from "@/app/admin/actions";
import type { Customer, Reward, Stamp } from "@/lib/types";
import { randomUUID } from "node:crypto";

export default async function CustomerDetail({ params }: { params: Promise<{ brand: string; id: string }> }) {
  const { brand: slug, id } = await params;
  const { brand, user } = await requireBrand(slug);
  const canWrite = user.isPlatformAdmin || ["owner", "manager"].includes(user.brandRoles[brand.id]);
  const db = supabaseAdmin();
  const { data: c } = await db.from("customers").select("*").eq("id", id).eq("brand_id", brand.id).maybeSingle();
  if (!c) notFound();
  const cust = c as Customer;
  const [{ data: stamps }, { data: rewards }, { data: notes }] = await Promise.all([
    db.from("stamps").select("*").eq("customer_id", id).order("created_at", { ascending: false }).limit(50),
    db.from("rewards").select("*").eq("customer_id", id).order("issued_at", { ascending: false }),
    db.from("notifications").select("trigger, channel, status, sent_at").eq("customer_id", id).order("sent_at", { ascending: false }).limit(20),
  ]);
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
  const tier = tierFor(brand.tiers, cust.lifetime_stamps);

  return (
    <div>
      <Link href={`/admin/${slug}/customers`} className="text-sm text-ink/50">← Customers</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">{cust.name}</h1>
          <p className="text-sm text-ink/60">{prettyPhone(cust.phone)} · {tier.current.name} · joined {fmt(cust.created_at)}{cust.kind === "influencer" ? " · creator" : ""}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-extrabold">{cust.stamp_balance}<span className="text-base text-ink/40">/{brand.stamps_per_reward}</span></p>
          <p className="text-xs text-ink/50">{cust.lifetime_stamps} lifetime · {cust.visits} visits</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="adm-card lg:col-span-2">
          <p className="font-display font-bold">Stamp history</p>
          <table className="adm-table mt-2">
            <thead><tr><th>When</th><th>Qty</th><th>Source</th><th>Note</th></tr></thead>
            <tbody>
              {((stamps ?? []) as Stamp[]).map((s) => (
                <tr key={s.id}><td>{fmt(s.created_at)}</td><td>+{s.qty}{s.multiplier > 1 ? ` (${s.multiplier}×)` : ""}</td><td>{s.source}</td><td className="text-ink/60">{s.note ?? ""}</td></tr>
              ))}
              {(stamps ?? []).length === 0 && <tr><td colSpan={4} className="py-4 text-ink/50">No stamps yet.</td></tr>}
            </tbody>
          </table>
          <p className="mt-6 font-display font-bold">Rewards</p>
          <table className="adm-table mt-2">
            <thead><tr><th>Reward</th><th>Status</th><th>Code</th><th>Expires</th><th>Redeemed</th></tr></thead>
            <tbody>
              {((rewards ?? []) as Reward[]).map((r) => (
                <tr key={r.id}><td>{r.title} <span className="text-xs text-ink/50">({r.type})</span></td><td>{r.status}</td><td className="font-mono text-xs">{r.code}</td><td>{fmt(r.expires_at)}</td><td>{fmt(r.redeemed_at)}</td></tr>
              ))}
              {(rewards ?? []).length === 0 && <tr><td colSpan={5} className="py-4 text-ink/50">No rewards yet.</td></tr>}
            </tbody>
          </table>
          <p className="mt-6 font-display font-bold">Nudges sent</p>
          <ul className="mt-2 text-sm text-ink/70">
            {(notes ?? []).map((n, i) => <li key={i}>{fmt(n.sent_at)} · {n.trigger} via {n.channel} · {n.status}</li>)}
            {(notes ?? []).length === 0 && <li className="text-ink/50">None yet.</li>}
          </ul>
        </div>
        <fieldset disabled={!canWrite} className="min-w-0 space-y-4 disabled:opacity-60">
          {!canWrite && <p className="text-sm">View-only access. Changes are disabled.</p>}
          <form action={manualStamp.bind(null, slug, cust.id)} className="adm-card space-y-2">
            <input type="hidden" name="request_id" value={randomUUID()} />
            <p className="font-display font-bold">Add stamps manually</p>
            <input name="qty" type="number" min={1} max={20} defaultValue={1} className="adm-input" />
            <input name="note" placeholder="Reason (shown in history)" required maxLength={120} className="adm-input" />
            <button className="adm-btn-brand w-full">Add</button>
          </form>
          <form action={issueManualReward.bind(null, slug, cust.id)} className="adm-card space-y-2">
            <input type="hidden" name="request_id" value={randomUUID()} />
            <p className="font-display font-bold">Issue a reward</p>
            <input name="title" defaultValue={brand.reward_name} className="adm-input" />
            <label className="label">Valid for (days)</label>
            <input name="days" type="number" min={1} max={365} defaultValue={30} className="adm-input" />
            <button className="adm-btn-ghost w-full">Issue</button>
          </form>
          <form action={saveCustomerNote.bind(null, slug, cust.id)} className="adm-card space-y-2">
            <p className="font-display font-bold">Notes</p>
            <textarea name="notes" defaultValue={cust.notes ?? ""} rows={4} className="adm-input" placeholder="Anything staff should know" />
            <button className="adm-btn-ghost w-full">Save note</button>
          </form>
          <div className="adm-card text-xs text-ink/60">
            <p>Referral code <span className="font-mono">{cust.referral_code}</span></p>
            <p className="mt-1">Marketing consent: {cust.marketing_consent ? "yes" : "no"}</p>
            <p>Push: {cust.push_subscription ? "on" : "off"} · Telegram: {cust.telegram_chat_id ? "linked" : "—"} · Home screen: {cust.installed_at ? "yes" : "no"}</p>
            {cust.birthday && <p>Birthday: {cust.birthday}</p>}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
