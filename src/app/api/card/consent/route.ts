import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const s = await getCustomerSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { marketingConsent } = await req.json().catch(() => ({ marketingConsent: false }));
  await supabaseAdmin()
    .from("customers")
    .update({ marketing_consent: Boolean(marketingConsent), consent_at: marketingConsent ? new Date().toISOString() : null })
    .eq("id", s.customerId);
  return NextResponse.json({ ok: true });
}
