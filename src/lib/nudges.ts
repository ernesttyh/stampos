import { supabaseAdmin } from "./supabase/admin";
import { notifyCustomer, recentlyNotified, type Nudge } from "./notify";
import type { Brand, Campaign, Customer, DoubleStampWindow } from "./types";

const BATCH = 25;
export const SINGAPORE_TIMEZONE = "Asia/Singapore";
export function singaporeDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SINGAPORE_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function singaporeTime(date: string) {
  return new Date(date).toLocaleTimeString("en-SG", { timeZone: SINGAPORE_TIMEZONE, hour: "numeric", minute: "2-digit" });
}
export function automaticNudgesEnabled() { return process.env.AUTOMATIC_NUDGES_ENABLED === "true"; }
function reachable(c: Customer) { return c.marketing_consent && Boolean(c.push_subscription || c.telegram_chat_id || c.whatsapp_opt_in); }
function check(error: { message: string } | null, context: string) { if (error) throw new Error(`${context}: ${error.message}`); }

/** Preview helper: keyset-paginated, no arbitrary 5,000-row truncation.
 * Dispatch uses the database snapshot instead, never an in-memory preview.
 */
export async function segmentCustomers(brand: Brand, segment: Campaign["segment"]): Promise<Customer[]> {
  const db = supabaseAdmin(); const all: Customer[] = []; let cursor: string | undefined;
  for (;;) {
    let q = db.from("customers").select("*").eq("brand_id", brand.id).eq("marketing_consent", true);
    if (segment === "near_reward") q = q.gte("stamp_balance", brand.stamps_per_reward - 2);
    if (segment === "lapsed_14" || segment === "lapsed_30") q = q.lt("last_visit_at", new Date(Date.now() - (segment === "lapsed_14" ? 14 : 30) * 86400000).toISOString());
    if (segment === "influencers") q = q.eq("kind", "influencer");
    if (segment === "push_only") q = q.not("push_subscription", "is", null);
    if (segment === "telegram_only") q = q.not("telegram_chat_id", "is", null);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q.order("id").limit(500);
    check(error, "Audience page");
    const page = (data ?? []) as Customer[];
    all.push(...page.filter(reachable));
    if (!page.length) break;
    cursor = page[page.length - 1].id;
  }
  return all;
}

export type CampaignProgress = { audience: number; accepted: number; delivered: number; pending: number; uncertain: number; status: string; errors: string[] };
/** Start/resume ONE bounded batch. Legacy `delivered` alias means API accepted.
 * Cron resumes pending rows; claimed/uncertain rows require manual reconciliation.
 */
export async function sendCampaign(campaignId: string, deadline = Date.now() + 45000): Promise<CampaignProgress> {
  const db = supabaseAdmin();
  const start = await db.rpc("messaging_start_campaign", { p_campaign_id: campaignId });
  check(start.error, "Campaign start");
  const campaign = start.data as Campaign;
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status !== "draft" && campaign.status !== "sending") {
    const uncertain = await db.from("messaging_campaign_recipients").select("customer_id", { count: "exact", head: true })
      .eq("campaign_id", campaignId).eq("status", "uncertain");
    check(uncertain.error, "Campaign paused recipient count");
    return { audience: campaign.audience, accepted: campaign.delivered, delivered: campaign.delivered, pending: 0,
      uncertain: uncertain.count ?? 0, status: campaign.status, errors: [] };
  }
  const brandResult = await db.from("brands").select("*").eq("id", campaign.brand_id).single();
  check(brandResult.error, "Campaign brand");
  const brand = brandResult.data as Brand;
  const errors: string[] = [];
  // Claim just-in-time, not 25 rows ahead: reaching the time budget must leave
  // unattempted recipients pending for the next manual/cron invocation.
  for (let processed = 0; processed < BATCH && Date.now() < deadline; processed++) {
    const batch = await db.rpc("messaging_campaign_batch", { p_campaign_id: campaignId, p_limit: 1 });
    check(batch.error, "Campaign batch claim");
    const id = (batch.data as string[] | null)?.[0]; if (!id) break;
    try {
      const r = await db.from("customers").select("*").eq("id", id).eq("brand_id", campaign.brand_id).maybeSingle();
      check(r.error, "Campaign recipient");
      const ch = r.data ? await notifyCustomer(r.data as Customer, brand.slug,
        { title: campaign.title, body: campaign.body, urlPath: campaign.url_path ?? undefined, tag: `campaign-${campaignId}` },
        "campaign", campaignId, { bonusStamps: campaign.bonus_stamps, bonusNote: campaign.title }) : null;
      const done = await db.from("messaging_campaign_recipients").update({ status: ch ? "accepted" : "skipped" })
        .eq("campaign_id", campaignId).eq("customer_id", id);
      check(done.error, "Campaign recipient outcome");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e); errors.push(message);
      const logged = await db.from("messaging_campaign_recipients").update({ error: message })
        .eq("campaign_id", campaignId).eq("customer_id", id);
      check(logged.error, "Campaign error audit");
      // Deliberately leave uncertain; never reset to pending or resend.
    }
  }
  const finished = await db.rpc("messaging_finish_campaign", { p_campaign_id: campaignId });
  check(finished.error, "Campaign progress");
  return { ...(finished.data as Omit<CampaignProgress, "errors">), errors };
}

