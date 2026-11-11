import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getBrandBySlug } from "@/lib/brand";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { setStaffSession } from "@/lib/session";
import type { Staff } from "@/lib/types";
import { authThrottle, requestAddress, sameOrigin } from "@/lib/auth-throttle";
import { seededPinBlocked, sessionSecret } from "@/lib/auth-safety";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Please use the staff website." }, { status: 403 });
  try {
  sessionSecret();
  const body = await req.json().catch(() => ({}));
  const brand = await getBrandBySlug(String(body.slug || ""));
  if (!brand) return NextResponse.json({ error: "Unknown brand" }, { status: 404 });
  const pin = String(body.pin || "");
  const outletId = String(body.outletId || "");
  if (!/^\d{4,8}$/.test(pin) || !/^[0-9a-f-]{36}$/i.test(outletId)) return NextResponse.json({ error: "Valid outlet and PIN required" }, { status: 400 });
  if (!await authThrottle(`staff:outlet:${brand.id}:${outletId}`, 10, 900) || !await authThrottle(`staff:ip:${requestAddress(req)}`, 30, 900)) {
    return NextResponse.json({ error: "Too many login attempts. Please wait 15 minutes." }, { status: 429 });
  }
  if (seededPinBlocked(pin)) return NextResponse.json({ error: "Default PINs are disabled. Ask your manager to set a new PIN." }, { status: 401 });
  if (process.env.NODE_ENV === "production" && !/^\d{6,8}$/.test(pin)) return NextResponse.json({ error: "A 6–8 digit staff PIN is required. Ask your manager to update your PIN." }, { status: 401 });

  const db = supabaseAdmin();
  const { data: outlet } = await db.from("outlets").select("id").eq("id", outletId).eq("brand_id", brand.id).eq("active", true).maybeSingle();
  if (!outlet) return NextResponse.json({ error: "Unknown outlet" }, { status: 400 });

  // Staff pinned to this outlet, or brand-wide staff (outlet_id null)
  const { data: staffRows, error: staffError } = await db.from("staff").select("*").eq("brand_id", brand.id).eq("active", true).or(`outlet_id.is.null,outlet_id.eq.${outletId}`).limit(101);
  if (staffError || !staffRows || staffRows.length > 100) throw new Error("Staff access unavailable");
  const candidates = staffRows as (Staff & { auth_version: number })[];
  let match: (Staff & { auth_version: number }) | undefined;
  for (const candidate of candidates) {
    if (await bcrypt.compare(pin, candidate.pin_hash)) { match = candidate; break; }
  }
  if (!match) return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });

  await setStaffSession({ staffId: match.id, brandId: brand.id, brandSlug: brand.slug, outletId, name: match.name, role: match.role, authVersion: match.auth_version });
  return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Staff login is temporarily unavailable. Please try later." }, { status: 503 }); }
}
