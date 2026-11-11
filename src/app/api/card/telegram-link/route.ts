import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/session";
import { newTelegramToken, telegramTokenHash } from "@/lib/auth-safety";
import { authThrottle, sameOrigin } from "@/lib/auth-throttle";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { telegramDeepLink } from "@/lib/telegram";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Please use your card to link Telegram." }, { status: 403 });
  try {
    const s = await getCustomerSession();
    if (!s) return NextResponse.json({ error: "Please sign in to your card first." }, { status: 401 });
    if (!process.env.TELEGRAM_WEBHOOK_SECRET || !process.env.TELEGRAM_BOT_TOKEN || !/^[A-Za-z0-9_]+$/.test(process.env.TELEGRAM_BOT_USERNAME || "")) {
      return NextResponse.json({ error: "Telegram linking is not configured." }, { status: 503 });
    }
    if (!await authThrottle(`telegram-link:${s.customerId}`, 5, 600)) return NextResponse.json({ error: "Please wait before requesting another link." }, { status: 429 });
    const db = supabaseAdmin();
    const { data: customer, error: lookupError } = await db.from("customers").select("id").eq("id", s.customerId).eq("brand_id", s.brandId).maybeSingle();
    if (lookupError || !customer) return NextResponse.json({ error: "Card not found." }, { status: 401 });
    const token = newTelegramToken();
    const { error } = await db.from("telegram_link_tokens").insert({ token_hash: telegramTokenHash(token), customer_id: customer.id, expires_at: new Date(Date.now() + 600000).toISOString() });
    if (error) throw error;
    return NextResponse.json({ url: telegramDeepLink(token) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not create a Telegram link. Please try later." }, { status: 503 }); }
}
