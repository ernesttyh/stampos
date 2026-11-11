import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const s = await getCustomerSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sub = await req.json().catch(() => null);
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  const db = supabaseAdmin();
  await db.from("customers").update({ push_subscription: sub, push_enabled_at: new Date().toISOString() }).eq("id", s.customerId);
  await db.from("events").insert({ brand_id: s.brandId, customer_id: s.customerId, type: "push_opt_in" });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const s = await getCustomerSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  await supabaseAdmin().from("customers").update({ push_subscription: null, push_enabled_at: null }).eq("id", s.customerId);
  return NextResponse.json({ ok: true });
}
