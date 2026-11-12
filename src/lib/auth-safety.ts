import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sessionSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || Buffer.byteLength(value) < 32 || new Set(value).size < 12 || /^(change|example|your[-_ ]|replace)/i.test(value)) {
    throw new Error("SESSION_SECRET must be a strong random secret of at least 32 bytes");
  }
  return value;
}

export function hashAuthKey(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

export function newTelegramToken() {
  const nonce = randomBytes(16).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(`telegram-link:v1:${nonce}`).digest().subarray(0, 16).toString("base64url");
  return `${nonce}${signature}`;
}

export function telegramTokenHash(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{44}$/.test(token)) return null;
  const nonce = token.slice(0, 22);
  const signature = token.slice(22);
  const expected = createHmac("sha256", sessionSecret()).update(`telegram-link:v1:${nonce}`).digest().subarray(0, 16);
  const actual = Buffer.from(signature, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    ? createHash("sha256").update(token).digest("hex") : null;
}

export function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
