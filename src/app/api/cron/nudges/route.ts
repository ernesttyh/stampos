import { NextResponse } from "next/server";
import { runNudges } from "@/lib/nudges";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Call this on a schedule (Vercel Cron, n8n Schedule → HTTP Request, or any cron):
 *   GET/POST /api/cron/nudges            → all brands
 *   GET/POST /api/cron/nudges?brand=<id> → one brand
 * Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this automatically).
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const brand = new URL(req.url).searchParams.get("brand") || undefined;
  const summary = await runNudges(brand);
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), summary });
}

export const GET = handle;
export const POST = handle;
