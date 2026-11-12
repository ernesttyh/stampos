import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sessionSecret } from "./auth-safety";
import { supabaseAdmin } from "./supabase/admin";

export type CustomerSession = { kind: "customer"; customerId: string; brandId: string; brandSlug: string };
export type StaffSession = { kind: "staff"; staffId: string; brandId: string; brandSlug: string; outletId: string | null; name: string; role: "staff" | "manager"; authVersion?: number };

// v2 deliberately ignores ALL sessions issued by the old name-and-phone login.
const CUSTOMER_COOKIE = "so_customer_v2";
const STAFF_COOKIE = "so_staff_v2";
const CUSTOMER_TTL = 365 * 86400; // OTP is only asked when no card session exists on the device
const STAFF_TTL = 8 * 3600;
export const authCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

export async function signAuthToken(purpose: string, payload: Record<string, unknown>, seconds: number) {
  return new SignJWT({ ...payload, purpose, version: 2 }).setProtectedHeader({ alg: "HS256" })
    .setIssuer("stampos").setAudience(purpose).setIssuedAt().setExpirationTime(`${seconds}s`)
    .sign(new TextEncoder().encode(sessionSecret()));
}

export async function verifyAuthToken<T>(purpose: string, token: string | undefined, maxAge: number): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(sessionSecret()), {
      algorithms: ["HS256"], issuer: "stampos", audience: purpose, maxTokenAge: maxAge,
      requiredClaims: ["exp", "iat"],
    });
    return payload.purpose === purpose && payload.version === 2 ? payload as unknown as T : null;
  } catch { return null; }
}

export async function setCustomerSession(s: Omit<CustomerSession, "kind">) {
  const token = await signAuthToken("customer-session", { ...s, kind: "customer" }, CUSTOMER_TTL);
  (await cookies()).set(CUSTOMER_COOKIE, token, { ...authCookieOptions, maxAge: CUSTOMER_TTL });
}
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const s = await verifyAuthToken<CustomerSession>("customer-session", (await cookies()).get(CUSTOMER_COOKIE)?.value, CUSTOMER_TTL);
  return s?.kind === "customer" && s.customerId && s.brandId && s.brandSlug ? s : null;
}
export async function clearCustomerSession() {
  const jar = await cookies();
  for (const name of [CUSTOMER_COOKIE, "so_customer"]) jar.set(name, "", { ...authCookieOptions, maxAge: 0 });
}

export async function setStaffSession(s: Omit<StaffSession, "kind">) {
  const { data, error } = await supabaseAdmin().from("staff").select("auth_version, active").eq("id", s.staffId).eq("brand_id", s.brandId).single();
  if (error || !data?.active || !Number.isInteger(data.auth_version) || s.authVersion !== data.auth_version) throw new Error("Staff access unavailable");
  const token = await signAuthToken("staff-session", { ...s, kind: "staff", authVersion: data.auth_version }, STAFF_TTL);
  (await cookies()).set(STAFF_COOKIE, token, { ...authCookieOptions, maxAge: STAFF_TTL });
}
export async function getStaffSession(): Promise<StaffSession | null> {
  const s = await verifyAuthToken<StaffSession>("staff-session", (await cookies()).get(STAFF_COOKIE)?.value, STAFF_TTL);
  if (s?.kind !== "staff" || !s.staffId || !s.brandId || !s.outletId) return null;
  try {
    const db = supabaseAdmin();
    const { data: row, error } = await db.from("staff").select("id,brand_id,outlet_id,name,role,active,auth_version").eq("id", s.staffId).eq("brand_id", s.brandId).maybeSingle();
    if (error || !row?.active || row.auth_version !== s.authVersion || (row.outlet_id && row.outlet_id !== s.outletId) || !["staff", "manager"].includes(row.role)) return null;
    const { data: outlet, error: outletError } = await db.from("outlets").select("id").eq("id", s.outletId).eq("brand_id", s.brandId).eq("active", true).maybeSingle();
    const { data: brand, error: brandError } = await db.from("brands").select("slug").eq("id", s.brandId).maybeSingle();
    if (outletError || !outlet || brandError || brand?.slug !== s.brandSlug) return null;
    return { ...s, name: row.name, role: row.role };
  } catch { return null; }
}
export async function clearStaffSession() {
  const jar = await cookies();
  for (const name of [STAFF_COOKIE, "so_staff"]) jar.set(name, "", { ...authCookieOptions, maxAge: 0 });
}
