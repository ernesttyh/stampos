// Offline behavioral tests: compile TS in memory and inject strict mocks. No service/network calls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const require = (name) => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}; network is not permitted in tests`);
    return mocks[name];
  };
  vm.runInNewContext(js, { module, exports: module.exports, require, process, Buffer, TextEncoder, Date, console });
  return module.exports;
}

function otpHarness() {
  const jar = new Map();
  const calls = { send: 0, verify: 0, client: [] };
  let rate = true;
  let result = { data: { user: { phone: "6591234567", phone_confirmed_at: "2026-01-01" }, session: { access_token: "must-not-leak" } }, error: null };
  const api = load("src/lib/customer-otp.ts", {
    "@supabase/supabase-js": { createClient: (...args) => {
      calls.client.push(args);
      return { auth: {
        signInWithOtp: async () => { calls.send++; return { error: null }; },
        verifyOtp: async () => { calls.verify++; return result; },
      } };
    } },
    "next/headers": { cookies: async () => ({ get: (name) => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value) }) },
    "node:crypto": { randomUUID: () => "challenge-nonce" },
    "./session": {
      authCookieOptions: { httpOnly: true },
      signAuthToken: async (purpose, payload) => JSON.stringify({ purpose, ...payload }),
      verifyAuthToken: async (purpose, value) => { const payload = value ? JSON.parse(value) : null; return payload?.purpose === purpose ? payload : null; },
    },
    "./phone": { normalisePhone: (phone) => phone === "bad" ? null : "+" + phone.replace(/\D/g, "") },
    "./auth-throttle": { authThrottle: async () => { if (rate instanceof Error) throw rate; return rate; }, requestAddress: () => "mock-ip" },
  });
  return { api, calls, jar, setRate: (r) => { rate = r; }, setResult: (r) => { result = r; } };
}
function enableOtp() {
  process.env.CUSTOMER_PHONE_OTP_ENABLED = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://offline.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anonymous-test-key";
}

test("OTP disabled/misconfigured fails before any provider calls", async () => {
  const h = otpHarness();
  delete process.env.CUSTOMER_PHONE_OTP_ENABLED;
  await assert.rejects(h.api.startPhoneChallenge({}, "pilot", "+6591234567"), /not configured/);
  assert.equal(h.calls.send, 0);
  assert.equal(h.calls.client.length, 0);
});

test("OTP uses anonymous client, server challenge, matching confirmed phone; never returns provider tokens", async () => {
  enableOtp();
  const h = otpHarness();
  assert.equal((await h.api.startPhoneChallenge({}, "pilot", "+6591234567")).status, 200);
  assert.equal(h.calls.send, 1);
  assert.equal(h.calls.client[0][1], "anonymous-test-key");
  assert.equal(h.calls.client[0][2].auth.persistSession, false);
  assert.equal(await h.api.getVerifiedPhone("pilot", "+6591234567"), null);
  assert.equal((await h.api.verifyPhoneChallenge({}, "other-brand", "+6591234567", "123456")).status, 400);
  assert.equal((await h.api.verifyPhoneChallenge({}, "pilot", "+6599999999", "123456")).status, 400);
  assert.equal(h.calls.verify, 0);
  const r = await h.api.verifyPhoneChallenge({}, "pilot", "+6591234567", "123456");
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(r).includes("must-not-leak"), false);
  assert.equal(await h.api.getVerifiedPhone("pilot", "+6591234567"), "+6591234567");
  assert.equal(await h.api.getVerifiedPhone("other-brand", "+6591234567"), null);
  assert.equal((await h.api.verifyPhoneChallenge({}, "pilot", "+6591234567", "123456")).status, 400);
  await h.api.clearPhoneProof();
  assert.equal(await h.api.getVerifiedPhone("pilot", "+6591234567"), null);
});

test("unconfirmed/mismatched provider identity cannot become a phone proof", async () => {
  enableOtp();
  const h = otpHarness();
  await h.api.startPhoneChallenge({}, "pilot", "+6591234567");
  for (const user of [{ phone: "6591234567" }, { phone: "6599999999", phone_confirmed_at: "2026-01-01" }]) {
    h.setResult({ data: { user }, error: null });
    assert.equal((await h.api.verifyPhoneChallenge({}, "pilot", "+6591234567", "123456")).status, 400);
    assert.equal(await h.api.getVerifiedPhone("pilot", "+6591234567"), null);
  }
});

test("durable limiter denial and failure never send OTP", async () => {
  enableOtp();
  const h = otpHarness();
  h.setRate(false);
  assert.equal((await h.api.startPhoneChallenge({}, "pilot", "+6591234567")).status, 429);
  h.setRate(new Error("database offline"));
  await assert.rejects(h.api.startPhoneChallenge({}, "pilot", "+6591234567"), /database offline/);
  assert.equal(h.calls.send, 0);
});

