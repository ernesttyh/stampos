import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegram } from "@/lib/telegram";
import { appUrl } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Telegram bot webhook. The card shows a `t.me/<bot>?start=<customerId>` link; when the person taps
 * Start, Telegram sends `/start <customerId>` here and we link the chat to their card.
 */
export async function POST(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  const chatId: number | undefined = msg?.chat?.id;
  const text: string = msg?.text || "";
  if (!chatId) return NextResponse.json({ ok: true });

  const db = supabaseAdmin();
  const m = /^[/]start +([0-9a-f-]{36})/i.exec(text);
  if (m) {
    const { data: c } = await db.from("customers").select("id, name, brand_id, brand:brands(name, slug)").eq("id", m[1]).maybeSingle();
    if (c) {
      await db.from("customers").update({ telegram_chat_id: chatId }).eq("id", c.id);
      const brand = (c as unknown as { brand: { name: string; slug: string } }).brand;
      await sendTelegram(chatId, `Linked! Hi ${c.name.split(" ")[0]} — I'll let you know when you're close to a reward at ${brand.name}, and on double-stamp days.`, appUrl(`/${brand.slug}`));
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
