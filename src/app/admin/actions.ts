"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { requireAdmin, requireBrand } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendCampaign } from "@/lib/nudges";
import { verifyGrant } from "@/lib/customers";
import { broadcastToCard } from "@/lib/realtime";
import { normalisePhone } from "@/lib/phone";
import { hexColor, integer, requiredText, uuid, webUrl } from "@/lib/validation";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string, d: number, min: number, max: number) => integer(fd.has(k) ? fd.get(k) : d, min, max, k.replaceAll("_", " "));
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
function checked(result: { error: { message: string } | null }, context: string) {
  if (result.error) {
    console.error(`StampOS ${context}`, result.error.message);
    throw new Error(`Could not ${context}. No success has been confirmed. Please refresh and check before trying again.`);
  }
}
async function ownCustomer(brandId: string, customerId: string) {
  const r = await supabaseAdmin().from("customers").select("id").eq("id", uuid(customerId)).eq("brand_id", brandId).maybeSingle();
  checked(r, "check customer");
  if (!r.data) throw new Error("Customer not found for this brand.");
}
async function ownOutlet(brandId: string, outletId: string) {
  const r = await supabaseAdmin().from("outlets").select("id").eq("id", uuid(outletId)).eq("brand_id", brandId).eq("active", true).maybeSingle();
  checked(r, "check outlet");
  if (!r.data) throw new Error("Please choose an active outlet for this brand.");
}

export async function createBrand(fd: FormData) {
  const user = await requireAdmin();
  if (!user.isPlatformAdmin) throw new Error("Platform admins only.");
  const slug = str(fd, "slug").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60 || ["admin", "api"].includes(slug)) throw new Error("Please choose a valid brand address.");
  const r = await supabaseAdmin().from("brands").insert({
    name: requiredText(fd.get("name"), "Brand name"), slug,
    primary_color: hexColor(str(fd, "primary_color") || "#C8102E"), accent_color: hexColor(str(fd, "accent_color") || "#F2B134"),
    stamps_per_reward: num(fd, "stamps_per_reward", 10, 3, 30), reward_name: str(fd, "reward_name") || "Free item", stamp_label: str(fd, "stamp_label") || "item",
    migration_until: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
  }).select("id").single();
  checked(r, "create brand");
  if (!r.data) throw new Error("Brand creation was not confirmed.");
  const outlet = await supabaseAdmin().from("outlets").insert({ brand_id: r.data.id, name: str(fd, "outlet_name") || "Main outlet" });
  checked(outlet, "create the initial outlet (the brand is saved; add its outlet in Settings)");
  revalidatePath("/admin");
  redirect(`/admin/${slug}/settings`);
}

export async function updateBrand(slug: string, fd: FormData) {
  const { brand } = await requireBrand(slug, "owner");
  let tiers: unknown;
  try { tiers = JSON.parse(str(fd, "tiers") || "[]"); } catch { throw new Error("The levels are not valid JSON. Nothing was saved."); }
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 20 || tiers.some((t) => typeof t.name !== "string" || !t.name.trim() || !Number.isSafeInteger(t.min) || t.min < 0 || typeof t.perk !== "string")) throw new Error("Each level needs a name, whole-number minimum and perk.");
  if (tiers[0].min !== 0 || tiers.some((t, i) => i > 0 && t.min <= tiers[i - 1].min)) throw new Error("Levels must start at zero and increase in order.");
  const result = await supabaseAdmin().from("brands").update({
    name: requiredText(fd.get("name"), "Brand name"), tagline: str(fd, "tagline") || null,
    primary_color: hexColor(str(fd, "primary_color")), accent_color: hexColor(str(fd, "accent_color")),
    stamps_per_reward: num(fd, "stamps_per_reward", brand.stamps_per_reward, 3, 30),
    stamp_label: requiredText(fd.get("stamp_label"), "Stamp label"), reward_name: requiredText(fd.get("reward_name"), "Reward name"),
    reward_valid_days: num(fd, "reward_valid_days", brand.reward_valid_days, 7, 365), max_stamps_per_visit: num(fd, "max_stamps_per_visit", brand.max_stamps_per_visit, 1, 12),
    migration_until: str(fd, "migration_until") || null, migration_cap: num(fd, "migration_cap", brand.migration_cap, 1, 30),
    spin_enabled: bool(fd, "spin_enabled"), spin_double_odds: num(fd, "spin_double_odds", brand.spin_double_odds, 2, 20),
    streak_enabled: bool(fd, "streak_enabled"), referral_enabled: bool(fd, "referral_enabled"), install_bonus_enabled: bool(fd, "install_bonus_enabled"), birthday_reward_enabled: bool(fd, "birthday_reward_enabled"),
    ugc_agreement: str(fd, "ugc_agreement") || null, pdpa_text: str(fd, "pdpa_text") || null, tiers,
  }).eq("id", brand.id).select("id").single();
  checked(result, "save settings");
  revalidatePath(`/admin/${slug}`, "layout");
}

