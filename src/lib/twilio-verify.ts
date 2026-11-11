import { Buffer } from "node:buffer";
import { normalisePhone } from "./phone";

// Server-only: callers must never serialize this configuration or provider responses.
export type TwilioVerifyConfig = { accountSid: string; authToken: string; serviceSid: string; dailySendLimit: number };
export const TWILIO_TIMEOUT_MS = 8_000;
export const isSingaporeMobile = (phone: string) => /^\+65[89]\d{7}$/.test(phone);

export function twilioVerifyConfig(): TwilioVerifyConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID || "";
  const rawLimit = process.env.CUSTOMER_PHONE_OTP_DAILY_SEND_LIMIT ?? "100";
  const dailySendLimit = Number(rawLimit);
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken.trim() || !/^VA[0-9a-f]{32}$/i.test(serviceSid)
      || !/^\d+$/.test(rawLimit) || !Number.isSafeInteger(dailySendLimit) || dailySendLimit < 1) {
    throw new Error("Phone verification is not configured. Please contact the restaurant.");
  }
  return { accountSid, authToken, serviceSid, dailySendLimit };
}

/** Singapore has no DST. Date-keyed durable counters must live longer than a local day. */
export function singaporeSendDay(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Inject transport in offline tests. No retries, redirects, provider error propagation or logging. */
export function createTwilioVerify(config: TwilioVerifyConfig, transport: typeof fetch = fetch, timeoutMs = TWILIO_TIMEOUT_MS) {
  async function post(resource: string, fields: Record<string, string>, phone: string, expectedStatus: string): Promise<boolean> {
    if (!isSingaporeMobile(phone)) return false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(false); }, timeoutMs);
    });
    const attempt = async () => {
      try {
        const response = await transport(`https://verify.twilio.com/v2/Services/${config.serviceSid}/${resource}`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(fields).toString(),
          signal: controller.signal,
          redirect: "error",
          cache: "no-store",
        });
        if (!response.ok) return false;
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("status" in body) || !("to" in body)
            || !("service_sid" in body) || body.service_sid !== config.serviceSid) return false;
        return body.status === expectedStatus && typeof body.to === "string"
          && /^\+?\d{8,15}$/.test(body.to) && normalisePhone(body.to) === phone;
      } catch {
        // Sending may have succeeded despite a network failure. Never automatically retry.
        return false;
      }
    };
    try { return await Promise.race([attempt(), timeout]); }
    finally { clearTimeout(timer); }
  }
  return {
    send: (phone: string) => post("Verifications", { To: phone, Channel: "sms", Locale: "en" }, phone, "pending"),
    check: (phone: string, code: string) => /^\d{6,10}$/.test(code)
      ? post("VerificationCheck", { To: phone, Code: code }, phone, "approved") : Promise.resolve(false),
  };
}
