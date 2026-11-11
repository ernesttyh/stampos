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

/** Returns { ok } or { ok:false, gone:true } when the subscription is dead and should be deleted. */
export async function sendWebPush(sub: PushSubscriptionJSON, payload: PushPayload) {
  if (!ensureConfigured()) return { ok: false as const, error: "VAPID keys not configured" };
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24, urgency: "normal" }
    );
    return { ok: true as const };
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode;
    const gone = status === 404 || status === 410;
    return { ok: false as const, gone, error: (e as Error).message };
  }
}