/** Campaigns are explicitly admin-initiated, not automatic marketing reminders.
 * Resume up to four campaigns / 100 recipients per cron invocation.
 */
export async function resumeCampaigns(brandId?: string, deadline = Date.now() + 120000) {
  const db = supabaseAdmin();
  let q = db.from("campaigns").select("id").eq("status", "sending").order("id").limit(4);
  if (brandId) q = q.eq("brand_id", brandId);
  const r = await q; check(r.error, "Pending campaigns");
  const result: Record<string, CampaignProgress> = {};
  for (const c of r.data ?? []) {
    if (Date.now() >= deadline) break;
    result[c.id] = await sendCampaign(c.id, Math.min(deadline, Date.now() + 45000));
  }
  return result;
}

type Candidate = { trigger: string; nudge: Nudge; cooldown: number; key?: string; bonus?: number };
async function selectNudge(c: Customer, b: Brand, now: number): Promise<Candidate | null> {
  const db = supabaseAdmin(); const day = singaporeDay(new Date(now));
  // Entitlement issuance happened separately for ALL customers before selection.
  if (b.birthday_reward_enabled && c.birthday?.slice(5) === day.slice(5) && c.birthday_reward_year === Number(day.slice(0, 4))) {
    return { trigger: "birthday", cooldown: 1, key: `birthday:${c.id}:${day.slice(0, 4)}`,
      nudge: { title: `Happy birthday, ${c.name.split(" ")[0]}!`, body: `A birthday ${b.reward_name.toLowerCase()} is on your card. Valid 30 days.`, urlPath: "/rewards", tag: "birthday" } };
  }
  const away = b.stamps_per_reward - c.stamp_balance;
  const days = c.last_visit_at ? (now - new Date(c.last_visit_at).getTime()) / 86400000 : null;
  if (away > 0 && away <= 2 && days !== null && days > 2 && days < 45 && !(await recentlyNotified(c.id, "near_reward", 10))) {
    return { trigger: "near_reward", cooldown: 10, nudge: {
      title: `${away} ${b.stamp_label}${away === 1 ? "" : "s"} away from a ${b.reward_name.toLowerCase()}`,
      body: `You're so close, ${c.name.split(" ")[0]}. Your next visit does it.`, tag: "near_reward" } };
  }
  if (days !== null && days >= 14 && days <= 60 && !(await recentlyNotified(c.id, "lapsed", 21))) {
    return { trigger: "lapsed", cooldown: 21, bonus: 1, nudge: { title: "We miss you — here's a stamp",
      body: "A bonus stamp just landed on your card. Come by this week and put it to use.", tag: "lapsed" } };
  }
  const exp = await db.from("rewards").select("title,expires_at").eq("brand_id", b.id).eq("customer_id", c.id).eq("status", "available")
    .gte("expires_at", new Date(now).toISOString()).lte("expires_at", new Date(now + 7 * 86400000).toISOString()).order("expires_at").limit(1);
  check(exp.error, "Expiring rewards");
  if (exp.data?.length && !(await recentlyNotified(c.id, "expiring", 7))) return { trigger: "expiring", cooldown: 7,
    nudge: { title: `Your ${exp.data[0].title.toLowerCase()} expires soon`, body: `Use it by ${new Date(exp.data[0].expires_at).toLocaleDateString("en-SG", { timeZone: SINGAPORE_TIMEZONE, day: "numeric", month: "short" })}. Just show your QR at the counter.`, urlPath: "/rewards", tag: "expiring" } };
  const wins = await db.from("double_stamp_windows").select("*").eq("brand_id", b.id)
    .gte("starts_at", new Date(now - 3600000).toISOString()).lte("starts_at", new Date(now + 8 * 3600000).toISOString()).order("starts_at").limit(1);
  check(wins.error, "Double stamp windows");
  const w = wins.data?.[0] as DoubleStampWindow | undefined;
  if (w) return { trigger: "double_stamp", cooldown: 0, key: `double:${w.id}:${c.id}`, nudge: {
    title: `${w.multiplier}× stamps today`, body: `${w.title}: every ${b.stamp_label} earns ${w.multiplier} stamps from ${singaporeTime(w.starts_at)} to ${singaporeTime(w.ends_at)} (SG time).`, tag: `double-${w.id}` } };
  const due = await db.from("influencer_grants").select("id,content_due_date").eq("brand_id", b.id).eq("customer_id", c.id).eq("status", "accepted")
    .gte("content_due_date", day).lte("content_due_date", singaporeDay(new Date(now + 3 * 86400000))).order("content_due_date").limit(1);
  check(due.error, "Creator due reminders");
  if (due.data?.length && !(await recentlyNotified(c.id, "influencer_due", 3))) return { trigger: "influencer_due", cooldown: 3,
    key: `creator-due:${due.data[0].id}:${day}`, nudge: { title: "Your post is due soon", body: `Reminder: your content is due ${due.data[0].content_due_date} (SG date). The rest of your rewards unlock once it's live.`, urlPath: "/rewards", tag: "influencer_due" } };
  return null;
}

