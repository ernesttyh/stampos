import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validPushEndpoint, sendWebPush } from "../src/lib/push";
import { singaporeDay, singaporeTime, automaticNudgesEnabled } from "../src/lib/nudges";
import { notifyCustomer } from "../src/lib/notify";

test("push endpoint SSRF guard allows only reviewed HTTPS push providers", () => {
  for (const endpoint of ["https://fcm.googleapis.com/fcm/send/token", "https://updates.push.services.mozilla.com/wpush/v2/token", "https://web.push.apple.com/Qtoken"]) assert.equal(validPushEndpoint(endpoint), true);
  for (const endpoint of ["http://fcm.googleapis.com/token", "https://127.0.0.1/token", "https://[::1]/token", "https://169.254.169.254/latest/meta-data", "https://localhost/token", "https://fcm.googleapis.com.evil.test/token", "https://evil.test/fcm.googleapis.com/token", "https://fcm.googleapis.com@evil.test/token", "https://user:pass@fcm.googleapis.com/token", "https://fcm.googleapis.com:8443/token", "https://fcm.googleapis.com./token", "https://fcm.googleapis.com/", "https://fcm.googleapis.com/token#frag", "file:///etc/passwd", "not a URL"]) assert.equal(validPushEndpoint(endpoint), false, endpoint);
});
test("invalid push endpoint is rejected before configuration or network I/O", async () => {
  const result = await sendWebPush({ endpoint: "https://127.0.0.1/internal", keys: { auth: "", p256dh: "" } }, { title: "test", body: "test" });
  assert.equal(result.ok, false); assert.equal("error" in result && result.error, "Unapproved push endpoint");
});
test("Singapore date and time are explicit around UTC midnight", () => {
  assert.equal(singaporeDay(new Date("2026-11-11T15:59:59Z")), "2026-11-11");
  assert.equal(singaporeDay(new Date("2026-11-11T16:00:00Z")), "2026-11-12");
  assert.match(singaporeTime("2026-11-11T03:30:00Z"), /11:30/);
});
test("automatic marketing requires an explicit true gate", () => {
  const old = process.env.AUTOMATIC_NUDGES_ENABLED;
  try {
    for (const value of [undefined, "false", "1", "TRUE", "yes"]) {
      if (value === undefined) delete process.env.AUTOMATIC_NUDGES_ENABLED; else process.env.AUTOMATIC_NUDGES_ENABLED = value;
      assert.equal(automaticNudgesEnabled(), false);
    }
    process.env.AUTOMATIC_NUDGES_ENABLED = "true"; assert.equal(automaticNudgesEnabled(), true);
  } finally { if (old === undefined) delete process.env.AUTOMATIC_NUDGES_ENABLED; else process.env.AUTOMATIC_NUDGES_ENABLED = old; }
});
test("messaging source preserves claim-before-send, fresh consent and no fallback", () => {
  const src = readFileSync(new URL("../src/lib/notify.ts", import.meta.url), "utf8");
  assert.ok(src.indexOf('rpc("messaging_claim"') < src.indexOf('=> sendWebPush('));
  assert.match(src, /!fresh \|\| !fresh\.marketing_consent/);
  assert.match(src, /else if \(channel === "telegram"\)/);
  assert.match(src, /finish\("uncertain"/);
  assert.doesNotMatch(src, /nothing could be delivered/);
});

test("dispatch fault injection: no live network, at-most-once and fail-closed consent", async (t) => {
  const originalFetch = globalThis.fetch;
  const envKeys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_TEMPLATE_NAME"] as const;
  const saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://messaging-test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "local-fake-key";
  process.env.TELEGRAM_BOT_TOKEN = "local-fake-token";
  for (const key of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_TEMPLATE_NAME"]) process.env[key] = "local-fake";
  const recipient = { id: "11111111-1111-4111-8111-111111111111", brand_id: "22222222-2222-4222-8222-222222222222", phone: "+6590000000", push_subscription: null, telegram_chat_id: 123, whatsapp_opt_in: true, marketing_consent: true };
  const operations = new Set<string>(); const outcomes: string[] = [];
  let sends = 0; let whatsapp = 0; let consent = true; let provider: "ok" | "throw" | "reject" = "ok";
  let claimFailure = false; let readFailure = false; let auditFailure = false;
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  // Every URL is intercepted. Unknown URLs fail the test, never call real fetch.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "messaging-test.invalid") {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (url.pathname.endsWith("/rpc/messaging_claim")) {
        if (claimFailure) return json({ message: "Claim database unavailable" }, 500);
        const key = String(body.p_operation_key);
        if (operations.has(key)) return json(null);
        operations.add(key); return json({ id: "33333333-3333-4333-8333-333333333333" });
      }
      if (url.pathname.endsWith("/customers")) return readFailure ? json({ message: "Consent database unavailable" }, 500) : json({ ...recipient, marketing_consent: consent });
      if (url.pathname.endsWith("/messaging_claims")) { outcomes.push(String(body.status)); return new Response(null, { status: 204 }); }
      if (url.pathname.endsWith("/notifications")) return auditFailure ? json({ message: "Audit unavailable" }, 500) : new Response(null, { status: 201 });
    }
    if (url.hostname === "api.telegram.org") {
      sends++; if (provider === "throw") throw new Error("Connection lost after request");
      return provider === "reject" ? new Response("Provider error", { status: 500 }) : json({ ok: true });
    }
    if (url.hostname === "graph.facebook.com") { whatsapp++; throw new Error("Unexpected fallback"); }
    throw new Error(`Forbidden live network URL: ${url}`);
  }) as typeof fetch;
  const send = (key: string) => notifyCustomer(recipient, "local-brand", { title: "Test", body: "No live sends" }, "test", undefined, { operationKey: key });
  try {
    await t.test("fresh opt-out cancels stale consenting snapshot", async () => {
      consent = false; assert.equal(await send("opt-out"), null); assert.equal(sends, 0); assert.equal(outcomes.at(-1), "skipped"); consent = true;
    });
    await t.test("accepted send persists outcome and repeated operation cannot resend", async () => {
      assert.equal(await send("accepted"), "telegram"); assert.equal(outcomes.at(-1), "accepted");
      assert.equal(await send("accepted"), null); assert.equal(sends, 1);
    });
    await t.test("network uncertainty is durable and never automatically retried", async () => {
      provider = "throw"; await assert.rejects(send("uncertain"), /uncertain; will not retry/);
      assert.equal(outcomes.at(-1), "uncertain"); const count = sends;
      assert.equal(await send("uncertain"), null); assert.equal(sends, count); provider = "ok";
    });
    await t.test("provider error never falls through to another channel", async () => {
      provider = "reject"; await assert.rejects(send("rejected"), /will not retry/);
      assert.equal(whatsapp, 0); assert.equal(outcomes.at(-1), "uncertain"); provider = "ok";
    });
    await t.test("claim and consent database failures fail closed", async () => {
      const count = sends; claimFailure = true; await assert.rejects(send("claim-fail"), /claim failed/i); claimFailure = false;
      readFailure = true; await assert.rejects(send("read-fail"), /Consent recheck failed/); readFailure = false;
      assert.equal(sends, count);
    });
    await t.test("audit failure after acceptance must not cause duplicate send on retry", async () => {
      auditFailure = true; await assert.rejects(send("audit-fail"), /operation remains uncertain/); auditFailure = false;
      const count = sends; assert.equal(await send("audit-fail"), null); assert.equal(sends, count);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
