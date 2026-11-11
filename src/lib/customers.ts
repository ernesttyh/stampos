import { supabaseAdmin } from "./supabase/admin";
import { normalisePhone } from "./phone";
import { notifyCustomer } from "./notify";
import type { Brand, Customer, InfluencerGrant } from "./types";

export type SignupInput = {
  name: string;
  phone: string;
  birthday?: string | null;
  marketingConsent: boolean;
  ref?: string | null;
};

/**
 * Create a customer, or return the existing one when the phone already has a card
 * (name must match, case-insensitive — see README for the OTP upgrade path).
 */
export async function signupOrLogin(brand: Brand, input: SignupInput): Promise<{ customer: Customer; created: boolean; error?: string }> {
  const db = supabaseAdmin();
  const phone = normalisePhone(input.phone);
  const name = (input.name || "").trim().slice(0, 60);
  if (!phone) return { customer: null as unknown as Customer, created: false, error: "Please enter a valid mobile number" };
  if (name.length < 2) return { customer: null as unknown as Customer, created: false, error: "Please enter your name" };

  const { data: existing } = await db.from("customers").select("*").eq("brand_id", brand.id).eq("phone", phone).maybeSingle();
  if (existing) {
    const ex = existing as Customer;
    if (ex.name.trim().toLowerCase() !== name.toLowerCase()) {
      return { customer: ex, created: false, error: "This number already has a card under a different name. Use the same name you signed up with, or ask staff for help." };
    }
    await db.from("events").insert({ brand_id: brand.id, customer_id: ex.id, type: "relogin" });
    return { customer: ex, created: false };
  }

  let referredBy: string | null = null;
  if (input.ref && brand.referral_enabled) {
    const { data: referrer } = await db.from("customers").select("id").eq("brand_id", brand.id).eq("referral_code", input.ref.toUpperCase()).maybeSingle();
    referredBy = referrer?.id ?? null;
  }

  const { data, error } = await db
    .from("customers")
    .insert({
      brand_id: brand.id,
      phone,
      name,
      birthday: input.birthday || null,
      marketing_consent: input.marketingConsent,
      consent_at: input.marketingConsent ? new Date().toISOString() : null,
      referred_by: referredBy,
    })
    .select("*")
    .single();
  if (error || !data) return { customer: null as unknown as Customer, created: false, error: error?.message || "Could not create card" };
  await db.from("events").insert({ brand_id: brand.id, customer_id: data.id, type: "signup", meta: { ref: referredBy } });
  return { customer: data as Customer, created: true };
}

export async function getGrantByCode(code: string): Promise<(InfluencerGrant & { brand: Brand }) | null> {
  const db = supabaseAdmin();
  const { data } = await db.from("influencer_grants").select("*, brand:brands(*)").eq("invite_code", code.toUpperCase()).maybeSingle();
  if (!data) return null;
  return data as unknown as InfluencerGrant & { brand: Brand };
}

/** Influencer accepts the agreement: links the grant to their customer row and issues the rewards. */
export async function acceptGrant(grant: InfluencerGrant, brand: Brand, customer: Customer) {
  const db = supabaseAdmin();
  if (grant.status !== "invited") return { ok: false as const, error: "This invite has already been used" };
  const upfront = Math.min(grant.rewards_upfront, grant.rewards_total);
  const locked = grant.rewards_total - upfront;
  const expires = grant.content_due_date
    ? new Date(new Date(grant.content_due_date).getTime() + 45 * 86400000).toISOString()
    : new Date(Date.now() + 90 * 86400000).toISOString();

  const rows = [
    ...Array.from({ length: upfront }, () => ({
      brand_id: brand.id, customer_id: customer.id, type: "influencer", title: grant.reward_title,
      status: "available", grant_id: grant.id, expires_at: expires,
    })),
    ...Array.from({ length: locked }, () => ({
      brand_id: brand.id, customer_id: customer.id, type: "influencer", title: grant.reward_title,
      status: "locked", unlock_condition: "ugc_verified", grant_id: grant.id, expires_at: expires,
    })),
  ];
  const { error } = await db.from("rewards").insert(rows);
  if (error) return { ok: false as const, error: error.message };
  await db.from("influencer_grants").update({ status: "accepted", accepted_at: new Date().toISOString(), customer_id: customer.id }).eq("id", grant.id);
  await db.from("customers").update({ kind: "influencer" }).eq("id", customer.id);
  return { ok: true as const, upfront, locked };
}

/** Admin verifies the post: unlock the remaining rewards and tell the creator. */
export async function verifyGrant(grantId: string, postUrl: string | null, reachNotes: string | null) {
  const db = supabaseAdmin();
  const { data: g } = await db.from("influencer_grants").select("*, brand:brands(slug)").eq("id", grantId).maybeSingle();
  if (!g) return { ok: false as const, error: "Grant not found" };
  const grant = g as InfluencerGrant & { brand: { slug: string } };
  const { data: unlocked } = await db
    .from("rewards")
    .update({ status: "available", unlock_condition: null })
    .eq("grant_id", grantId)
    .eq("status", "locked")
    .select("id");
  await db.from("influencer_grants").update({
    status: "verified", verified_at: new Date().toISOString(),
    post_url: postUrl ?? grant.post_url, posted_at: grant.posted_at ?? new Date().toISOString(), reach_notes: reachNotes ?? grant.reach_notes,
  }).eq("id", grantId);
  if (grant.customer_id) {
    const { data: c } = await db.from("customers").select("*").eq("id", grant.customer_id).maybeSingle();
    if (c) {
      const n = unlocked?.length ?? 0;
      await notifyCustomer(c as Customer, grant.brand.slug, {
        title: "Your post is live — thank you!",
        body: n > 0 ? `${n} more free ${n === 1 ? "bowl is" : "bowls are"} unlocked on your card. Come back soon!` : "Thanks for sharing us with your followers!",
        urlPath: "/rewards",
        tag: "influencer",
      }, "influencer_unlock");
    }
  }
  return { ok: true as const, unlocked: unlocked?.length ?? 0 };
}
