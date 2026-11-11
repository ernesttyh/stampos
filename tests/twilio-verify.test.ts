import test from "node:test";
import assert from "node:assert/strict";
import { createTwilioVerify, isSingaporeMobile, singaporeSendDay, twilioVerifyConfig, TWILIO_TIMEOUT_MS } from "../src/lib/twilio-verify";

// Synthetic configuration only; no account access or live network in these tests.
const config = { accountSid: `AC${"0".repeat(32)}`, authToken: "offline-placeholder", serviceSid: `VA${"0".repeat(32)}`, dailySendLimit: 100 };
const phone = "+6591234567";
function mockTransport(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, provider: createTwilioVerify(config, transport) };
}

test("official Verify endpoints, Basic auth, explicit SMS/English and form fields remain server-side", async () => {
  const h = mockTransport({ status: "pending", to: phone, service_sid: config.serviceSid });
  assert.equal(await h.provider.send(phone), true);
  assert.equal(h.calls.length, 1);
  const { url, init } = h.calls[0];
  assert.equal(url, `https://verify.twilio.com/v2/Services/${config.serviceSid}/Verifications`);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.equal(init.cache, "no-store");
  assert.equal(new Headers(init.headers).get("authorization"), `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`);
  assert.equal(new Headers(init.headers).get("content-type"), "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init.body))), { To: phone, Channel: "sms", Locale: "en" });
  assert.ok(init.signal);
  const check = mockTransport({ status: "approved", to: "6591234567", service_sid: config.serviceSid });
  assert.equal(await check.provider.check(phone, "123456"), true);
  assert.equal(check.calls[0].url, `https://verify.twilio.com/v2/Services/${config.serviceSid}/VerificationCheck`);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(check.calls[0].init.body))), { To: phone, Code: "123456" });
});

test("only approved plus matching normalized To and service SID verifies, never valid alone", async () => {
  for (const body of [null, [], "approved", {}, { valid: true },
    { status: "approved", service_sid: config.serviceSid },
    { to: phone, service_sid: config.serviceSid, valid: true },
    { status: "approved", to: phone },
    { status: "approved", to: phone, service_sid: "other-service" },
    { status: "approved", to: "+6599999999", service_sid: config.serviceSid },
    { status: "approved", to: 6591234567, service_sid: config.serviceSid },
    { status: "approved", to: "garbage+6591234567", service_sid: config.serviceSid },
    ...["pending", "expired", "failed", "APPROVED"].map((status) => ({ status, to: phone, service_sid: config.serviceSid, valid: true })),
  ]) {
    const h = mockTransport(body);
    assert.equal(await h.provider.check(phone, "123456"), false, JSON.stringify(body));
    assert.equal(h.calls.length, 1);
  }
});

test("send rejects malformed, mismatched and non-pending responses", async () => {
  for (const body of [{}, { status: "pending", to: phone },
    { status: "pending", to: "+6588888888", service_sid: config.serviceSid },
    { status: "approved", to: phone, service_sid: config.serviceSid }]) {
    assert.equal(await mockTransport(body).provider.send(phone), false);
  }
});

test("HTTP failures, malformed JSON and transport exceptions fail closed with no retries", async () => {
  for (const status of [400, 401, 404, 429, 500, 503]) {
    const h = mockTransport({ status: "approved", to: phone, service_sid: config.serviceSid }, status);
    assert.equal(await h.provider.check(phone, "123456"), false);
    assert.equal(await h.provider.send(phone), false);
    assert.equal(h.calls.length, 2);
  }
  for (const transport of [async () => new Response("not json"), async () => { throw new Error("sensitive provider details"); }]) {
    assert.equal(await createTwilioVerify(config, transport).send(phone), false);
    assert.equal(await createTwilioVerify(config, transport).check(phone, "123456"), false);
  }
});

test("eight-second production bound covers stalled transport and stalled response body, without retry", async () => {
  assert.equal(TWILIO_TIMEOUT_MS, 8000);
  for (const stalledBody of [false, true]) {
    let calls = 0;
    let signal: AbortSignal | undefined;
    const transport: typeof fetch = async (_url, init) => {
      calls++;
      signal = init?.signal ?? undefined;
      if (stalledBody) return { ok: true, json: () => new Promise(() => {}) } as unknown as Response;
      return new Promise(() => {});
    };
    const started = Date.now();
    assert.equal(await createTwilioVerify(config, transport, 15).send(phone), false);
    assert.ok(Date.now() - started < 1000);
    assert.equal(signal?.aborted, true);
    assert.equal(calls, 1);
  }
});

test("SG exact mobile restriction and invalid code stop before transport", async () => {
  const h = mockTransport({});
  for (const invalid of ["+6561234567", "+6512345678", "+659123456", "+65912345678", "+60123456789", "+65812345678", "91234567"]) {
    assert.equal(isSingaporeMobile(invalid), false);
    assert.equal(await h.provider.send(invalid), false);
    assert.equal(await h.provider.check(invalid, "123456"), false);
  }
  for (const code of ["", "12345", "12345678901", "12abcd"]) assert.equal(await h.provider.check(phone, code), false);
  assert.equal(h.calls.length, 0);
  assert.equal(isSingaporeMobile("+6581234567"), true);
  assert.equal(isSingaporeMobile(phone), true);
});

test("daily key changes at Singapore midnight, not UTC midnight", () => {
  assert.equal(singaporeSendDay(new Date("2026-11-11T15:59:59.999Z")), "2026-11-11");
  assert.equal(singaporeSendDay(new Date("2026-11-11T16:00:00.000Z")), "2026-11-12");
  assert.equal(singaporeSendDay(new Date("2026-11-12T00:00:00.000Z")), "2026-11-12");
});

test("configuration requires all server secrets and a positive integer daily limit", () => {
  const names = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID", "CUSTOMER_PHONE_OTP_DAILY_SEND_LIMIT"];
  const before = names.map((name) => process.env[name]);
  try {
    process.env.TWILIO_ACCOUNT_SID = config.accountSid;
    process.env.TWILIO_AUTH_TOKEN = config.authToken;
    process.env.TWILIO_VERIFY_SERVICE_SID = config.serviceSid;
    delete process.env.CUSTOMER_PHONE_OTP_DAILY_SEND_LIMIT;
    assert.equal(twilioVerifyConfig().dailySendLimit, 100);
    process.env.CUSTOMER_PHONE_OTP_DAILY_SEND_LIMIT = "25";
    assert.equal(twilioVerifyConfig().dailySendLimit, 25);
    for (const value of ["0", "-1", "", "1.5", "NaN", "Infinity", "1e3", "9007199254740992"]) {
      process.env.CUSTOMER_PHONE_OTP_DAILY_SEND_LIMIT = value;
      assert.throws(twilioVerifyConfig, /not configured/);
    }
    delete process.env.CUSTOMER_PHONE_OTP_DAILY_SEND_LIMIT;
    for (const name of names.slice(0, 3)) {
      const saved = process.env[name];
      delete process.env[name];
      assert.throws(twilioVerifyConfig, /not configured/);
      process.env[name] = saved;
    }
  } finally {
    names.forEach((name, index) => { if (before[index] === undefined) delete process.env[name]; else process.env[name] = before[index]; });
  }
});
