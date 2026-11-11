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
  // The RPC locks the customer and checks the cooldown in the same transaction as credits.
  const quantity = Number(qty);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return NextResponse.json({ error: "Quantity must be a positive whole number" }, { status: 400 });
  try {
    const outcome = await stampCustomer({ brand: b as Brand, customer: c as Customer, qty: quantity, outletId: s.outletId, staffId: s.staffId });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    const message = (e as Error).message;
    return NextResponse.json({ error: message }, { status: message.startsWith("Just stamped") ? 429 : 400 });
  }
}
