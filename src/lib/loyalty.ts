import { supabaseAdmin } from "./supabase/admin";
import { broadcastToCard } from "./realtime";
import { notifyCustomer } from "./notify";
import { tierFor } from "./brand";
import type { Brand, CardPayload, Customer, DoubleStampWindow, Reward } from "./types";

type AddStampsResult = { balance: number; added: number; minted: number; reward_ids: string[]; lifetime: number };

async function rpcAddStamps(args: {
  customerId: string;
  qty: number;
  source: string;
  outletId?: string | null;
  staffId?: string | null;
  multiplier?: number;
  note?: string | null;
  countsAsVisit?: boolean;
}): Promise<AddStampsResult> {
  const { data, error } = await supabaseAdmin().rpc("add_stamps", {
    p_customer_id: args.customerId,
    p_qty: args.qty,
    p_source: args.source,
    p_outlet_id: args.outletId ?? null,
    p_staff_id: args.staffId ?? null,
    p_multiplier: args.multiplier ?? 1,
    p_note: args.note ?? null,
    p_counts_as_visit: args.countsAsVisit ?? true,
  });
  if (error) throw new Error(error.message);
  return data as AddStampsResult;
}

export async function activeDoubleWindow(brandId: string, outletId?: string | null): Promise<DoubleStampWindow | null> {
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin()
    .from("double_stamp_windows")
    .select("*")
    .eq("brand_id", brandId)
    .lte("starts_at", now)
    .gte("ends_at", now)
    .order("multiplier", { ascending: false });
  const rows = (data ?? []) as DoubleStampWindow[];
  return rows.find((w) => !w.outlet_id || w.outlet_id === outletId) ?? null;
}

export type StampOutcome = {
  added: number;
  multiplier: number;
  balance: number;
  minted: number;
  bonuses: { source: "streak" | "referral"; qty: number; label: string }[];
  lifetime: number;
};

/** Staff gives stamps for bowls bought. Applies double-stamp windows, streaks and referral bonuses. */
export async function stampCustomer(opts: {
  brand: Brand;
  customer: Customer;
  qty: number;
  outletId: string | null;
  staffId: string;
}): Promise<StampOutcome> {
  const { brand, customer, outletId, staffId } = opts;
  const qty = Math.max(1, Math.min(opts.qty, brand.max_stamps_per_visit));
  const win = await activeDoubleWindow(brand.id, outletId);
  const multiplier = win?.multiplier ?? 1;

  const base = await rpcAddStamps({
    customerId: customer.id,
    qty,
    source: "staff",
    outletId,
    staffId,
    multiplier,
    note: win ? win.title : null,
  });

  const bonuses: StampOutcome["bonuses"] = [];
  let balance = base.balance;
  let minted = base.minted;
  let lifetime = base.lifetime;

  // Streak: came back within 4–14 days of the previous visit, and no streak bonus in the last 5 days
  if (brand.streak_enabled && customer.last_visit_at) {
    const daysSince = (Date.now() - new Date(customer.last_visit_at).getTime()) / 86400000;
    if (daysSince >= 4 && daysSince <= 14) {
      const since = new Date(Date.now() - 5 * 86400000).toISOString();
      const { count } = await supabaseAdmin()
        .from("stamps")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customer.id)
        .eq("source", "streak")
        .gte("created_at", since);
      if (!count) {
        const r = await rpcAddStamps({ customerId: customer.id, qty: 1, source: "streak", outletId, staffId, countsAsVisit: false, note: "Back within 2 weeks" });
        bonuses.push({ source: "streak", qty: 1, label: "Streak bonus — back within 2 weeks" });
        balance = r.balance; minted += r.minted; lifetime = r.lifetime;
      }
    }
  }

  // Referral: first real stamp for a referred customer rewards both sides
  if (brand.referral_enabled && customer.referred_by && !customer.referral_rewarded) {
    await supabaseAdmin().from("customers").update({ referral_rewarded: true }).eq("id", customer.id);
    const r = await rpcAddStamps({ customerId: customer.id, qty: 1, source: "referral", outletId, staffId, countsAsVisit: false, note: "Welcome via friend" });
    bonuses.push({ source: "referral", qty: 1, label: "Friend bonus" });
    balance = r.balance; minted += r.minted; lifetime = r.lifetime;
    try {
      const rr = await rpcAddStamps({ customerId: customer.referred_by, qty: 1, source: "referral", countsAsVisit: false, note: `Referred ${customer.name}` });
      const { data: referrer } = await supabaseAdmin().from("customers").select("*").eq("id", customer.referred_by).maybeSingle();
      if (referrer) {
        await broadcastToCard(referrer.id, "stamp", { added: 1, balance: rr.balance, minted: rr.minted, bonuses: [{ source: "referral", qty: 1, label: `${customer.name} joined with your code` }] });
        await notifyCustomer(referrer as Customer, brand.slug, {
          title: "Friend bonus!",
          body: `${customer.name} just used your code — a stamp has landed on your card.`,
          tag: "referral",
        }, "referral");
      }
    } catch {
      // referrer bonus is best-effort
    }
  }

  const outcome: StampOutcome = { added: base.added, multiplier, balance, minted, bonuses, lifetime };
  await broadcastToCard(customer.id, "stamp", { ...outcome });
  return outcome;
}

