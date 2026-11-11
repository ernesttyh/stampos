import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { creditOldCard } from "@/lib/loyalty";
import type { Brand, Customer } from "@/lib/types";

export async function POST(req: Request) {
  const s = await getStaffSession();
  if (!s) return NextResponse.json({ error: "Staff not signed in" }, { status: 401 });
  const { customerId, qty } = await req.json().catch(() => ({}));
  const db = supabaseAdmin();
  const [{ data: c }, { data: b }] = await Promise.all([
    db.from("customers").select("*").eq("id", customerId).eq("brand_id", s.brandId).maybeSingle(),
    db.from("brands").select("*").eq("id", s.brandId).maybeSingle(),
  ]);
  if (!c || !b) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  try {
    const r = await creditOldCard({ brand: b as Brand, customer: c as Customer, qty: Number(qty) || 1, outletId: s.outletId, staffId: s.staffId });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
