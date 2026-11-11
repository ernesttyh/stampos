import { supabaseAdmin } from "./supabase/admin";
import { notifyCustomer, recentlyNotified } from "./notify";
import { broadcastToCard } from "./realtime";
import type { Brand, Campaign, Customer } from "./types";

/** Customers who can receive something (push, Telegram, or opted-in WhatsApp) and have consented. */
function reachable(c: Customer) {
  return c.marketing_consent && (c.push_subscription || c.telegram_chat_id || c.whatsapp_opt_in);
}

export async function segmentCustomers(brand: Brand, segment: Campaign["segment"]): Promise<Customer[]> {
  const db = supabaseAdmin();
  let q = db.from("customers").select("*").eq("brand_id", brand.id).eq("marketing_consent", true);
  const now = Date.now();
  switch (segment) {
    case "near_reward":
      q = q.gte("stamp_balance", brand.stamps_per_reward - 2);
      break;
    case "lapsed_14":
      q = q.lt("last_visit_at", new Date(now - 14 * 86400000).toISOString());
      break;
    case "lapsed_30":
      q = q.lt("last_visit_at", new Date(now - 30 * 86400000).toISOString());
      break;
    case "influencers":
      q = q.eq("kind", "influencer");
      break;
    case "push_only":
      q = q.not("push_subscription", "is", null);
      break;
    case "telegram_only":
      q = q.not("telegram_chat_id", "is", null);
      break;
    default:
      break;
  }
  const { data } = await q.limit(5000);
  return ((data ?? []) as Customer[]).filter(reachable);
}

/** Send a campaign now. Returns audience/delivered counts. */
export async function sendCampaign(campaignId: string) {
  const db = supabaseAdmin();
  const { data: c } = await db.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (!c) throw new Error("Campaign not found");
  const campaign = c as Campaign;
  const { data: b } = await db.from("brands").select("*").eq("id", campaign.brand_id).maybeSingle();
  const brand = b as Brand;
  await db.from("campaigns").update({ status: "sending" }).eq("id", campaignId);
  const audience = await segmentCustomers(brand, campaign.segment);
  let delivered = 0;
  for (const cust of audience) {
    if (campaign.bonus_stamps > 0) {
      try {
        const { data: r } = await db.rpc("add_stamps", {
          p_customer_id: cust.id, p_qty: campaign.bonus_stamps, p_source: "campaign", p_outlet_id: null, p_staff_id: null,
          p_multiplier: 1, p_note: campaign.title, p_counts_as_visit: false,
        });
        const res = r as { balance: number; minted: number } | null;
        if (res) await broadcastToCard(cust.id, "stamp", { added: campaign.bonus_stamps, balance: res.balance, minted: res.minted, bonuses: [{ source: "campaign", qty: campaign.bonus_stamps, label: campaign.title }] });
      } catch {
        /* keep going */
      }
    }
    const ch = await notifyCustomer(cust, brand.slug, { title: campaign.title, body: campaign.body, urlPath: campaign.url_path ?? undefined, tag: `campaign-${campaignId}` }, "campaign", campaignId);
    if (ch) delivered++;
  }
  await db.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString(), audience: audience.length, delivered }).eq("id", campaignId);
  return { audience: audience.length, delivered };
}

/**
 * The daily automations. Safe to run as often as hourly — every trigger de-duplicates.
 * 1) near-reward  2) lapsed 14d (+ bonus stamp)  3) reward expiring in 7d  4) birthday reward  5) announce today's double-stamp windows
 */
