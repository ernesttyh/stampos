"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { requireAdmin, requireBrand } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendCampaign } from "@/lib/nudges";
import { verifyGrant } from "@/lib/customers";
import { broadcastToCard } from "@/lib/realtime";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string, d = 0) => {
  const n = Number(fd.get(k));
  return Number.isFinite(n) ? n : d;
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";

// ---------------------------------------------------------------- brands
export async function createBrand(fd: FormData) {
  const user = await requireAdmin();
  if (!user.isPlatformAdmin) throw new Error("Platform admins only");
  const db = supabaseAdmin();
  const slug = str(fd, "slug").toLowerCase();
  const { data: brand, error } = await db
    .from("brands")
    .insert({
      name: str(fd, "name"), slug, primary_color: str(fd, "primary_color") || "#C8102E", accent_color: str(fd, "accent_color") || "#F2B134",
      stamps_per_reward: num(fd, "stamps_per_reward", 10), reward_name: str(fd, "reward_name") || "Free item", stamp_label: str(fd, "stamp_label") || "item",
      migration_until: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    })
    .select("id")
    .single();
  if (error || !brand) throw new Error(error?.message || "Could not create brand");
  const outletName = str(fd, "outlet_name") || "Main outlet";
  await db.from("outlets").insert({ brand_id: brand.id, name: outletName });
  revalidatePath("/admin");
  redirect(`/admin/${slug}/settings`);
}

export async function updateBrand(slug: string, fd: FormData) {
  const { brand } = await requireBrand(slug);
  let tiers = brand.tiers;
  try {
    const parsed = JSON.parse(str(fd, "tiers") || "[]");
    if (Array.isArray(parsed)) tiers = parsed;
  } catch {
    /* keep existing */
  }
  await supabaseAdmin().from("brands").update({
    name: str(fd, "name") || brand.name,
    tagline: str(fd, "tagline") || null,
    primary_color: str(fd, "primary_color") || brand.primary_color,
    accent_color: str(fd, "accent_color") || brand.accent_color,
    stamps_per_reward: num(fd, "stamps_per_reward", brand.stamps_per_reward),
    stamp_label: str(fd, "stamp_label") || brand.stamp_label,
    reward_name: str(fd, "reward_name") || brand.reward_name,
    reward_valid_days: num(fd, "reward_valid_days", brand.reward_valid_days),
    max_stamps_per_visit: num(fd, "max_stamps_per_visit", brand.max_stamps_per_visit),
    migration_until: str(fd, "migration_until") || null,
    migration_cap: num(fd, "migration_cap", brand.migration_cap),
    spin_enabled: bool(fd, "spin_enabled"),
    spin_double_odds: num(fd, "spin_double_odds", brand.spin_double_odds),
    streak_enabled: bool(fd, "streak_enabled"),
    referral_enabled: bool(fd, "referral_enabled"),
    install_bonus_enabled: bool(fd, "install_bonus_enabled"),
    birthday_reward_enabled: bool(fd, "birthday_reward_enabled"),
    ugc_agreement: str(fd, "ugc_agreement") || null,
    pdpa_text: str(fd, "pdpa_text") || null,
    tiers,
  }).eq("id", brand.id);
  revalidatePath(`/admin/${slug}`);
}

// ---------------------------------------------------------------- outlets & staff
export async function addOutlet(slug: string, fd: FormData) {
  const { brand } = await requireBrand(slug);
  await supabaseAdmin().from("outlets").insert({ brand_id: brand.id, name: str(fd, "name"), address: str(fd, "address") || null });
  revalidatePath(`/admin/${slug}/settings`);
}

export async function toggleOutlet(slug: string, outletId: string, active: boolean) {
  const { brand } = await requireBrand(slug);
  await supabaseAdmin().from("outlets").update({ active }).eq("id", outletId).eq("brand_id", brand.id);
  revalidatePath(`/admin/${slug}/settings`);
}

export async function addStaff(slug: string, fd: FormData) {
  const { brand } = await requireBrand(slug);
  const pin = str(fd, "pin");
  if (!/^[0-9]{4,8}$/.test(pin)) throw new Error("PIN must be 4–8 digits");
  const outlet = str(fd, "outlet_id");
  await supabaseAdmin().from("staff").insert({
    brand_id: brand.id, name: str(fd, "name"), pin_hash: bcrypt.hashSync(pin, 10),
    role: str(fd, "role") === "manager" ? "manager" : "staff", outlet_id: outlet || null,
  });
  revalidatePath(`/admin/${slug}/settings`);
}

export async function removeStaff(slug: string, staffId: string) {
  const { brand } = await requireBrand(slug);
  await supabaseAdmin().from("staff").update({ active: false }).eq("id", staffId).eq("brand_id", brand.id);
  revalidatePath(`/admin/${slug}/settings`);
}

// ---------------------------------------------------------------- customers
export async function manualStamp(slug: string, customerId: string, fd: FormData) {
  const { brand } = await requireBrand(slug);
  const qty = Math.max(1, Math.min(num(fd, "qty", 1), 20));
  const db = supabaseAdmin();
  const { data: c } = await db.from("customers").select("id").eq("id", customerId).eq("brand_id", brand.id).maybeSingle();
  if (!c) throw new Error("Customer not found");
  const { data } = await db.rpc("add_stamps", {
    p_customer_id: customerId, p_qty: qty, p_source: "admin", p_outlet_id: null, p_staff_id: null, p_multiplier: 1,
    p_note: str(fd, "note") || "Added by admin", p_counts_as_visit: false,
  });
  const r = data as { balance: number; minted: number } | null;
  if (r) await broadcastToCard(customerId, "stamp", { added: qty, balance: r.balance, minted: r.minted, bonuses: [] });
  revalidatePath(`/admin/${slug}/customers/${customerId}`);
}

export async function saveCustomerNote(slug: string, customerId: string, fd: FormData) {
  const { brand } = await requireBrand(slug);
  await supabaseAdmin().from("customers").update({ notes: str(fd, "notes") || null }).eq("id", customerId).eq("brand_id", brand.id);
  revalidatePath(`/admin/${slug}/customers/${customerId}`);
}

export async function issueManualReward(slug: string, customerId: string, fd: FormData) {
  const { brand } = await requireBrand(slug);
  await supabaseAdmin().from("rewards").insert({
    brand_id: brand.id, customer_id: customerId, type: "manual", title: str(fd, "title") || brand.reward_name,
    expires_at: new Date(Date.now() + num(fd, "days", 30) * 86400000).toISOString(),
  });
  await broadcastToCard(customerId, "redeemed", {});
  revalidatePath(`/admin/${slug}/customers/${customerId}`);
}

// ---------------------------------------------------------------- campaigns & windows
export async function createAndSendCampaign(slug: string, fd: FormData) {
  const { brand, user } = await requireBrand(slug);
  const db = supabaseAdmin();
  const { data: c, error } = await db.from("campaigns").insert({
    brand_id: brand.id, title: str(fd, "title"), body: str(fd, "body"), url_path: str(fd, "url_path") || null,
    segment: str(fd, "segment") || "all", bonus_stamps: Math.max(0, Math.min(num(fd, "bonus_stamps", 0), 5)), created_by: user.id,
    status: "draft",
  }).select("id").single();
  if (error || !c) throw new Error(error?.message || "Could not create campaign");
  if (str(fd, "send_now") === "on") {
    try {
      await sendCampaign(c.id);
    } catch (e) {
      await db.from("campaigns").update({ status: "failed" }).eq("id", c.id);
      throw e;
    }
  }
  revalidatePath(`/admin/${slug}/nudges`);
}

export async function sendDraftCampaign(slug: string, campaignId: string) {
  const { brand } = await requireBrand(slug);
  const { data } = await supabaseAdmin().from("campaigns").select("id").eq("id", campaignId).eq("brand_id", brand.id).maybeSingle();
  if (!data) throw new Error("Campaign not found");
  await sendCampaign(campaignId);
  revalidatePath(`/admin/${slug}/nudges`);
}

export async function createWindow(slug: string, fd: FormData) {
  const { brand } = await requireBrand(slug);
  const starts = str(fd, "starts_at");
  const ends = str(fd, "ends_at");
  if (!starts || !ends) throw new Error("Start and end required");
  // datetime-local values are in the admin's local time; store as SG time by appending the offset
  const tz = "+08:00";
  await supabaseAdmin().from("double_stamp_windows").insert({
    brand_id: brand.id, outlet_id: str(fd, "outlet_id") || null, title: str(fd, "title") || "Double stamp hours",
    starts_at: `${starts}:00${tz}`, ends_at: `${ends}:00${tz}`, multiplier: Math.max(2, Math.min(num(fd, "multiplier", 2), 5)),
  });
  revalidatePath(`/admin/${slug}/nudges`);
}

export async function deleteWindow(slug: string, id: string) {
  const { brand } = await requireBrand(slug);
  await supabaseAdmin().from("double_stamp_windows").delete().eq("id", id).eq("brand_id", brand.id);
  revalidatePath(`/admin/${slug}/nudges`);
}

// ---------------------------------------------------------------- creators
export async function createGrant(slug: string, fd: FormData) {
  const { brand, user } = await requireBrand(slug);
  const total = Math.max(1, Math.min(num(fd, "rewards_total", 4), 20));
  const upfront = Math.max(0, Math.min(num(fd, "rewards_upfront", 1), total));
  await supabaseAdmin().from("influencer_grants").insert({
    brand_id: brand.id, handle: str(fd, "handle").replace(/^@/, ""), platform: str(fd, "platform") || "instagram",
    followers: num(fd, "followers") || null, rewards_total: total, rewards_upfront: upfront,
    reward_title: str(fd, "reward_title") || `${brand.reward_name} (creator)`, content_due_date: str(fd, "content_due_date") || null,
    deliverable: str(fd, "deliverable") || "1 Reel/TikTok + 1 Story, tagged, disclosed as gifted",
    agreement_text: str(fd, "agreement_text") || null, created_by: user.id,
  });
  revalidatePath(`/admin/${slug}/creators`);
}

export async function markGrantPosted(slug: string, grantId: string, fd: FormData) {
  const { brand } = await requireBrand(slug);
  await supabaseAdmin().from("influencer_grants").update({ status: "posted", post_url: str(fd, "post_url") || null, posted_at: new Date().toISOString() })
    .eq("id", grantId).eq("brand_id", brand.id);
  revalidatePath(`/admin/${slug}/creators`);
}

export async function verifyGrantAction(slug: string, grantId: string, fd: FormData) {
  const { brand } = await requireBrand(slug);
  const { data } = await supabaseAdmin().from("influencer_grants").select("id").eq("id", grantId).eq("brand_id", brand.id).maybeSingle();
  if (!data) throw new Error("Grant not found");
  await verifyGrant(grantId, str(fd, "post_url") || null, str(fd, "reach_notes") || null);
  revalidatePath(`/admin/${slug}/creators`);
}

export async function cancelGrant(slug: string, grantId: string) {
  const { brand } = await requireBrand(slug);
  const db = supabaseAdmin();
  await db.from("influencer_grants").update({ status: "cancelled" }).eq("id", grantId).eq("brand_id", brand.id);
  await db.from("rewards").update({ status: "void" }).eq("grant_id", grantId).in("status", ["available", "locked"]);
  revalidatePath(`/admin/${slug}/creators`);
}