export async function addOutlet(slug: string, fd: FormData) {
  const { brand } = await requireBrand(slug, "owner");
  checked(await supabaseAdmin().from("outlets").insert({ brand_id: brand.id, name: requiredText(fd.get("name"), "Outlet name"), address: str(fd, "address") || null }), "add outlet");
  revalidatePath(`/admin/${slug}/settings`);
}
export async function toggleOutlet(slug: string, outletId: string, active: boolean) {
  const { brand } = await requireBrand(slug, "owner");
  checked(await supabaseAdmin().from("outlets").update({ active }).eq("id", uuid(outletId)).eq("brand_id", brand.id).select("id").single(), "change outlet status");
  revalidatePath(`/admin/${slug}/settings`);
}
export async function addStaff(slug: string, fd: FormData) {
  const { brand } = await requireBrand(slug, "owner");
  const pin = str(fd, "pin");
  if (!/^[0-9]{4,8}$/.test(pin)) throw new Error("PIN must be 4–8 digits.");
  const outlet = str(fd, "outlet_id");
  if (outlet) await ownOutlet(brand.id, outlet);
  checked(await supabaseAdmin().from("staff").insert({ brand_id: brand.id, name: requiredText(fd.get("name"), "Staff name"), pin_hash: await bcrypt.hash(pin, 10), role: str(fd, "role") === "manager" ? "manager" : "staff", outlet_id: outlet || null }), "add staff");
  revalidatePath(`/admin/${slug}/settings`);
}
export async function removeStaff(slug: string, staffId: string) {
  const { brand } = await requireBrand(slug, "owner");
  checked(await supabaseAdmin().from("staff").update({ active: false }).eq("id", uuid(staffId)).eq("brand_id", brand.id).select("id").single(), "deactivate staff");
  revalidatePath(`/admin/${slug}/settings`);
}

export async function manualStamp(slug: string, customerId: string, fd: FormData) {
  const { brand, user } = await requireBrand(slug, "write");
  await ownCustomer(brand.id, customerId);
  const qty = num(fd, "qty", 1, 1, 20);
  const r = await supabaseAdmin().rpc("admin_adjust_customer", { p_brand_id: brand.id, p_customer_id: customerId, p_actor_id: user.id, p_request_id: uuid(str(fd, "request_id")), p_kind: "stamps", p_qty: qty, p_title: requiredText(fd.get("note"), "Reason"), p_days: 30 });
  checked(r, "add stamps");
  await broadcastToCard(customerId, "stamp", { added: qty, ...(r.data ?? {}), bonuses: [] });
  revalidatePath(`/admin/${slug}/customers/${customerId}`);
}
export async function saveCustomerNote(slug: string, customerId: string, fd: FormData) {
  const { brand } = await requireBrand(slug, "write");
  checked(await supabaseAdmin().from("customers").update({ notes: str(fd, "notes").slice(0, 4000) || null }).eq("id", uuid(customerId)).eq("brand_id", brand.id).select("id").single(), "save customer note");
  revalidatePath(`/admin/${slug}/customers/${customerId}`);
}
export async function issueManualReward(slug: string, customerId: string, fd: FormData) {
  const { brand, user } = await requireBrand(slug, "write");
  await ownCustomer(brand.id, customerId);
  const r = await supabaseAdmin().rpc("admin_adjust_customer", { p_brand_id: brand.id, p_customer_id: customerId, p_actor_id: user.id, p_request_id: uuid(str(fd, "request_id")), p_kind: "reward", p_qty: 1, p_title: requiredText(fd.get("title"), "Reward title"), p_days: num(fd, "days", 30, 1, 365) });
  checked(r, "issue reward");
  await broadcastToCard(customerId, "redeemed", {});
  revalidatePath(`/admin/${slug}/customers/${customerId}`);
}

