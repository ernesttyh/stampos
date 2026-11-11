import webpush from "web-push";
import type { PushSubscriptionJSON } from "./types";

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@example.com", pub, priv);
  configured = true;
  return true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string; icon?: string };

/** Narrow provider allowlist prevents customer-controlled endpoints becoming SSRF.
 * Do not allow arbitrary HTTPS hosts, IP literals, credentials, ports or redirects.
 * Add new providers only after reviewing their endpoint ownership and transport.
 */
export function validPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    const allowed = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
    return u.protocol === "https:" && allowed.has(u.hostname) && !u.username && !u.password
      && !u.port && !u.hash && u.pathname.length > 1;
  } catch { return false; }
}

/** Returns { ok } or { ok:false, gone:true } when the subscription is dead and should be deleted. */
export async function sendWebPush(sub: PushSubscriptionJSON, payload: PushPayload) {
  if (!sub || !validPushEndpoint(sub.endpoint)) return { ok: false as const, error: "Unapproved push endpoint" };
  if (!ensureConfigured()) return { ok: false as const, error: "VAPID keys not configured" };
  try {
    await webpush.sendNotification(
      { endpoint: new URL(sub.endpoint).href, keys: sub.keys },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24, urgency: "normal", timeout: 10000 }
    );
    return { ok: true as const };
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode;
    const gone = status === 404 || status === 410;
    return { ok: false as const, gone, error: (e as Error).message };
  }
}
