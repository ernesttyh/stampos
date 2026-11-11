import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redeemByCode } from "@/lib/loyalty";

export async function POST(req: Request) {
  const s = await getStaffSession();
  if (!s) return NextResponse.json({ error: "Staff not signed in" }, { status: 401 });
  const { code } = await req.json().catch(() => ({}));
  const { data: reward } = await supabaseAdmin().from("rewards").select("brand_id").eq("code", String(code || "").toUpperCase()).maybeSingle();
  if (!reward || reward.brand_id !== s.brandId) return NextResponse.json({ error: "Reward not found" }, { status: 404 });
  try {
    const r = await redeemByCode(String(code), s.outletId, s.staffId);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
