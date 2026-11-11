import { supabaseAdmin } from "./supabase/admin";
import { sendWebPush } from "./push";
import { sendTelegram } from "./telegram";
import { sendWhatsApp, whatsappConfigured } from "./whatsapp";
import { appUrl } from "./brand";
import type { Customer } from "./types";

export type Nudge = { title: string; body: string; urlPath?: string; tag?: string };

/**
 * Send a nudge to a customer through the best channel they have:
 * 1) web push  2) Telegram  3) WhatsApp (template)  — logs every attempt in `notifications`.
 * Returns the channel used, or null if nothing could be delivered.
 */
export async function notifyCustomer(
  customer: Pick<Customer, "id" | "brand_id" | "phone" | "push_subscription" | "telegram_chat_id" | "whatsapp_opt_in" | "marketing_consent">,
  brandSlug: string,
  nudge: Nudge,
  trigger: string,
  campaignId?: string
): Promise<"push" | "telegram" | "whatsapp" | null> {
  const db = supabaseAdmin();
  const url = appUrl(`/${brandSlug}${nudge.urlPath || ""}`);
  const log = (channel: "push" | "telegram" | "whatsapp", status: "sent" | "failed", error?: string) =>
    db.from("notifications").insert({
      brand_id: customer.brand_id,
      customer_id: customer.id,
      campaign_id: campaignId ?? null,
      trigger,
      channel,
      title: nudge.title,
      body: nudge.body,
      status,
      error: error ?? null,
    });

  // 1) Web push
  if (customer.push_subscription) {
    const r = await sendWebPush(customer.push_subscription, { title: nudge.title, body: nudge.body, url, tag: nudge.tag });
    if (r.ok) {
      await log("push", "sent");
      return "push";
    }
    await log("push", "failed", r.error);
    if ("gone" in r && r.gone) {
      await db.from("customers").update({ push_subscription: null, push_enabled_at: null }).eq("id", customer.id);
    }
  }

  // 2) Telegram
  if (customer.telegram_chat_id) {
    const r = await sendTelegram(customer.telegram_chat_id, `<b>${escapeHtml(nudge.title)}</b>\n${escapeHtml(nudge.body)}`, url);
    if (r.ok) {
      await log("telegram", "sent");
      return "telegram";
    }
    await log("telegram", "failed", r.error);
    if (r.gone) await db.from("customers").update({ telegram_chat_id: null }).eq("id", customer.id);
  }

  // 3) WhatsApp (only with explicit opt-in and marketing consent)
  if (customer.whatsapp_opt_in && customer.marketing_consent && whatsappConfigured()) {
    const r = await sendWhatsApp(customer.phone, `${nudge.title} — ${nudge.body} ${url}`);
    if (r.ok) {
      await log("whatsapp", "sent");
      return "whatsapp";
    }
    await log("whatsapp", "failed", r.error);
  }

  return null;
}

/** True if this trigger was already sent to this customer within the last N days (prevents nagging). */
export async function recentlyNotified(customerId: string, trigger: string, days: number) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const { count } = await supabaseAdmin()
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("trigger", trigger)
    .eq("status", "sent")
    .gte("sent_at", since);
  return (count ?? 0) > 0;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
