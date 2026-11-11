import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase/admin";
import { sendWebPush } from "./push";
import { sendTelegram } from "./telegram";
import { sendWhatsApp, whatsappConfigured } from "./whatsapp";
import { appUrl } from "./brand";
import type { Customer } from "./types";

export type Nudge = { title: string; body: string; urlPath?: string; tag?: string };
export type MessageOptions = { operationKey?: string; automatic?: boolean; cooldownDays?: number; bonusStamps?: number; bonusNote?: string };
type Channel = "push" | "telegram" | "whatsapp";
type Recipient = Pick<Customer, "id" | "brand_id" | "phone" | "push_subscription" | "telegram_chat_id" | "whatsapp_opt_in" | "marketing_consent">;

async function providerAttempt<T>(send: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([send(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Provider timeout; acceptance is uncertain")), 10000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Provider API acceptance, NOT end-user delivery. Durable claim BEFORE any I/O.
 * No channel fallback after an attempted API call: even a timeout/non-2xx can be
 * uncertain. A process crash leaves the operation uncertain and never retryable.
 * The original five arguments and channel/null result remain compatible.
 */
export async function notifyCustomer(
  customer: Recipient, brandSlug: string, nudge: Nudge, trigger: string,
  campaignId?: string, options: MessageOptions = {}
): Promise<Channel | null> {
  const db = supabaseAdmin();
  const operationKey = options.operationKey ?? `${trigger}:${customer.id}:${createHash("sha256").update(JSON.stringify(nudge)).digest("hex")}`;
  const { data: claimData, error: claimError } = await db.rpc("messaging_claim", {
    p_customer_id: customer.id, p_brand_id: customer.brand_id, p_operation_key: operationKey,
    p_trigger: trigger, p_campaign_id: campaignId ?? null, p_automatic: options.automatic ?? false,
    p_cooldown_days: options.cooldownDays ?? 0, p_bonus: options.bonusStamps ?? 0,
    p_bonus_note: options.bonusNote ?? null,
  });
  if (claimError) throw new Error(`Message claim failed: ${claimError.message}`);
  if (!claimData) return null;
  const claim = claimData as { id: string };
  const finish = async (status: "accepted" | "skipped" | "uncertain", channel: Channel | null, error?: string) => {
    const r = await db.from("messaging_claims").update({ status, channel, error: error ?? null, finished_at: new Date().toISOString() }).eq("id", claim.id);
    if (r.error) throw new Error(`Message outcome persistence failed: ${r.error.message}`);
  };

  // Reload immediately before sending. Never trust the stale audience snapshot's
  // consent, phone, subscription, or chat ID. Database failure fails CLOSED.
  const { data: fresh, error: readError } = await db.from("customers").select("*")
    .eq("id", customer.id).eq("brand_id", customer.brand_id).maybeSingle();
  if (readError) throw new Error(`Consent recheck failed: ${readError.message}`);
  if (!fresh || !fresh.marketing_consent) { await finish("skipped", null, "Consent withdrawn or customer removed"); return null; }
  const c = fresh as Customer;
  const channel: Channel | null = c.push_subscription ? "push" : c.telegram_chat_id ? "telegram" : c.whatsapp_opt_in && whatsappConfigured() ? "whatsapp" : null;
  if (!channel) { await finish("skipped", null, "No configured reachable channel"); return null; }
  const url = appUrl(`/${brandSlug}${nudge.urlPath || ""}`);
  let result: { ok: boolean; error?: string; gone?: boolean };
  try {
    if (channel === "push") result = await providerAttempt(() => sendWebPush(c.push_subscription!, { ...nudge, url }));
    else if (channel === "telegram") result = await providerAttempt(() => sendTelegram(c.telegram_chat_id!, `<b>${escapeHtml(nudge.title)}</b>\n${escapeHtml(nudge.body)}`, url));
    else result = await providerAttempt(() => sendWhatsApp(c.phone, `${nudge.title} — ${nudge.body} ${url}`));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish("uncertain", channel, message);
    throw new Error(`Message outcome uncertain; will not retry: ${message}`);
  }
  // Keep legacy notification status "sent" for compatibility. It means accepted.
  const log = await db.from("notifications").insert({ brand_id: c.brand_id, customer_id: c.id,
    campaign_id: campaignId ?? null, trigger, channel, title: nudge.title, body: nudge.body,
    status: result.ok ? "sent" : "failed", error: result.error ?? null });
  if (log.error) throw new Error(`Notification audit failed; operation remains uncertain: ${log.error.message}`);
  // Remove definitively dead endpoints for FUTURE operations, without a second
  // channel attempt here. Conditional writes cannot erase a newly linked channel.
  if (result.gone && channel === "push") {
    const gone = await db.from("customers").update({ push_subscription: null, push_enabled_at: null })
      .eq("id", c.id).eq("brand_id", c.brand_id).contains("push_subscription", { endpoint: c.push_subscription!.endpoint });
    if (gone.error) throw new Error(`Dead push cleanup failed: ${gone.error.message}`);
  } else if (result.gone && channel === "telegram") {
    const gone = await db.from("customers").update({ telegram_chat_id: null }).eq("id", c.id)
      .eq("brand_id", c.brand_id).eq("telegram_chat_id", c.telegram_chat_id!);
    if (gone.error) throw new Error(`Dead Telegram cleanup failed: ${gone.error.message}`);
  }
  await finish(result.ok ? "accepted" : "uncertain", channel, result.error);
  if (!result.ok) throw new Error(`Message not confirmed accepted; will not retry: ${result.error ?? "unknown provider error"}`);
  return channel;
}

/** Advisory only; the atomic messaging_claim RPC is the authoritative guard. */
export async function recentlyNotified(customerId: string, trigger: string, days: number) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const db = supabaseAdmin();
  const [claims, legacy] = await Promise.all([
    db.from("messaging_claims").select("id", { count: "exact", head: true }).eq("customer_id", customerId).eq("trigger", trigger).neq("status", "skipped").gte("created_at", since),
    db.from("notifications").select("id", { count: "exact", head: true }).eq("customer_id", customerId).eq("trigger", trigger).eq("status", "sent").gte("sent_at", since),
  ]);
  if (claims.error || legacy.error) throw new Error(`Cooldown lookup failed: ${(claims.error || legacy.error)!.message}`);
  return (claims.count ?? 0) + (legacy.count ?? 0) > 0;
}

function escapeHtml(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
