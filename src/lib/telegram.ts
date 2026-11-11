const API = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME);
}

export function telegramDeepLink(signedLinkToken: string) {
  if (!/^[A-Za-z0-9_-]{44}$/.test(signedLinkToken)) throw new Error("Signed Telegram linking token required");
  return `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${signedLinkToken}`;
}

export async function sendTelegram(chatId: number, text: string, url?: string) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false as const, error: "Telegram not configured" };
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (url) body.reply_markup = { inline_keyboard: [[{ text: "Open my card", url }]] };
  const res = await fetch(API("sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    // 403 = user blocked the bot
    return { ok: false as const, gone: res.status === 403, error: t };
  }
  return { ok: true as const };
}
