import { NextResponse } from "next/server";
import { getBrandBySlug } from "@/lib/brand";
import { startPhoneChallenge } from "@/lib/customer-otp";
import { sameOrigin } from "@/lib/auth-throttle";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Please use the card website to request a code." }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const brand = await getBrandBySlug(String(body.slug || ""));
    if (!brand) return NextResponse.json({ error: "Unknown brand" }, { status: 404 });
    const r = await startPhoneChallenge(req, brand.slug, String(body.phone || ""));
    return NextResponse.json(r.error ? { error: r.error } : { ok: true }, { status: r.status });
  } catch { return NextResponse.json({ error: "Card sign-in is temporarily unavailable while phone verification is being set up. Please ask restaurant staff for help." }, { status: 503 }); }
}
