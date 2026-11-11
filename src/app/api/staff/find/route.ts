import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalisePhone } from "@/lib/phone";
import { lookupForStaff } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

/** Manual lookup by phone when a QR can't be scanned, or redeem by reward code. */
export async function GET(req: Request) {
  const s = await getStaffSession();
  if (!s) return NextResponse.json({ error: "Staff not signed in" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") || "";
  const db = supabaseAdmin();
  const phone = normalisePhone(q);
  if (phone) {
    const { data } = await db.from("customers").select("id").eq("brand_id", s.brandId).eq("phone", phone).maybeSingle();
    if (data) return NextResponse.json(await lookupForStaff(s.brandId, data.id));
    return NextResponse.json({ error: "No card with that number" }, { status: 404 });
  }
  const { data: reward } = await db.from("rewards").select("customer_id").eq("brand_id", s.brandId).eq("code", q.toUpperCase()).maybeSingle();
  if (reward) return NextResponse.json(await lookupForStaff(s.brandId, reward.customer_id));
  return NextResponse.json({ error: "Enter a mobile number or reward code" }, { status: 404 });
}