test("verified phone claims an old/admin-created profile without name overwrite or consent mutation", async () => {
  const existing = { id: "customer", brand_id: "brand", name: "Original Name", phone: "+6591234567", marketing_consent: false };
  const writes = [];
  const db = { from: (table) => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }) }),
    insert: async (row) => { writes.push({ table, row }); return { error: null }; },
  }) };
  const api = load("src/lib/customers.ts", {
    "./supabase/admin": { supabaseAdmin: () => db },
    "./phone": { normalisePhone: (phone) => phone },
    "./notify": { notifyCustomer: () => { throw new Error("No notifications permitted"); } },
  });
  const input = { name: "Different Name", phone: existing.phone, marketingConsent: true };
  assert.match((await api.signupOrLogin({ id: "brand" }, input)).error, /verify/);
  const r = await api.signupOrLogin({ id: "brand" }, { ...input, verifiedPhone: existing.phone });
  assert.equal(r.customer, existing);
  assert.equal(r.created, false);
  assert.equal(r.customer.name, "Original Name");
  assert.equal(r.customer.marketing_consent, false);
  assert.deepEqual(writes.map((w) => w.table), ["events"]);
});

test("staff operational session revalidates active account, version, role and outlet every time", async () => {
  const payload = { kind: "staff", purpose: "staff-session", version: 2, staffId: "staff", brandId: "brand", brandSlug: "pilot", outletId: "outlet", authVersion: 1 };
  let row = { active: true, auth_version: 1, outlet_id: null, name: "Current Name", role: "staff" };
  let outlet = { id: "outlet" };
  const db = { from: (table) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === "staff" ? row : table === "outlets" ? outlet : { slug: "pilot" }, error: null }) };
    return query;
  } };
  const api = load("src/lib/session.ts", {
    jose: { jwtVerify: async () => ({ payload }), SignJWT: class {} },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "test-token" }) }) },
    "./auth-safety": { sessionSecret: () => "test-secret-not-used-for-signing" },
    "./supabase/admin": { supabaseAdmin: () => db },
  });
  assert.equal((await api.getStaffSession()).name, "Current Name");
  row.active = false; assert.equal(await api.getStaffSession(), null);
  row.active = true; row.auth_version = 2; assert.equal(await api.getStaffSession(), null);
  row.auth_version = 1; row.outlet_id = "other-outlet"; assert.equal(await api.getStaffSession(), null);
  row.outlet_id = null; row.role = "unexpected"; assert.equal(await api.getStaffSession(), null);
  row.role = "staff"; outlet = null; assert.equal(await api.getStaffSession(), null);
});

const nextMock = { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
const request = (body = {}) => ({ json: async () => body });

test("signup rejects forged request-body verification and never creates a session", async () => {
  let called = false;
  const api = load("src/app/api/card/signup/route.ts", {
    "next/server": nextMock,
    "@/lib/brand": { getBrandBySlug: async () => ({ id: "brand", slug: "pilot" }) },
    "@/lib/customers": { signupOrLogin: async () => { called = true; throw new Error("must not reach"); } },
    "@/lib/session": { setCustomerSession: async () => { throw new Error("must not set session"); } },
    "@/lib/customer-otp": { getVerifiedPhone: async () => null, clearPhoneProof: async () => {} },
    "@/lib/auth-throttle": { sameOrigin: () => true },
  });
  const r = await api.POST(request({ slug: "pilot", name: "Victim", phone: "+6591234567", verifiedPhone: "+6591234567" }));
  assert.equal(r.status, 401);
  assert.equal(called, false);
});

test("creator agreement does not imply marketing consent; verified phone comes from server proof", async () => {
  let signupInput;
  const api = load("src/app/api/card/invite/route.ts", {
    "next/server": nextMock,
    "@/lib/customers": {
      getGrantByCode: async () => ({ status: "invited", brand: { id: "brand", slug: "pilot" } }),
      signupOrLogin: async (_brand, input) => { signupInput = input; return { customer: { id: "customer" } }; },
      acceptGrant: async () => ({ ok: true, upfront: 1, locked: 2 }),
    },
    "@/lib/session": { setCustomerSession: async () => {} },
    "@/lib/customer-otp": { getVerifiedPhone: async () => "+6591234567", clearPhoneProof: async () => {} },
    "@/lib/auth-throttle": { sameOrigin: () => true },
  });
  const body = { slug: "pilot", code: "INVITE", name: "Creator", phone: "+6591234567", agreementAccepted: true };
  assert.equal((await api.POST(request(body))).status, 200);
  assert.equal(signupInput.marketingConsent, false);
  assert.equal(signupInput.verifiedPhone, "+6591234567");
  assert.equal((await api.POST(request({ ...body, agreementAccepted: false }))).status, 400);
});

test("Telegram webhook without the required secret fails before database access or messaging", async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const api = load("src/app/api/telegram/webhook/route.ts", {
    "next/server": nextMock,
    "@/lib/supabase/admin": { supabaseAdmin: () => { throw new Error("No DB access expected"); } },
    "@/lib/telegram": { sendTelegram: () => { throw new Error("No messaging expected"); } },
    "@/lib/brand": { appUrl: () => "https://offline.invalid" },
    "@/lib/auth-safety": {},
  });
  const r = await api.POST({ headers: { get: () => null } });
  assert.equal(r.status, 401);
  process.env.TELEGRAM_WEBHOOK_SECRET = "configured-secret";
  assert.equal((await api.POST({ headers: { get: () => "wrong-secret" } })).status, 401);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});
