import Link from "next/link";
import { requireBrand } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/brand";
import { BarChart } from "@/components/admin/BarChart";
import type { BrandStats } from "@/lib/types";

export default async function Overview({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const { brand } = await requireBrand(slug);
  const { data } = await supabaseAdmin().rpc("brand_stats", { p_brand_id: brand.id });
  const s = (data ?? {}) as BrandStats;
  const redemption = s.rewards_issued ? Math.round((s.rewards_redeemed / s.rewards_issued) * 100) : 0;
  const reach = s.customers ? Math.round(((s.push_opt_in + s.telegram_linked) / s.customers) * 100) : 0;
  const returning = s.active_30d ? Math.round((s.returning_30d / s.active_30d) * 100) : 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">{brand.name}</h1>
          <p className="text-sm text-ink/60">Last 30 days at a glance</p>
        </div>
        <div className="flex gap-2 text-sm">
          <a className="adm-btn-ghost" href={`/${brand.slug}/join`} target="_blank" rel="noreferrer">Customer card ↗</a>
          <a className="adm-btn-ghost" href={`/${brand.slug}/staff`} target="_blank" rel="noreferrer">Staff scanner ↗</a>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Members" value={s.customers ?? 0} sub={`+${s.signups_7d ?? 0} this week`} />
        <Tile label="Stamps today" value={s.stamps_today ?? 0} sub={`${s.stamps_7d ?? 0} this week`} />
        <Tile label="Came back (30d)" value={`${returning}%`} sub={`${s.returning_30d ?? 0} of ${s.active_30d ?? 0} active`} />
        <Tile label="Rewards redeemed" value={`${redemption}%`} sub={`${s.rewards_redeemed ?? 0} of ${s.rewards_issued ?? 0} issued`} />
        <Tile label="Reachable" value={`${reach}%`} sub={`${s.push_opt_in ?? 0} push · ${s.telegram_linked ?? 0} Telegram`} />
        <Tile label="On home screen" value={s.installed ?? 0} sub="saved the card" />
        <Tile label="Close to a reward" value={s.near_reward ?? 0} sub="≤ 2 stamps away" />
        <Tile label="Gone quiet" value={s.lapsed_14 ?? 0} sub="no visit in 14+ days" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="adm-card">
          <p className="font-display font-bold">Stamps per day</p>
          <div className="mt-2">
            <BarChart data={(s.daily ?? []).map((d) => ({ day: d.day, value: d.stamps }))} label="stamps" color={brand.primary_color} />
          </div>
        </div>
        <div className="adm-card">
          <p className="font-display font-bold">New members per day</p>
          <div className="mt-2">
            <BarChart data={(s.daily ?? []).map((d) => ({ day: d.day, value: d.signups }))} label="sign-ups" />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <QuickLink href={`/admin/${slug}/nudges`} title="Send a nudge" body={`${s.near_reward ?? 0} people are 2 stamps away. ${s.lapsed_14 ?? 0} haven't visited in two weeks.`} />
        <QuickLink href={`/admin/${slug}/creators`} title="Seed a creator" body={`${s.influencers ?? 0} creators on the programme. Create an invite link in a minute.`} />
        <QuickLink href={`/admin/${slug}/print`} title="Print the counter QR" body={`Customers join at ${appUrl(`/${slug}/join`)}.`} />
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="adm-card">
      <p className="text-xs text-ink/60">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold">{value}</p>
      {sub && <p className="text-xs text-ink/50">{sub}</p>}
    </div>
  );
}

function QuickLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="adm-card block hover:border-ink/30">
      <p className="font-display font-bold">{title}</p>
      <p className="mt-1 text-sm text-ink/60">{body}</p>
    </Link>
  );
}
