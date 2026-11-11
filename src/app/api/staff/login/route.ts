import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getBrandBySlug } from "@/lib/brand";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { setStaffSession } from "@/lib/session";
import type { Staff } from "@/lib/types";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const brand = await getBrandBySlug(String(body.slug || ""));
  if (!brand) return NextResponse.json({ error: "Unknown brand" }, { status: 404 });
  const pin = String(body.pin || "");
  const outletId = String(body.outletId || "");
  if (!pin || !outletId) return NextResponse.json({ error: "Outlet and PIN required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: outlet } = await db.from("outlets").select("id").eq("id", outletId).eq("brand_id", brand.id).maybeSingle();
  if (!outlet) return NextResponse.json({ error: "Unknown outlet" }, { status: 400 });

  // Staff pinned to this outlet, or brand-wide staff (outlet_id null)
  const { data: staffRows } = await db.from("staff").select("*").eq("brand_id", brand.id).eq("active", true);
  const candidates = ((staffRows ?? []) as Staff[]).filter((s) => !s.outlet_id || s.outlet_id === outletId);
  const match = candidates.find((s) => bcrypt.compareSync(pin, s.pin_hash));
  if (!match) return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });

  await setStaffSession({ staffId: match.id, brandId: brand.id, brandSlug: brand.slug, outletId, name: match.name, role: match.role });
  return NextResponse.json({ ok: true });
}
