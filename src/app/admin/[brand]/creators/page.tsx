import { requireBrand } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/brand";
import { createGrant, markGrantPosted, verifyGrantAction, cancelGrant } from "@/app/admin/actions";
import { CopyButton } from "@/components/admin/CopyButton";
import type { InfluencerGrant } from "@/lib/types";
import { randomUUID } from "node:crypto";
import { CreatorCreditForm } from "@/components/admin/CreatorCreditForm";

export default async function Creators({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const { brand, user } = await requireBrand(slug);
  const canWrite = user.isPlatformAdmin || ["owner", "manager"].includes(user.brandRoles[brand.id]);
  const { data, error } = await supabaseAdmin().from("influencer_grants").select("*, customer:customers(name, phone, visits)").eq("brand_id", brand.id).order("created_at", { ascending: false });
  if (error) throw new Error("Unable to load creator accounts. Please refresh.");
  const grants = (data ?? []) as (InfluencerGrant & { customer: { name: string; phone: string; visits: number } | null })[];
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-SG", { day: "numeric", month: "short" }) : "—");
  const badge: Record<string, string> = { invited: "bg-cream", accepted: "bg-blue-50 text-blue-800", posted: "bg-amber-50 text-amber-800", verified: "bg-green-50 text-green-800", expired: "bg-ink/5", cancelled: "bg-ink/5" };

  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold">Creators</h1>
      <p className="text-sm text-ink/60">Manage complimentary creator rewards and optional content-based invitations.</p>
      {!canWrite && <p className="mt-3 text-sm text-ink/60">Your account is view-only. Ask the brand owner to create or change rewards.</p>}
      {canWrite && <div className="mt-6"><CreatorCreditForm slug={slug} requestId={randomUUID()} validDays={brand.reward_valid_days} /></div>}

      <fieldset disabled={!canWrite} className="mt-6 grid min-w-0 gap-4 lg:grid-cols-3 disabled:opacity-75">
        <form action={createGrant.bind(null, slug)} className="adm-card space-y-2">
          <p className="font-display font-bold">Optional: content-based invite</p>
          <p className="text-xs text-ink/60">Separate from the four-bowl phone allocation above. This creates an additional deal; use only when intended.</p>
          <input name="handle" placeholder="@handle" className="adm-input" required />
          <div className="grid grid-cols-2 gap-2">
            <select name="platform" className="adm-input"><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="lemon8">Lemon8</option><option value="xiaohongshu">Xiaohongshu</option><option value="youtube">YouTube</option><option value="other">Other</option></select>
            <input name="followers" type="number" placeholder="Followers" className="adm-input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Free {brand.stamp_label}s</label><input name="rewards_total" type="number" min={1} max={20} defaultValue={4} className="adm-input" /></div>
            <div><label className="label">Unlocked on accept</label><input name="rewards_upfront" type="number" min={0} max={20} defaultValue={1} className="adm-input" /></div>
          </div>
          <label className="label">Content due</label>
          <input name="content_due_date" type="date" className="adm-input" defaultValue={new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)} />
          <input name="deliverable" defaultValue="1 Reel/TikTok + 1 Story, tagged, disclosed as gifted" className="adm-input" />
          <textarea name="agreement_text" rows={3} className="adm-input" placeholder={`Leave blank to use the brand default agreement`} />
          <button className="adm-btn-brand w-full">Create invite link</button>
        </form>

        <div className="adm-card lg:col-span-2 overflow-x-auto">
          <p className="font-display font-bold">Pipeline</p>
          <table className="adm-table mt-2">
            <thead><tr><th>Creator</th><th>Deal</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
            <tbody>
              {grants.map((g) => {
                const link = appUrl(`/${slug}/invite/${g.invite_code}`);
                return (
                  <tr key={g.id}>
                    <td>
                      <p className="font-medium">@{g.handle} <span className="text-xs text-ink/50">{g.platform}{g.followers ? ` · ${g.followers.toLocaleString()}` : ""}</span></p>
                      {g.customer && <p className="text-xs text-ink/60">{g.customer.name} · {g.customer.phone} · {g.customer.visits} visit{g.customer.visits === 1 ? "" : "s"}</p>}
                      {g.post_url && <a href={g.post_url} target="_blank" rel="noreferrer" className="text-xs underline">View post ↗</a>}
                    </td>
                    <td className="text-xs">{g.rewards_total} free · {g.rewards_upfront} upfront<br /><span className="text-ink/50">{g.deliverable}</span></td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge[g.status]}`}>{g.status}</span></td>
                    <td className="text-xs">{fmt(g.content_due_date)}</td>
                    <td className="space-y-1 text-xs">
                      {g.status === "invited" && <CopyButton text={link} label="Copy invite link" />}
                      {(g.status === "accepted" || g.status === "posted") && (
                        <form action={verifyGrantAction.bind(null, slug, g.id)} className="flex flex-col gap-1">
                          <input name="post_url" placeholder="Post URL" defaultValue={g.post_url ?? ""} className="adm-input !py-1" />
                          <input name="reach_notes" placeholder="Reach / notes" className="adm-input !py-1" />
                          <button className="adm-btn-brand !py-1">Verify & unlock</button>
                        </form>
                      )}
                      {g.status === "accepted" && (
                        <form action={markGrantPosted.bind(null, slug, g.id)} className="flex gap-1">
                          <input name="post_url" placeholder="Post URL" className="adm-input !py-1" />
                          <button className="adm-btn-ghost !py-1">Posted</button>
                        </form>
                      )}
                      {!["verified", "cancelled", "expired"].includes(g.status) && (
                        <form action={cancelGrant.bind(null, slug, g.id)}><button className="text-red-700 underline">Cancel</button></form>
                      )}
                      {g.status === "verified" && <span className="text-ink/50">Done {fmt(g.verified_at)}</span>}
                    </td>
                  </tr>
                );
              })}
              {grants.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-ink/50">No creators yet. Create an account by phone above, or use a content-based invite.</td></tr>}
            </tbody>
          </table>
        </div>
      </fieldset>
    </div>
  );
}
