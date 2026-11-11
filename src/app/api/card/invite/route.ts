import { NextResponse } from "next/server";
import { getGrantByCode, signupOrLogin, acceptGrant } from "@/lib/customers";
import { setCustomerSession } from "@/lib/session";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const grant = await getGrantByCode(String(body.code || ""));
  if (!grant || grant.brand.slug !== body.slug) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (grant.status !== "invited") return NextResponse.json({ error: "This invite has already been used" }, { status: 400 });
  const r = await signupOrLogin(grant.brand, {
    name: String(body.name || ""),
    phone: String(body.phone || ""),
    marketingConsent: true,
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  const a = await acceptGrant(grant, grant.brand, r.customer);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: 400 });
  await setCustomerSession({ customerId: r.customer.id, brandId: grant.brand.id, brandSlug: grant.brand.slug });
  return NextResponse.json({ ok: true, upfront: a.upfront, locked: a.locked });
}
