import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegram } from "@/lib/telegram";
import { appUrl } from "@/lib/brand";
import { escapeTelegramHtml, telegramTokenHash } from "@/lib/auth-safety";

export const dynamic = "force-dynamic";

/**
 * Private chats only. Linking uses signed, expiring, single-use tokens created from an authenticated card.
 */
export async function POST(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  const chatId: number | undefined = msg?.chat?.id;
  const text: string = msg?.text || "";
  if (!Number.isSafeInteger(chatId) || !chatId || chatId <= 0 || msg?.chat?.type !== "private") return NextResponse.json({ ok: true });

  const db = supabaseAdmin();
  const m = /^[/]start +([A-Za-z0-9_-]{44})$/.exec(text);
  if (m) {
    const hash = telegramTokenHash(m[1]);
    if (!hash) return NextResponse.json({ ok: true });
    const { data: customerId, error: consumeError } = await db.rpc("consume_telegram_link", { p_hash: hash, p_chat_id: chatId });
    if (consumeError) return NextResponse.json({ error: "Linking unavailable" }, { status: 503 });
    if (!customerId) return NextResponse.json({ ok: true });
    const { data: c } = await db.from("customers").select("id, name, brand_id, brand:brands(name, slug)").eq("id", customerId).maybeSingle();
    if (c) {
      const brand = (c as unknown as { brand: { name: string; slug: string } }).brand;
      await sendTelegram(chatId, `Linked! Hi ${escapeTelegramHtml(c.name.split(" ")[0])} — your card at ${escapeTelegramHtml(brand.name)} is connected. Marketing reminders follow your card preferences.`, appUrl(`/${brand.slug}`));
      return NextResponse.json({ ok: true });
    }
  }
  if (/^[/]stop/i.test(text)) {
    await db.from("customers").update({ telegram_chat_id: null }).eq("telegram_chat_id", chatId);
    await sendTelegram(chatId, "Reminders off. Open your card and tap the Telegram button to link again any time.");
    return NextResponse.json({ ok: true });
  }
  const { data: linked } = await db.from("customers").select("id, brand:brands(slug)").eq("telegram_chat_id", chatId).maybeSingle();
  if (linked) {
    const slug = (linked as unknown as { brand: { slug: string } }).brand.slug;
    await sendTelegram(chatId, "Tap below to open your stamp card. Send /stop to switch reminders off.", appUrl(`/${slug}`));
  } else {
    await sendTelegram(chatId, "Open your stamp card in your browser and tap “Prefer Telegram?” to link this chat.");
  }
  return NextResponse.json({ ok: true });
}
