import { supabaseAdmin } from "./supabase/admin";
import { broadcastToCard } from "./realtime";
import { notifyCustomer } from "./notify";
import { tierFor } from "./brand";
import type { Brand, CardPayload, Customer, DoubleStampWindow, Reward } from "./types";

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
  if (!Number.isSafeInteger(opts.qty) || opts.qty < 1) throw new Error("Quantity must be a positive whole number");
  const { data, error } = await supabaseAdmin().rpc("staff_issue_stamps", {
    p_customer_id: customer.id, p_qty: opts.qty, p_outlet_id: outletId, p_staff_id: staffId, p_mode: "staff",
  });
  if (error) throw new Error(error.message);
  const result = data as StampOutcome & { referrer_id?: string; referrer_result?: { balance: number; minted: number } };
  const { added, multiplier, balance, minted, bonuses, lifetime } = result;
  const outcome: StampOutcome = { added, multiplier, balance, minted, bonuses, lifetime };
  // Delivery failures must not turn an already committed award into an apparent failed write.
  await broadcastToCard(customer.id, "stamp", { ...outcome }).catch(() => undefined);
  if (result.referrer_id && result.referrer_result) {
    const id = result.referrer_id;
    const rr = result.referrer_result;
    await broadcastToCard(id, "stamp", { added: 1, balance: rr.balance, minted: rr.minted,
      bonuses: [{ source: "referral", qty: 1, label: `${customer.name} joined with your code` }] }).catch(() => undefined);
    try {
      const { data: referrer } = await supabaseAdmin().from("customers").select("*").eq("id", id).eq("brand_id", brand.id).maybeSingle();
      if (referrer) await notifyCustomer(referrer as Customer, brand.slug, {
        title: "Friend bonus!", body: `${customer.name} just used your code — a stamp has landed on your card.`, tag: "referral",
      }, "referral");
    } catch { /* Notifications are best effort; the transactional credit already succeeded. */ }
  }
  return outcome;
}

/** Credit stamps from an old physical card (once per customer, until brand.migration_until). */
export async function creditOldCard(opts: { brand: Brand; customer: Customer; qty: number; outletId: string | null; staffId: string }) {
  const { customer, outletId, staffId } = opts;
  if (!Number.isSafeInteger(opts.qty) || opts.qty < 1) throw new Error("Quantity must be a positive whole number");
  const { data, error } = await supabaseAdmin().rpc("staff_issue_stamps", {
    p_customer_id: customer.id, p_qty: opts.qty, p_outlet_id: outletId, p_staff_id: staffId, p_mode: "migration",
  });
  if (error) throw new Error(error.message);
  const r = data as StampOutcome;
  await broadcastToCard(customer.id, "stamp", { ...r }).catch(() => undefined);
  return r;
}

export async function redeemByCode(code: string, outletId: string | null, staffId: string) {
  const { data, error } = await supabaseAdmin().rpc("redeem_reward", { p_code: code, p_outlet_id: outletId, p_staff_id: staffId });
  if (error) throw new Error(error.message);
  const res = data as { ok: boolean; error?: string; reward_id?: string; customer_id?: string; title?: string };
  if (res.ok && res.customer_id) await broadcastToCard(res.customer_id, "redeemed", { reward_id: res.reward_id, title: res.title }).catch(() => undefined);
  return res;
}

/** The "spin after a stamp" game. Server decides the outcome; the client animates it. */
export async function spin(customer: Customer, brand: Brand) {
  if (customer.brand_id !== brand.id) throw new Error("Customer brand mismatch");
  const { data, error } = await supabaseAdmin().rpc("claim_customer_bonus", { p_customer_id: customer.id, p_kind: "spin" });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; error?: string; won?: boolean; wedge?: number; balance?: number; minted?: number };
}

export async function installBonus(customer: Customer, brand: Brand) {
  if (customer.brand_id !== brand.id) throw new Error("Customer brand mismatch");
  const { data, error } = await supabaseAdmin().rpc("claim_customer_bonus", { p_customer_id: customer.id, p_kind: "install" });
  if (error) throw new Error(error.message);
  return data as { given: boolean; balance?: number; minted?: number };
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
