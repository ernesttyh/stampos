import { supabaseAdmin } from "./supabase/admin";
import { hashAuthKey } from "./auth-safety";

/** Durable atomic limiter. Database/configuration errors deny access, never fall back to memory. */
export async function authThrottle(key: string, limit: number, seconds: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("consume_auth_attempt", {
    p_key: hashAuthKey(key), p_limit: limit, p_window_seconds: seconds,
  });
  if (error) throw new Error("Authentication is temporarily unavailable. Please try later.");
  return data === true;
}

export function requestAddress(req: Request) {
  // Set this only when the deployment proxy overwrites this header. No trust in arbitrary X-Forwarded-For.
  const header = process.env.AUTH_TRUSTED_IP_HEADER;
  return header ? (req.headers.get(header)?.split(",")[0]?.trim().slice(0, 100) || "unknown") : "unknown";
}

export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !!origin && origin === new URL(req.url).origin;
}