/** Defaults OFF until isolated end-to-end approval. Birthday ENTITLEMENTS and
 * stale-reward expiry still run with marketing disabled. Max 100 daily audience
 * items per invocation, 25 per brand; repeat cron calls drain durable snapshots.
 * Daily work claims are not reclaimed after crashes (conservative at-most-once).
 */
export async function runNudges(brandId?: string, deadline = Date.now() + 120000) {
  const db = supabaseAdmin(); const summary: Record<string, Record<string, number>> = {};
  let cursor: string | undefined; let budget = 100; const now = Date.now();
  for (;;) {
    let q = db.from("brands").select("*").order("id").limit(100);
    if (brandId) q = q.eq("id", brandId);
    if (cursor) q = q.gt("id", cursor);
    const r = await q; check(r.error, "Nudge brands"); const brands = (r.data ?? []) as Brand[];
    if (!brands.length) break;
    for (const b of brands) {
      const s: Record<string, number> = { near_reward: 0, lapsed: 0, expiring: 0, birthday: 0, double_stamp: 0, influencer_due: 0, errors: 0, processed: 0, automatic_enabled: automaticNudgesEnabled() ? 1 : 0 };
      const birthdays = await db.rpc("messaging_issue_birthdays", { p_brand_id: b.id });
      check(birthdays.error, "Birthday entitlement issuance"); s.birthday_rewards_issued = Number(birthdays.data ?? 0);
      if (automaticNudgesEnabled() && budget > 0) {
        for (let processed = 0; processed < BATCH && budget > 0 && Date.now() < deadline; processed++) {
          const batch = await db.rpc("messaging_auto_batch", { p_brand_id: b.id, p_limit: 1 });
          check(batch.error, "Daily audience claim");
          const id = (batch.data as string[] | null)?.[0]; if (!id) break;
          budget--; s.processed++;
          try {
            const current = await db.from("customers").select("*").eq("id", id).eq("brand_id", b.id).maybeSingle();
            check(current.error, "Daily recipient"); const c = current.data as Customer | null;
            if (!c || !reachable(c)) continue;
            const candidate = await selectNudge(c, b, now); if (!candidate) continue;
            const ch = await notifyCustomer(c, b.slug, candidate.nudge, candidate.trigger, undefined, {
              automatic: true, cooldownDays: candidate.cooldown, bonusStamps: candidate.bonus ?? 0,
              bonusNote: "We miss you bonus", operationKey: candidate.key ?? `auto:${c.id}:${singaporeDay()}`,
            });
            if (ch) s[candidate.trigger]++;
          } catch (e) {
            s.errors++;
            // Claims/audits retain uncertainty. Surface failures in cron results
            // and server logs; never silently treat them as a successful send.
            console.error("Automatic nudge paused for recipient", id, e);
          }
        }
      }
      const expired = await db.from("rewards").update({ status: "expired" }).eq("brand_id", b.id).eq("status", "available").lt("expires_at", new Date(now).toISOString());
      check(expired.error, "Reward expiry"); summary[b.slug] = s;
    }
    cursor = brands[brands.length - 1].id;
  }
  return summary;
}
