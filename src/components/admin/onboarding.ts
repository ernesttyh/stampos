import type { SupabaseClient } from "@supabase/supabase-js";

type Auth = SupabaseClient["auth"];
export const INVALID_INVITE = "This invitation or password reset link is invalid or has expired. Ask your administrator to send a new link.";

/** Redeem only supported Auth credentials; destinations and roles never come from the URL. */
export async function establishAdminSession(auth: Auth, url: URL, requireLink = false) {
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.slice(1));
  const type = query.get("type") ?? hash.get("type");
  if (query.has("error") || query.has("error_code") || hash.has("error") || hash.has("error_code")) throw new Error(INVALID_INVITE);
  if (type && type !== "invite" && type !== "recovery") throw new Error(INVALID_INVITE);

  const code = query.get("code");
  const tokenHash = query.get("token_hash");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  let result;
  if (code) {
    result = await auth.exchangeCodeForSession(code);
  } else if (tokenHash && (type === "invite" || type === "recovery")) {
    result = await auth.verifyOtp({ token_hash: tokenHash, type });
  } else if (accessToken && refreshToken && (type === "invite" || type === "recovery")) {
    result = await auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  } else if (requireLink || query.has("token_hash") || query.has("code") || hash.toString() || type) {
    throw new Error(INVALID_INVITE);
  }
  if (result?.error) throw new Error(INVALID_INVITE);
  const { data, error } = await auth.getUser();
  if (error || !data.user) throw new Error(INVALID_INVITE);
}

export async function saveAdminPassword(auth: Auth, password: string, confirmation: string) {
  if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
  if (password !== confirmation) throw new Error("Your passwords do not match.");
  const { data, error } = await auth.getUser();
  if (error || !data.user) throw new Error(INVALID_INVITE);
  const result = await auth.updateUser({ password });
  if (result.error) throw new Error("We could not save your password. Check the password requirements or request a new link and try again.");
}
