import { NextResponse } from "next/server";
import { getGrantByCode, signupOrLogin, acceptGrant } from "@/lib/customers";
import { setCustomerSession } from "@/lib/session";
import { clearPhoneProof, getVerifiedPhone } from "@/lib/customer-otp";
import { sameOrigin } from "@/lib/auth-throttle";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Please use the card website." }, { status: 403 });
  try {
  const body = await req.json().catch(() => ({}));
  const grant = await getGrantByCode(String(body.code || ""));
  if (!grant || grant.brand.slug !== body.slug) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (grant.status !== "invited") return NextResponse.json({ error: "This invite has already been used" }, { status: 400 });
  if (body.agreementAccepted !== true) return NextResponse.json({ error: "Please accept the creator agreement." }, { status: 400 });
  const verifiedPhone = await getVerifiedPhone(grant.brand.slug, String(body.phone || ""));
  if (!verifiedPhone) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const r = await signupOrLogin(grant.brand, {
    name: String(body.name || ""),
    phone: String(body.phone || ""),
    verifiedPhone,
    marketingConsent: body.marketingConsent === true,
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  const a = await acceptGrant(grant, grant.brand, r.customer);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: 400 });
  await setCustomerSession({ customerId: r.customer.id, brandId: grant.brand.id, brandSlug: grant.brand.slug });
  await clearPhoneProof();
  return NextResponse.json({ ok: true, upfront: a.upfront, locked: a.locked });
  } catch { return NextResponse.json({ error: "Could not accept the invite. Please try later." }, { status: 503 }); }
}
