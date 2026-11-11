import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { spin } from "@/lib/loyalty";
import type { Brand, Customer } from "@/lib/types";

export async function POST() {
  const s = await getCustomerSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = supabaseAdmin();
  const [{ data: c }, { data: b }] = await Promise.all([
    db.from("customers").select("*").eq("id", s.customerId).maybeSingle(),
    db.from("brands").select("*").eq("id", s.brandId).maybeSingle(),
  ]);
  if (!c || !b) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  const r = await spin(c as Customer, b as Brand);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
