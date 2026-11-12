import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { authCookieOptions, signAuthToken, verifyAuthToken } from "./session";
import { normalisePhone } from "./phone";
import { authThrottle, requestAddress } from "./auth-throttle";
import { createTwilioVerify, isSingaporeMobile, singaporeSendDay, twilioVerifyConfig } from "./twilio-verify";

const CHALLENGE = "so_phone_challenge_v2";
const PROOF = "so_phone_proof_v2";
type PhoneChallenge = { slug: string; phone: string; nonce: string };

function phoneProvider() {
  if (process.env.CUSTOMER_PHONE_OTP_ENABLED !== "true") {
    throw new Error("Phone verification is not configured. Please contact the restaurant.");
  }
  const provider = process.env.CUSTOMER_PHONE_OTP_PROVIDER ?? "supabase";
  if (provider === "dev") {
    // Fixed test code for preview/UAT deployments only. Never sends SMS and refuses to run in production.
    const code = process.env.CUSTOMER_PHONE_OTP_DEV_CODE ?? "";
    if (process.env.VERCEL_ENV === "production" || !/^\d{6}$/.test(code)) {
      throw new Error("Phone verification is not configured. Please contact the restaurant.");
    }
    return { kind: "dev" as const, code };
  }
  if (provider === "twilio_verify") {
    const config = twilioVerifyConfig();
    return { kind: "twilio_verify" as const, config, client: createTwilioVerify(config) };
  }
  if (provider !== "supabase") throw new Error("Phone verification is not configured. Please contact the restaurant.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (process.env.CUSTOMER_PHONE_OTP_ENABLED !== "true" || !url || !key) {
    throw new Error("Phone verification is not configured. Please contact the restaurant.");
  }
  // Never use the service-role client for public phone authentication.
  return { kind: "supabase" as const, client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) };
}

export async function startPhoneChallenge(req: Request, slug: string, rawPhone: string) {
  const provider = phoneProvider();
  const phone = normalisePhone(rawPhone);
  if (!phone) return { error: "Please enter a valid mobile number", status: 400 };
  if (provider.kind === "twilio_verify" && !isSingaporeMobile(phone)) {
    return { error: "SMS verification currently supports Singapore mobile numbers starting with 8 or 9 only.", status: 400 };
  }
  const token = await signAuthToken("phone-challenge", { slug, phone, nonce: randomUUID() }, 600);
  if (!await authThrottle(`otp-send:phone:${phone}`, 3, 900) || !await authThrottle(`otp-send:ip:${requestAddress(req)}`, 15, 900)) {
    return { error: "Too many code requests. Please wait 15 minutes and try again.", status: 429 };
  }
  if (provider.kind === "twilio_verify") {
    // Reserve conservatively BEFORE the paid call. No refunds on failures/timeouts.
    // Date-key retention exceeds 24h, so this cannot reset during its Singapore day.
    if (!await authThrottle(`otp-send:app-day:${singaporeSendDay()}`, provider.config.dailySendLimit, 172800)
        || !await authThrottle(`otp-send:service-hour:${provider.config.serviceSid}`, 30, 3600)) {
      return { error: "SMS verification is temporarily at capacity. Please try later or contact the restaurant.", status: 429 };
    }
  }
  const sent = provider.kind === "dev"
    ? true
    : provider.kind === "twilio_verify"
      ? await provider.client.send(phone)
      : !(await provider.client.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } })).error;
  if (!sent) return { error: "Could not confirm that a code was sent. Please wait before requesting another code, or contact the restaurant.", status: 400 };
  const jar = await cookies();
  jar.set(CHALLENGE, token, { ...authCookieOptions, maxAge: 600 });
  jar.set(PROOF, "", { ...authCookieOptions, maxAge: 0 });
  return { status: 200 };
}

export async function verifyPhoneChallenge(req: Request, slug: string, rawPhone: string, code: string) {
  const provider = phoneProvider();
  const jar = await cookies();
  const challenge = await verifyAuthToken<PhoneChallenge>("phone-challenge", jar.get(CHALLENGE)?.value, 600);
  const phone = normalisePhone(rawPhone);
  if (!challenge || challenge.slug !== slug || challenge.phone !== phone || !/^\d{6,10}$/.test(code)
      || (provider.kind === "twilio_verify" && (!phone || !isSingaporeMobile(phone)))) {
    return { error: "Your code request has expired or is invalid. Request a new code.", status: 400 };
  }
  if (!await authThrottle(`otp-verify:phone:${phone}`, 8, 600) || !await authThrottle(`otp-verify:ip:${requestAddress(req)}`, 40, 600)) {
    return { error: "Too many attempts. Please wait 10 minutes and request a new code.", status: 429 };
  }
  let verified = false;
  if (provider.kind === "dev") {
    verified = code === provider.code;
  } else if (provider.kind === "twilio_verify") {
    verified = await provider.client.check(phone!, code);
  } else {
    const { data, error } = await provider.client.auth.verifyOtp({ phone: phone!, token: code, type: "sms" });
    verified = !error && !!data.user?.phone_confirmed_at && normalisePhone(data.user.phone || "") === phone;
  }
  if (!verified) {
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
  const provider = phoneProvider();
  const proof = await verifyAuthToken<PhoneChallenge>("phone-proof", (await cookies()).get(PROOF)?.value, 600);
  const phone = normalisePhone(rawPhone);
  return proof?.slug === slug && proof.phone === phone
    && (provider.kind !== "twilio_verify" || (!!phone && isSingaporeMobile(phone))) ? phone : null;
}
export async function clearPhoneProof() {
  (await cookies()).set(PROOF, "", { ...authCookieOptions, maxAge: 0 });
}