/** Credit stamps from an old physical card (once per customer, until brand.migration_until). */
export async function creditOldCard(opts: { brand: Brand; customer: Customer; qty: number; outletId: string | null; staffId: string }) {
  const { brand, customer, outletId, staffId } = opts;
  if (customer.migration_credited) throw new Error("Old card already credited for this customer");
  if (brand.migration_until && new Date(brand.migration_until) < new Date(new Date().toDateString())) {
    throw new Error("Old-card migration window has closed");
  }
  const qty = Math.max(1, Math.min(opts.qty, brand.migration_cap));
  await supabaseAdmin().from("customers").update({ migration_credited: true }).eq("id", customer.id);
  const r = await rpcAddStamps({ customerId: customer.id, qty, source: "migration", outletId, staffId, countsAsVisit: false, note: "Physical card credit" });
  await broadcastToCard(customer.id, "stamp", { added: qty, balance: r.balance, minted: r.minted, bonuses: [], multiplier: 1 });
  return r;
}

export async function redeemByCode(code: string, outletId: string | null, staffId: string) {
  const { data, error } = await supabaseAdmin().rpc("redeem_reward", { p_code: code, p_outlet_id: outletId, p_staff_id: staffId });
  if (error) throw new Error(error.message);
  const res = data as { ok: boolean; error?: string; reward_id?: string; customer_id?: string; title?: string };
  if (res.ok && res.customer_id) await broadcastToCard(res.customer_id, "redeemed", { reward_id: res.reward_id, title: res.title });
  return res;
}

/** The "spin after a stamp" game. Server decides the outcome; the client animates it. */
export async function spin(customer: Customer, brand: Brand) {
  if (!brand.spin_enabled || !customer.spin_available) return { ok: false as const, error: "No spin available" };
  const db = supabaseAdmin();
  // Claim the spin atomically so a double-tap can't spin twice
  const { data: claimed } = await db
    .from("customers")
    .update({ spin_available: false })
    .eq("id", customer.id)
    .eq("spin_available", true)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false as const, error: "No spin available" };
  const odds = Math.max(2, brand.spin_double_odds);
  const roll = Math.floor(Math.random() * odds); // 0..odds-1
  const won = roll === 0;
  let balance = customer.stamp_balance;
  let minted = 0;
  if (won) {
    const r = await rpcAddStamps({ customerId: customer.id, qty: 1, source: "spin", countsAsVisit: false, note: "Lucky spin" });
    balance = r.balance;
    minted = r.minted;
  }
  await db.from("events").insert({ brand_id: brand.id, customer_id: customer.id, type: "spin", meta: { won, roll, odds } });
  // Which wedge the wheel should stop on (8 wedges, wedge 0 = win)
  const wedge = won ? 0 : 1 + Math.floor(Math.random() * 7);
  return { ok: true as const, won, wedge, balance, minted };
}

export async function installBonus(customer: Customer, brand: Brand) {
  const db = supabaseAdmin();
  if (!customer.installed_at) await db.from("customers").update({ installed_at: new Date().toISOString() }).eq("id", customer.id);
  if (!brand.install_bonus_enabled || customer.install_bonus_given) return { given: false };
  const { data: claimed } = await db
    .from("customers")
    .update({ install_bonus_given: true })
    .eq("id", customer.id)
    .eq("install_bonus_given", false)
    .select("id")
    .maybeSingle();
  if (!claimed) return { given: false };
  const r = await rpcAddStamps({ customerId: customer.id, qty: 1, source: "install", countsAsVisit: false, note: "Saved to home screen" });
  await db.from("events").insert({ brand_id: brand.id, customer_id: customer.id, type: "install" });
  return { given: true, balance: r.balance, minted: r.minted };
}