export async function runNudges(brandId?: string) {
  const db = supabaseAdmin();
  const { data: brandsData } = brandId ? await db.from("brands").select("*").eq("id", brandId) : await db.from("brands").select("*");
  const summary: Record<string, Record<string, number>> = {};
  const now = Date.now();

  for (const b of (brandsData ?? []) as Brand[]) {
    const s = { near_reward: 0, lapsed: 0, expiring: 0, birthday: 0, double_stamp: 0, influencer_due: 0 };
    const { data: custData } = await db.from("customers").select("*").eq("brand_id", b.id).eq("marketing_consent", true).limit(10000);
    const customers = ((custData ?? []) as Customer[]).filter(reachable);

    for (const c of customers) {
      // 1) Near reward: 2 or fewer stamps away, visited in the last 45 days, once per 10 days
      const away = b.stamps_per_reward - c.stamp_balance;
      if (away > 0 && away <= 2 && c.last_visit_at && now - new Date(c.last_visit_at).getTime() > 2 * 86400000 && now - new Date(c.last_visit_at).getTime() < 45 * 86400000) {
        if (!(await recentlyNotified(c.id, "near_reward", 10))) {
          const ch = await notifyCustomer(c, b.slug, {
            title: away === 1 ? `1 ${b.stamp_label} away from a ${b.reward_name.toLowerCase()}` : `${away} ${b.stamp_label}s away from a ${b.reward_name.toLowerCase()}`,
            body: `You're so close, ${c.name.split(" ")[0]}. Your next visit does it.`,
            tag: "near_reward",
          }, "near_reward");
          if (ch) s.near_reward++;
          continue;
        }
      }

      // 2) Lapsed: no visit for 14–60 days, once per 21 days, with a bonus stamp attached
      if (c.last_visit_at) {
        const days = (now - new Date(c.last_visit_at).getTime()) / 86400000;
        if (days >= 14 && days <= 60 && !(await recentlyNotified(c.id, "lapsed", 21))) {
          const ch = await notifyCustomer(c, b.slug, {
            title: "We miss you — here's a stamp",
            body: `A bonus stamp just landed on your card. Come by this week and put it to use.`,
            tag: "lapsed",
          }, "lapsed");
          if (ch) {
            s.lapsed++;
            try {
              await db.rpc("add_stamps", { p_customer_id: c.id, p_qty: 1, p_source: "campaign", p_outlet_id: null, p_staff_id: null, p_multiplier: 1, p_note: "We miss you bonus", p_counts_as_visit: false });
            } catch {
              /* ignore */
            }
          }
          continue;
        }
      }

      // 3) Reward expiring within 7 days
      const { data: exp } = await db.from("rewards").select("id, title, expires_at").eq("customer_id", c.id).eq("status", "available")
        .gte("expires_at", new Date(now).toISOString()).lte("expires_at", new Date(now + 7 * 86400000).toISOString()).limit(1);
      if (exp && exp.length && !(await recentlyNotified(c.id, "expiring", 7))) {
        const ch = await notifyCustomer(c, b.slug, {
          title: `Your ${exp[0].title.toLowerCase()} expires soon`,
          body: `Use it by ${new Date(exp[0].expires_at).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}. Just show your QR at the counter.`,
          urlPath: "/rewards",
          tag: "expiring",
        }, "expiring");
        if (ch) s.expiring++;
        continue;
      }

      // 4) Birthday (same calendar day, SG time), once per year
      if (b.birthday_reward_enabled && c.birthday) {
        const sg = new Date(new Date().toLocaleString("en-US", { timeZone: b.timezone || "Asia/Singapore" }));
        const bd = new Date(c.birthday + "T00:00:00");
        if (bd.getMonth() === sg.getMonth() && bd.getDate() === sg.getDate() && c.birthday_reward_year !== sg.getFullYear()) {
          await db.from("customers").update({ birthday_reward_year: sg.getFullYear() }).eq("id", c.id);
          await db.from("rewards").insert({ brand_id: b.id, customer_id: c.id, type: "birthday", title: `Birthday ${b.reward_name.toLowerCase()}`, expires_at: new Date(now + 30 * 86400000).toISOString() });
          const ch = await notifyCustomer(c, b.slug, { title: `Happy birthday, ${c.name.split(" ")[0]}!`, body: `A birthday ${b.reward_name.toLowerCase()} is on your card. Valid 30 days.`, urlPath: "/rewards", tag: "birthday" }, "birthday");
          if (ch) s.birthday++;
        }
      }
    }

    // 5) Announce double-stamp windows starting within the next 8 hours (once per window)
    const { data: wins } = await db.from("double_stamp_windows").select("*").eq("brand_id", b.id).eq("announced", false)
      .gte("starts_at", new Date(now - 3600000).toISOString()).lte("starts_at", new Date(now + 8 * 3600000).toISOString());
    for (const w of wins ?? []) {
      await db.from("double_stamp_windows").update({ announced: true }).eq("id", w.id);
      const start = new Date(w.starts_at).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });
      const end = new Date(w.ends_at).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });
      for (const c of customers) {
        const ch = await notifyCustomer(c, b.slug, { title: `${w.multiplier}× stamps today`, body: `${w.title}: every ${b.stamp_label} earns ${w.multiplier} stamps from ${start} to ${end}.`, tag: `double-${w.id}` }, "double_stamp");
        if (ch) s.double_stamp++;
      }
    }

    // 6) Creators whose content is due in 3 days and not yet posted
    const { data: due } = await db.from("influencer_grants").select("*, customer:customers(*)").eq("brand_id", b.id).eq("status", "accepted")
      .gte("content_due_date", new Date(now).toISOString().slice(0, 10)).lte("content_due_date", new Date(now + 3 * 86400000).toISOString().slice(0, 10));
    for (const g of (due ?? []) as unknown as { id: string; customer: Customer | null; content_due_date: string }[]) {
      if (!g.customer || (await recentlyNotified(g.customer.id, "influencer_due", 3))) continue;
      const ch = await notifyCustomer(g.customer, b.slug, { title: "Your post is due soon", body: `Reminder: your content is due ${new Date(g.content_due_date).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}. The rest of your bowls unlock once it's live.`, urlPath: "/rewards", tag: "influencer_due" }, "influencer_due");
      if (ch) s.influencer_due++;
    }

    // Expire stale rewards
    await db.from("rewards").update({ status: "expired" }).eq("brand_id", b.id).eq("status", "available").lt("expires_at", new Date(now).toISOString());

    summary[b.slug] = s;
  }
  return summary;
}
