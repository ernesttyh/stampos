import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { sessionSecret, newTelegramToken, telegramTokenHash, hashAuthKey, escapeTelegramHtml } from "../src/lib/auth-safety";
import { signAuthToken, verifyAuthToken } from "../src/lib/session";

const strongSecret = "f5a8b7318a4dcfeb029d76442c673a3f41b00d53cba926e5";
process.env.SESSION_SECRET = strongSecret;

test("missing, short and placeholder signing secrets fail closed", () => {
  for (const value of [undefined, "short", "a".repeat(64), "replace-with-a-random-secret-before-production"]) {
    if (value === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = value;
    assert.throws(sessionSecret);
  }
  process.env.SESSION_SECRET = strongSecret;
  assert.equal(sessionSecret(), strongSecret);
});

test("Telegram payload is signed, short, purpose-scoped and tamper resistant", () => {
  const token = newTelegramToken();
  assert.match(token, /^[A-Za-z0-9_-]{44}$/);
  assert.equal(telegramTokenHash(token)?.length, 64);
  assert.notEqual(newTelegramToken(), token);
  assert.equal(telegramTokenHash("11111111-1111-4111-8111-111111111111"), null);
  assert.equal(telegramTokenHash(`${token[0] === "A" ? "B" : "A"}${token.slice(1)}`), null);
  const nonce = token.slice(0, 22);
  const wrongPurpose = nonce + createHmac("sha256", strongSecret).update(`customer-session:v1:${nonce}`).digest().subarray(0, 16).toString("base64url");
  assert.equal(telegramTokenHash(wrongPurpose), null);
});

test("rate keys hide phone numbers and differ by operation", () => {
  assert.match(hashAuthKey("otp:+6591234567"), /^[a-f0-9]{64}$/);
  assert.notEqual(hashAuthKey("otp:+6591234567"), hashAuthKey("staff:+6591234567"));
});

test("telegram html is escaped", () => {
  assert.equal(escapeTelegramHtml("<b>A&B</b>"), "&lt;b&gt;A&amp;B&lt;/b&gt;");
});

test("session/proof tokens reject different purposes, expiry, tampering and key rotation", async () => {
  const token = await signAuthToken("phone-proof", { slug: "pilot", phone: "+6591234567" }, 600);
  assert.equal((await verifyAuthToken<{ slug: string }>("phone-proof", token, 600))?.slug, "pilot");
  assert.equal(await verifyAuthToken("customer-session", token, 600), null);
  assert.equal(await verifyAuthToken("phone-proof", token.slice(0, -3) + "aaa", 600), null);
  assert.equal(await verifyAuthToken("phone-proof", await signAuthToken("phone-proof", {}, -5), 600), null);
  process.env.SESSION_SECRET = strongSecret.split("").reverse().join("");
  assert.equal(await verifyAuthToken("phone-proof", token, 600), null);
  process.env.SESSION_SECRET = strongSecret;
});

test("auth entrypoint source guards remain fail closed (regression checks, not integration tests)", () => {
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const customer = source("src/lib/customers.ts");
  assert.match(customer, /input\.verifiedPhone !== phone/);
  assert.doesNotMatch(customer, /ex\.name\.trim\(\)\.toLowerCase/);
  for (const path of ["src/app/api/card/signup/route.ts", "src/app/api/card/invite/route.ts"]) {
    assert.match(source(path), /getVerifiedPhone/);
    assert.doesNotMatch(source(path), /marketingConsent: true/);
  }
  const otp = source("src/lib/customer-otp.ts");
  assert.match(otp, /signInWithOtp/); assert.match(otp, /verifyOtp/);
  assert.match(otp, /CUSTOMER_PHONE_OTP_ENABLED !== "true"/);
  assert.match(otp, /phone_confirmed_at/);
  const session = source("src/lib/session.ts");
  assert.match(session, /so_customer_v2/);
  assert.match(session, /row\.auth_version !== s\.authVersion/);
  assert.match(session, /eq\("active", true\)/);
  const staff = source("src/app/api/staff/login/route.ts");
  assert.doesNotMatch(staff, /compareSync/);
  assert.match(staff, /await bcrypt\.compare/);
  const webhook = source("src/app/api/telegram/webhook/route.ts");
  assert.match(webhook, /if \(!expected \|\|/);
  assert.match(webhook, /consume_telegram_link/);
  assert.doesNotMatch(source("src/components/card/Card.tsx"), /start=\$\{data\.customer\.id\}/);
  const sql = source("supabase/migrations/0004_auth_safety.sql");
  assert.match(sql, /on conflict \(key_hash\) do update/);
  assert.match(sql, /delete from telegram_link_tokens where token_hash = p_hash and expires_at > clock_timestamp\(\)/);
  assert.match(sql, /revoke all on function public\.consume_telegram_link/);
});