export async function createAndSendCampaign(slug: string, fd: FormData) {
  const { brand, user } = await requireBrand(slug, "write");
  const segment = str(fd, "segment") || "all";
  if (!["all", "near_reward", "lapsed_14", "lapsed_30", "influencers", "push_only", "telegram_only"].includes(segment)) throw new Error("Please choose a valid audience.");
  const path = str(fd, "url_path");
  if (path && (!/^\/(?!\/)/.test(path) || /[\\\r\n]/.test(path))) throw new Error("Use a path inside this brand's card.");
  const r = await supabaseAdmin().from("campaigns").insert({ brand_id: brand.id, title: requiredText(fd.get("title"), "Title"), body: requiredText(fd.get("body"), "Message", 1000), url_path: path || null, segment, bonus_stamps: num(fd, "bonus_stamps", 0, 0, 5), created_by: user.id, status: "draft" }).select("id").single();
  checked(r, "save campaign");
  if (!r.data) throw new Error("Campaign save was not confirmed.");
  if (str(fd, "send_now") === "on") await sendCampaign(r.data.id);
  revalidatePath(`/admin/${slug}/nudges`);
}
export async function sendDraftCampaign(slug: string, campaignId: string) {
  const { brand } = await requireBrand(slug, "write");
  const r = await supabaseAdmin().from("campaigns").select("id").eq("id", uuid(campaignId)).eq("brand_id", brand.id).maybeSingle();
  checked(r, "check campaign");
  if (!r.data) throw new Error("Campaign not found for this brand.");
  await sendCampaign(campaignId);
  revalidatePath(`/admin/${slug}/nudges`);
}
export async function createWindow(slug: string, fd: FormData) {
  const { brand } = await requireBrand(slug, "write");
  const starts = str(fd, "starts_at"), ends = str(fd, "ends_at");
  if (![starts, ends].every((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s))) throw new Error("Please enter a valid start and end time (Singapore time).");
  const start = new Date(`${starts}:00+08:00`), end = new Date(`${ends}:00+08:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("The end must be after the start.");
  const outlet = str(fd, "outlet_id");
  if (outlet) await ownOutlet(brand.id, outlet);
  checked(await supabaseAdmin().from("double_stamp_windows").insert({ brand_id: brand.id, outlet_id: outlet || null, title: requiredText(fd.get("title") || "Double stamp hours", "Title"), starts_at: start.toISOString(), ends_at: end.toISOString(), multiplier: num(fd, "multiplier", 2, 2, 5) }), "create double-stamp window");
  revalidatePath(`/admin/${slug}/nudges`);
}
export async function deleteWindow(slug: string, id: string) {
  const { brand } = await requireBrand(slug, "write");
  checked(await supabaseAdmin().from("double_stamp_windows").delete().eq("id", uuid(id)).eq("brand_id", brand.id).select("id").single(), "remove double-stamp window");
  revalidatePath(`/admin/${slug}/nudges`);
}

export type CreatorCreditState = { ok: boolean; message: string; customerId?: string };
export async function creditCreatorAccount(slug: string, _state: CreatorCreditState, fd: FormData): Promise<CreatorCreditState> {
  const { brand, user } = await requireBrand(slug, "write");
  try {
    const phone = normalisePhone(str(fd, "phone"));
    if (!phone) throw new Error("Please enter a valid mobile number, including its country code.");
    const platform = str(fd, "platform");
    if (!["instagram", "tiktok", "lemon8", "xiaohongshu", "youtube", "other"].includes(platform)) throw new Error("Please choose a platform.");
    const r = await supabaseAdmin().rpc("admin_credit_creator", { p_brand_id: brand.id, p_phone: phone, p_name: requiredText(fd.get("name"), "Creator name", 60), p_handle: requiredText(str(fd, "handle").replace(/^@/, ""), "Creator handle", 100), p_platform: platform, p_actor_id: user.id, p_request_id: uuid(str(fd, "request_id")) });
    checked(r, "credit creator account");
    const result = r.data as { customer_id: string; grant_id: string; already_credited: boolean } | null;
    if (!result?.customer_id) throw new Error("The credit was not confirmed. Refresh and check before retrying.");
    revalidatePath(`/admin/${slug}/creators`);
    revalidatePath(`/admin/${slug}/customers`);
    revalidatePath(`/admin/${slug}/customers/${result.customer_id}`);
    return { ok: true, customerId: result.customer_id, message: result.already_credited ? "This phone already received the four-bowl creator allocation. No extra bowls were added; check its reward history for current balances." : "Creator account saved. Four complimentary bowl rewards are available immediately. The creator can open their card after verifying this phone number. No message has been sent." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Could not save this creator. Refresh and check before retrying." }; }
}

export async function createGrant(slug: string, fd: FormData) {
  const { brand, user } = await requireBrand(slug, "write");
  const total = num(fd, "rewards_total", 4, 1, 20), upfront = num(fd, "rewards_upfront", 1, 0, total);
  checked(await supabaseAdmin().from("influencer_grants").insert({ brand_id: brand.id, handle: requiredText(str(fd, "handle").replace(/^@/, ""), "Handle"), platform: str(fd, "platform") || "instagram", followers: str(fd, "followers") ? num(fd, "followers", 0, 0, 1000000000) : null, rewards_total: total, rewards_upfront: upfront, reward_title: `${brand.reward_name} (creator)`, content_due_date: str(fd, "content_due_date") || null, deliverable: str(fd, "deliverable") || "1 Reel/TikTok + 1 Story, tagged, disclosed as gifted", agreement_text: str(fd, "agreement_text") || null, created_by: user.id }), "create invite");
  revalidatePath(`/admin/${slug}/creators`);
}
export async function markGrantPosted(slug: string, grantId: string, fd: FormData) {
  const { brand } = await requireBrand(slug, "write");
  const url = webUrl(str(fd, "post_url"));
  if (!url) throw new Error("Please add the live post link.");
  checked(await supabaseAdmin().from("influencer_grants").update({ status: "posted", post_url: url, posted_at: new Date().toISOString() }).eq("id", uuid(grantId)).eq("brand_id", brand.id).eq("status", "accepted").select("id").single(), "mark creator post");
  revalidatePath(`/admin/${slug}/creators`);
}
export async function verifyGrantAction(slug: string, grantId: string, fd: FormData) {
  const { brand, user } = await requireBrand(slug, "write");
  const url = webUrl(str(fd, "post_url"));
  if (!url) throw new Error("Please add the live post link before verifying.");
  const result = await verifyGrant(uuid(grantId), url, str(fd, "reach_notes") || null, user.id, brand.id);
  if (!result.ok) throw new Error(("error" in result ? String(result.error) : "") || "Could not verify this creator.");
  revalidatePath(`/admin/${slug}/creators`);
}
export async function cancelGrant(slug: string, grantId: string) {
  const { brand, user } = await requireBrand(slug, "write");
  const r = await supabaseAdmin().rpc("manage_creator_grant", { p_grant_id: uuid(grantId), p_brand_id: brand.id, p_actor_id: user.id, p_action: "cancel", p_post_url: null, p_reach_notes: null });
  checked(r, "cancel creator allocation");
  if (!r.data?.ok) throw new Error(r.data?.error || "Cancellation was not confirmed.");
  revalidatePath(`/admin/${slug}/creators`);
}
