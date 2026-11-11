import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/session";
import { getCardPayload } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getCustomerSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const payload = await getCardPayload(s.customerId);
  if (!payload) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
