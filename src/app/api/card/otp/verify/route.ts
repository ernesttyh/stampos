import { NextResponse } from "next/server";
import { verifyPhoneChallenge } from "@/lib/customer-otp";
import { sameOrigin } from "@/lib/auth-throttle";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Please use the card website to verify your code." }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const r = await verifyPhoneChallenge(req, String(body.slug || ""), String(body.phone || ""), String(body.code || ""));
    return NextResponse.json(r.error ? { error: r.error } : { ok: true }, { status: r.status });
  } catch { return NextResponse.json({ error: "Phone verification is unavailable. Please try later." }, { status: 503 }); }
}
