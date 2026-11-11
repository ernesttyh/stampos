import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stampCustomer } from "@/lib/loyalty";
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
  // Guard against accidental double-tap: ignore a second staff stamp within 20 seconds
  const { data: last } = await db.from("stamps").select("created_at").eq("customer_id", customerId).eq("source", "staff").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.created_at).getTime() < 20_000) {
    return NextResponse.json({ error: "Just stamped — wait a moment before stamping again" }, { status: 429 });
  }
  try {
    const outcome = await stampCustomer({ brand: b as Brand, customer: c as Customer, qty: Number(qty) || 1, outletId: s.outletId, staffId: s.staffId });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
