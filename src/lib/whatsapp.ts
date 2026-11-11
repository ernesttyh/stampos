/**
 * WhatsApp via Meta Cloud API. Marketing messages to customers who have not replied in 24h MUST use an
 * approved template, so this sends a template with the body text as the single {{1}} variable.
 * Set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and WHATSAPP_TEMPLATE_NAME to enable.
 */
export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_TEMPLATE_NAME);
}

export async function sendWhatsApp(phoneE164: string, text: string) {
  if (!whatsappConfigured()) return { ok: false as const, error: "WhatsApp not configured" };
  const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phoneE164.replace("+", ""),
      type: "template",
      template: {
        name: process.env.WHATSAPP_TEMPLATE_NAME,
        language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text }] }],
      },
    }),
  });
  if (!res.ok) return { ok: false as const, error: await res.text() };
  return { ok: true as const };
}
