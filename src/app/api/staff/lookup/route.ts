import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/session";
import { lookupForStaff } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await getStaffSession();
  if (!s) return NextResponse.json({ error: "Staff not signed in" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not a customer QR" }, { status: 400 });
  const r = await lookupForStaff(s.brandId, id);
  if (!r) return NextResponse.json({ error: "Customer not found for this brand" }, { status: 404 });
  return NextResponse.json(r);
}
