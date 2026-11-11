import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { authCookieOptions, signAuthToken, verifyAuthToken } from "./session";
import { normalisePhone } from "./phone";
import { authThrottle, requestAddress } from "./auth-throttle";

const CHALLENGE = "so_phone_challenge_v2";
const PROOF = "so_phone_proof_v2";
type PhoneChallenge = { slug: string; phone: string; nonce: string };

function phoneAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (process.env.CUSTOMER_PHONE_OTP_ENABLED !== "true" || !url || !key) {
    throw new Error("Phone verification is not configured. Please contact the restaurant.");
  }
  // Never use the service-role client for public phone authentication.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function startPhoneChallenge(req: Request, slug: string, rawPhone: string) {
  const client = phoneAuthClient();
  const phone = normalisePhone(rawPhone);
  if (!phone) return { error: "Please enter a valid mobile number", status: 400 };
  const token = await signAuthToken("phone-challenge", { slug, phone, nonce: randomUUID() }, 600);
  if (!await authThrottle(`otp-send:phone:${phone}`, 3, 900) || !await authThrottle(`otp-send:ip:${requestAddress(req)}`, 15, 900)) {
    return { error: "Too many code requests. Please wait 15 minutes and try again.", status: 429 };
  }
  const { error } = await client.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
  if (error) return { error: "Could not send a verification code. Please wait and try again, or contact the restaurant.", status: 400 };
  const jar = await cookies();
  jar.set(CHALLENGE, token, { ...authCookieOptions, maxAge: 600 });
  jar.set(PROOF, "", { ...authCookieOptions, maxAge: 0 });
  return { status: 200 };
}

export async function verifyPhoneChallenge(req: Request, slug: string, rawPhone: string, code: string) {
  const client = phoneAuthClient();
  const jar = await cookies();
  const challenge = await verifyAuthToken<PhoneChallenge>("phone-challenge", jar.get(CHALLENGE)?.value, 600);
  const phone = normalisePhone(rawPhone);
  if (!challenge || challenge.slug !== slug || challenge.phone !== phone || !/^\d{6,10}$/.test(code)) {
    return { error: "Your code request has expired or is invalid. Request a new code.", status: 400 };
  }
  if (!await authThrottle(`otp-verify:phone:${phone}`, 8, 600) || !await authThrottle(`otp-verify:ip:${requestAddress(req)}`, 40, 600)) {
    return { error: "Too many attempts. Please wait 10 minutes and request a new code.", status: 429 };
  }
  const { data, error } = await client.auth.verifyOtp({ phone: phone!, token: code, type: "sms" });
  if (error || !data.user?.phone_confirmed_at || normalisePhone(data.user.phone || "") !== phone) {
    return { error: "That code is incorrect or expired. Please try again.", status: 400 };
  }
  // Provider access/refresh tokens never leave this request or become the card session.
  const proof = await signAuthToken("phone-proof", { slug, phone, nonce: challenge.nonce }, 600);
  jar.set(PROOF, proof, { ...authCookieOptions, maxAge: 600 });
  jar.set(CHALLENGE, "", { ...authCookieOptions, maxAge: 0 });
  return { status: 200 };
}

export async function getVerifiedPhone(slug: string, rawPhone: string): Promise<string | null> {
  // A disabled provider must not leave an alternative login route available.
  phoneAuthClient();
  const proof = await verifyAuthToken<PhoneChallenge>("phone-proof", (await cookies()).get(PROOF)?.value, 600);
  const phone = normalisePhone(rawPhone);
  return proof?.slug === slug && proof.phone === phone ? phone : null;
}
export async function clearPhoneProof() {
  (await cookies()).set(PROOF, "", { ...authCookieOptions, maxAge: 0 });
}
