import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * Lightweight signed sessions for customers and staff (no Supabase Auth needed for them).
 * Admins use Supabase Auth — see admin-auth.ts.
 */

export type CustomerSession = { kind: "customer"; customerId: string; brandId: string; brandSlug: string };
export type StaffSession = { kind: "staff"; staffId: string; brandId: string; brandSlug: string; outletId: string | null; name: string; role: "staff" | "manager" };

const CUSTOMER_COOKIE = "so_customer";
const STAFF_COOKIE = "so_staff";
const CUSTOMER_TTL_DAYS = 365;
const STAFF_TTL_HOURS = 14;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars)");
  return new TextEncoder().encode(s);
}

async function sign(payload: Record<string, unknown>, expSeconds: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
    .sign(secret());
}

async function verify<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as T;
  } catch {
    return null;
  }
}

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function setCustomerSession(s: Omit<CustomerSession, "kind">) {
  const token = await sign({ kind: "customer", ...s }, CUSTOMER_TTL_DAYS * 86400);
  (await cookies()).set(CUSTOMER_COOKIE, token, { ...cookieBase, maxAge: CUSTOMER_TTL_DAYS * 86400 });
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const s = await verify<CustomerSession>((await cookies()).get(CUSTOMER_COOKIE)?.value);
  return s?.kind === "customer" ? s : null;
}

export async function clearCustomerSession() {
  (await cookies()).set(CUSTOMER_COOKIE, "", { ...cookieBase, maxAge: 0 });
}

export async function setStaffSession(s: Omit<StaffSession, "kind">) {
  const token = await sign({ kind: "staff", ...s }, STAFF_TTL_HOURS * 3600);
  (await cookies()).set(STAFF_COOKIE, token, { ...cookieBase, maxAge: STAFF_TTL_HOURS * 3600 });
}

export async function getStaffSession(): Promise<StaffSession | null> {
  const s = await verify<StaffSession>((await cookies()).get(STAFF_COOKIE)?.value);
  return s?.kind === "staff" ? s : null;
}

export async function clearStaffSession() {
  (await cookies()).set(STAFF_COOKIE, "", { ...cookieBase, maxAge: 0 });
}
