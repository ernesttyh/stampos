import { NextResponse } from "next/server";
import { runNudges, resumeCampaigns, automaticNudgesEnabled } from "@/lib/nudges";

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
  if (brand && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brand)) {
    return NextResponse.json({ error: "Invalid brand ID" }, { status: 400 });
  }
  try {
    const deadline = Date.now() + 240000;
    const campaigns = await resumeCampaigns(brand, Math.min(deadline, Date.now() + 120000));
    const summary = await runNudges(brand, deadline);
    const errors = Object.values(summary).reduce((n, s) => n + s.errors, 0)
      + Object.values(campaigns).reduce((n, c) => n + c.errors.length + c.uncertain, 0);
    return NextResponse.json({ ok: errors === 0, ran_at: new Date().toISOString(), automatic_enabled: automaticNudgesEnabled(), summary, campaigns }, { status: errors ? 207 : 200 });
  } catch (e) {
    console.error("Nudge worker failed; uncertain claims will not be retried", e);
    return NextResponse.json({ ok: false, error: "Nudge worker failed; inspect server logs and durable messaging claims before any retry" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
