import { NextResponse } from "next/server";
import { getBrandBySlug } from "@/lib/brand";
import { signupOrLogin } from "@/lib/customers";
import { setCustomerSession } from "@/lib/session";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const brand = await getBrandBySlug(String(body.slug || ""));
  if (!brand) return NextResponse.json({ error: "Unknown brand" }, { status: 404 });
  const r = await signupOrLogin(brand, {
    name: String(body.name || ""),
    phone: String(body.phone || ""),
    birthday: body.birthday ? String(body.birthday) : null,
    marketingConsent: Boolean(body.marketingConsent),
    ref: body.ref ? String(body.ref) : null,
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  await setCustomerSession({ customerId: r.customer.id, brandId: brand.id, brandSlug: brand.slug });
  return NextResponse.json({ ok: true, created: r.created });
}
