import { supabaseAdmin } from "./supabase/admin";
import { normalisePhone } from "./phone";
import { notifyCustomer } from "./notify";
import type { Brand, Customer, InfluencerGrant } from "./types";

export type SignupInput = {
  name: string;
  phone: string;
  /** Server-only proof derived from the verified OTP cookie, never from request JSON. */
  verifiedPhone: string;
  birthday?: string | null;
  marketingConsent: boolean;
  ref?: string | null;
};

/**
 * Claim or open a card only after server-verified phone ownership. Existing profiles and consent are preserved.
 */
export async function signupOrLogin(brand: Brand, input: SignupInput): Promise<{ customer: Customer; created: boolean; error?: string }> {
  const db = supabaseAdmin();
  const phone = normalisePhone(input.phone);
  const name = (input.name || "").trim().slice(0, 60);
  if (!phone) return { customer: null as unknown as Customer, created: false, error: "Please enter a valid mobile number" };
  if (input.verifiedPhone !== phone) return { customer: null as unknown as Customer, created: false, error: "Please verify your mobile number first" };
  if (name.length < 2) return { customer: null as unknown as Customer, created: false, error: "Please enter your name" };

  const { data: existing, error: lookupError } = await db.from("customers").select("*").eq("brand_id", brand.id).eq("phone", phone).maybeSingle();
  if (lookupError) return { customer: null as unknown as Customer, created: false, error: "Could not open your card. Please try again." };
  if (existing) {
    const ex = existing as Customer;
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
  if (grant.brand_id !== brand.id || customer.brand_id !== brand.id) return { ok: false as const, error: "Customer brand mismatch" };
  const { data, error } = await supabaseAdmin().rpc("accept_creator_grant", {
    p_grant_id: grant.id, p_customer_id: customer.id,
  });
  if (error) return { ok: false as const, error: error.message };
  return data as { ok: boolean; error?: string; upfront?: number; locked?: number };
}

/** Admin verifies the post: unlock the remaining rewards and tell the creator. */
export async function verifyGrant(grantId: string, postUrl: string | null, reachNotes: string | null, actorId: string, brandId: string) {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("manage_creator_grant", {
    p_grant_id: grantId, p_brand_id: brandId, p_actor_id: actorId, p_action: "verify",
    p_post_url: postUrl, p_reach_notes: reachNotes,
  });
  if (error) return { ok: false as const, error: error.message };
  const result = data as { ok: boolean; unlocked: number; customer_id?: string; already_processed?: boolean };
  if (result.ok && result.customer_id && !result.already_processed) {
    try {
      const [{ data: c }, { data: brand }] = await Promise.all([
        db.from("customers").select("*").eq("id", result.customer_id).eq("brand_id", brandId).maybeSingle(),
        db.from("brands").select("slug").eq("id", brandId).maybeSingle(),
      ]);
      if (c && brand) await notifyCustomer(c as Customer, brand.slug, {
          title: "Your post is live — thank you!",
          body: result.unlocked > 0 ? `${result.unlocked} more complimentary rewards are unlocked on your card. Come back soon!` : "Thanks for sharing us with your followers!",
          urlPath: "/rewards", tag: "influencer",
        }, "influencer_unlock");
    } catch {
      // Notification failure cannot roll back a committed verification or prompt duplicate retries.
    }
  }
  return result;
}
