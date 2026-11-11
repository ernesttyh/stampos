import { NextResponse } from "next/server";
import { getBrandBySlug } from "@/lib/brand";
import { signupOrLogin } from "@/lib/customers";
import { setCustomerSession } from "@/lib/session";
import { clearPhoneProof, getVerifiedPhone } from "@/lib/customer-otp";
import { sameOrigin } from "@/lib/auth-throttle";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Please use the card website." }, { status: 403 });
  try {
  const body = await req.json().catch(() => ({}));
  const brand = await getBrandBySlug(String(body.slug || ""));
  if (!brand) return NextResponse.json({ error: "Unknown brand" }, { status: 404 });
  const verifiedPhone = await getVerifiedPhone(brand.slug, String(body.phone || ""));
  if (!verifiedPhone) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const r = await signupOrLogin(brand, {
    name: String(body.name || ""),
    phone: String(body.phone || ""),
    verifiedPhone,
    birthday: body.birthday ? String(body.birthday) : null,
    marketingConsent: body.marketingConsent === true,
    ref: body.ref ? String(body.ref) : null,
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  await setCustomerSession({ customerId: r.customer.id, brandId: brand.id, brandSlug: brand.slug });
  await clearPhoneProof();
  return NextResponse.json({ ok: true, created: r.created });
  } catch { return NextResponse.json({ error: "Could not open your card. Please try later." }, { status: 503 }); }
}
