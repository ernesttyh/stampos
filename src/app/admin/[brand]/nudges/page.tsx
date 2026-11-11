import { requireBrand } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createAndSendCampaign, sendDraftCampaign, createWindow, deleteWindow } from "@/app/admin/actions";
import type { Campaign, DoubleStampWindow, Outlet } from "@/lib/types";

export const maxDuration = 300;

export default async function Nudges({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const { brand } = await requireBrand(slug);
  const db = supabaseAdmin();
  const [{ data: campaigns }, { data: windows }, { data: outlets }, { data: log }] = await Promise.all([
    db.from("campaigns").select("*").eq("brand_id", brand.id).order("created_at", { ascending: false }).limit(30),
    db.from("double_stamp_windows").select("*").eq("brand_id", brand.id).gte("ends_at", new Date(Date.now() - 86400000).toISOString()).order("starts_at"),
    db.from("outlets").select("id, name").eq("brand_id", brand.id).eq("active", true),
    db.from("notifications").select("trigger, channel, status").eq("brand_id", brand.id).gte("sent_at", new Date(Date.now() - 30 * 86400000).toISOString()).limit(5000),
  ]);
  const counts: Record<string, number> = {};
  for (const n of log ?? []) if (n.status === "sent") counts[n.trigger] = (counts[n.trigger] ?? 0) + 1;
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
  const local = (d: Date) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 16); // SG local for datetime-local

  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold">Nudges</h1>
      <p className="text-sm text-ink/60">Automatic nudges run on a schedule; campaigns go out when you send them. Only people who ticked marketing consent are contacted.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="adm-card lg:col-span-2">
          <p className="font-display font-bold">Automatic nudges — last 30 days</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ["near_reward", "Close to a reward"], ["lapsed", "We miss you (+1 stamp)"], ["expiring", "Reward expiring"],
              ["birthday", "Birthday reward"], ["double_stamp", "Double-stamp announcement"], ["influencer_unlock", "Creator unlock"],
            ].map(([k, label]) => (
              <div key={k} className="rounded-xl bg-cream px-3 py-2">
                <p className="font-display text-xl font-extrabold">{counts[k] ?? 0}</p>
                <p className="text-xs text-ink/60">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink/50">Runs when your scheduler calls <code className="font-mono">/api/cron/nudges</code> (see README). Each person gets each nudge at most once per cool-down.</p>
        </div>

        <form action={createWindow.bind(null, slug)} className="adm-card space-y-2">
          <p className="font-display font-bold">Schedule double stamps</p>
          <input name="title" placeholder="Lunch double stamps" className="adm-input" />
          <label className="label">Starts (SG time)</label>
          <input name="starts_at" type="datetime-local" className="adm-input" required defaultValue={local(new Date(Date.now() + 86400000)).slice(0, 11) + "11:30"} />
          <label className="label">Ends</label>
          <input name="ends_at" type="datetime-local" className="adm-input" required defaultValue={local(new Date(Date.now() + 86400000)).slice(0, 11) + "14:30"} />
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Multiplier</label><input name="multiplier" type="number" min={2} max={5} defaultValue={2} className="adm-input" /></div>
            <div><label className="label">Outlet</label>
              <select name="outlet_id" className="adm-input"><option value="">All outlets</option>{((outlets ?? []) as Pick<Outlet, "id" | "name">[]).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          </div>
          <button className="adm-btn-brand w-full">Schedule</button>
          <p className="text-xs text-ink/50">Members get told automatically a few hours before it starts.</p>
        </form>
      </div>

      {(windows ?? []).length > 0 && (
        <div className="adm-card mt-4">
          <p className="font-display font-bold">Upcoming & recent windows</p>
          <table className="adm-table mt-2">
            <thead><tr><th>Title</th><th>Starts</th><th>Ends</th><th>Multiplier</th><th>Announced</th><th></th></tr></thead>
            <tbody>
              {((windows ?? []) as DoubleStampWindow[]).map((w) => (
                <tr key={w.id}>
                  <td>{w.title}</td><td>{fmt(w.starts_at)}</td><td>{fmt(w.ends_at)}</td><td>{w.multiplier}×</td><td>{w.announced ? "yes" : "not yet"}</td>
                  <td className="text-right"><form action={deleteWindow.bind(null, slug, w.id)}><button className="text-xs text-red-700 underline">Remove</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <form action={createAndSendCampaign.bind(null, slug)} className="adm-card space-y-2">
          <p className="font-display font-bold">Send a campaign</p>
          <input name="title" placeholder="New: Mapo tofu bowl" className="adm-input" required maxLength={60} />
          <textarea name="body" placeholder="Short and specific — one line is plenty." rows={3} className="adm-input" required maxLength={180} />
          <label className="label">Who</label>
          <select name="segment" className="adm-input">
            <option value="all">Everyone reachable</option>
            <option value="near_reward">Close to a reward (≤ 2 away)</option>
            <option value="lapsed_14">Gone quiet 14+ days</option>
            <option value="lapsed_30">Gone quiet 30+ days</option>
            <option value="influencers">Creators</option>
            <option value="push_only">Push subscribers only</option>
            <option value="telegram_only">Telegram only</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Bonus stamps</label><input name="bonus_stamps" type="number" min={0} max={5} defaultValue={0} className="adm-input" /></div>
            <div><label className="label">Opens</label><select name="url_path" className="adm-input"><option value="">My card</option><option value="/rewards">Rewards tab</option><option value="?tab=perks">Perks tab</option></select></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="send_now" defaultChecked /> Send now (untick to save as draft)</label>
          <button className="adm-btn-brand w-full">Send</button>
        </form>

        <div className="adm-card lg:col-span-2">
          <p className="font-display font-bold">Campaigns</p>
          <table className="adm-table mt-2">
            <thead><tr><th>Title</th><th>Who</th><th>Status</th><th>Reached</th><th>Sent</th><th></th></tr></thead>
            <tbody>
              {((campaigns ?? []) as Campaign[]).map((c) => (
                <tr key={c.id}>
                  <td><p className="font-medium">{c.title}</p><p className="text-xs text-ink/50">{c.body}</p></td>
                  <td className="text-xs">{c.segment}{c.bonus_stamps ? ` · +${c.bonus_stamps}` : ""}</td>
                  <td>{c.status}</td>
                  <td>{c.status === "sent" ? `${c.delivered}/${c.audience}` : "—"}</td>
                  <td className="text-xs text-ink/60">{fmt(c.sent_at)}</td>
                  <td className="text-right">{c.status === "draft" && <form action={sendDraftCampaign.bind(null, slug, c.id)}><button className="text-xs underline">Send now</button></form>}</td>
                </tr>
              ))}
              {(campaigns ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-ink/50">No campaigns yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