/** Everything the card screen needs. */
export async function getCardPayload(customerId: string): Promise<CardPayload | null> {
  const db = supabaseAdmin();
  const { data: c } = await db.from("customers").select("*").eq("id", customerId).maybeSingle();
  if (!c) return null;
  const customer = c as Customer;
  const [{ data: b }, { data: rewards }, { data: stamps }, { data: grant }] = await Promise.all([
    db.from("brands").select("*").eq("id", customer.brand_id).maybeSingle(),
    db.from("rewards").select("id, code, type, title, status, expires_at, redeemed_at, unlock_condition")
      .eq("customer_id", customerId).order("issued_at", { ascending: false }).limit(30),
    db.from("stamps").select("id, qty, source, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(12),
    db.from("influencer_grants").select("id, status, content_due_date, deliverable, rewards_total, rewards_upfront, post_url")
      .eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!b) return null;
  const brand = b as Brand;
  // auto-expire stale rewards for display
  const now = Date.now();
  const rw = ((rewards ?? []) as CardPayload["rewards"]).map((r) =>
    r.status === "available" && r.expires_at && new Date(r.expires_at).getTime() < now ? { ...r, status: "expired" as const } : r
  );
  const win = await activeDoubleWindow(brand.id, null);
  return {
    brand: {
      slug: brand.slug, name: brand.name, tagline: brand.tagline, logo_url: brand.logo_url,
      primary_color: brand.primary_color, accent_color: brand.accent_color, stamps_per_reward: brand.stamps_per_reward,
      stamp_label: brand.stamp_label, reward_name: brand.reward_name, spin_enabled: brand.spin_enabled,
      referral_enabled: brand.referral_enabled, install_bonus_enabled: brand.install_bonus_enabled, tiers: brand.tiers,
    },
    customer: {
      id: customer.id, name: customer.name, phone: customer.phone, kind: customer.kind, stamp_balance: customer.stamp_balance,
      lifetime_stamps: customer.lifetime_stamps, visits: customer.visits, last_visit_at: customer.last_visit_at,
      referral_code: customer.referral_code, push_enabled_at: customer.push_enabled_at, telegram_chat_id: customer.telegram_chat_id,
      installed_at: customer.installed_at, spin_available: customer.spin_available, marketing_consent: customer.marketing_consent,
    },
    rewards: rw,
    recentStamps: (stamps ?? []) as CardPayload["recentStamps"],
    grant: (grant as CardPayload["grant"]) ?? null,
    activeDouble: win ? { title: win.title, ends_at: win.ends_at, multiplier: win.multiplier } : null,
    tier: tierFor(brand.tiers, customer.lifetime_stamps),
    telegramBot: process.env.TELEGRAM_BOT_USERNAME || null,
    vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null,
  };
}

/** Staff lookup after scanning a customer QR. */
export async function lookupForStaff(brandId: string, customerId: string) {
  const db = supabaseAdmin();
  const { data: c } = await db.from("customers").select("*").eq("id", customerId).eq("brand_id", brandId).maybeSingle();
  if (!c) return null;
  const customer = c as Customer;
  const { data: rewards } = await db
    .from("rewards")
    .select("*")
    .eq("customer_id", customerId)
    .in("status", ["available", "locked"])
    .order("issued_at", { ascending: true });
  const { data: brand } = await db.from("brands").select("*").eq("id", brandId).maybeSingle();
  const b = brand as Brand;
  const now = Date.now();
  const list = ((rewards ?? []) as Reward[]).filter((r) => !(r.expires_at && new Date(r.expires_at).getTime() < now));
  const migrationOpen = !customer.migration_credited && (!b.migration_until || new Date(b.migration_until) >= new Date(new Date().toDateString()));
  return {
    customer: {
      id: customer.id, name: customer.name, phone: customer.phone, kind: customer.kind, stamp_balance: customer.stamp_balance,
      lifetime_stamps: customer.lifetime_stamps, visits: customer.visits, last_visit_at: customer.last_visit_at,
      created_at: customer.created_at,
    },
    rewards: list.map((r) => ({ id: r.id, code: r.code, title: r.title, type: r.type, status: r.status, expires_at: r.expires_at })),
    migrationOpen,
    migrationCap: b.migration_cap,
    maxPerVisit: b.max_stamps_per_visit,
    stampsPerReward: b.stamps_per_reward,
    tier: tierFor(b.tiers, customer.lifetime_stamps).current.name,
    activeDouble: await activeDoubleWindow(brandId, null),
  };
}
