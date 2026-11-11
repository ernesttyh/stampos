import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/admin/onboarding.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, URLSearchParams, Error });
const { establishAdminSession, saveAdminPassword, INVALID_INVITE } = module.exports;

function harness({ signedIn = true, exchangeError = false, saveError = false } = {}) {
  const calls = [];
  const exchange = (name) => async (args) => {
    calls.push([name, args]);
    return { error: exchangeError ? { message: "sensitive provider details" } : null };
  };
  return { calls, auth: {
    exchangeCodeForSession: exchange("code"), verifyOtp: exchange("otp"), setSession: exchange("session"),
    getUser: async () => { calls.push(["user"]); return { data: { user: signedIn ? { id: "admin" } : null }, error: null }; },
    updateUser: async (args) => { calls.push(["update", args]); return { error: saveError ? { message: "sensitive details" } : null }; },
  } };
}

test("dashboard implicit invite and recovery establish a verified cookie-compatible session", async () => {
  for (const type of ["invite", "recovery"]) {
    const h = harness();
    await establishAdminSession(h.auth, new URL(`https://example.test/admin/set-password#access_token=access&refresh_token=refresh&type=${type}`));
    assert.equal(h.calls[0][0], "session");
    assert.equal(h.calls[0][1].access_token, "access");
    assert.equal(h.calls[0][1].refresh_token, "refresh");
    assert.equal(h.calls[1][0], "user");
  }
});

test("PKCE code and invite/recovery token hashes use supported exchanges", async () => {
  const h = harness();
  await establishAdminSession(h.auth, new URL("https://example.test/auth/callback?code=pkce&next=https://evil.test"), true);
  assert.deepEqual(h.calls[0], ["code", "pkce"]);
  for (const type of ["invite", "recovery"]) {
    const otp = harness();
    await establishAdminSession(otp.auth, new URL(`https://example.test/auth/callback?token_hash=hash&type=${type}`), true);
    assert.equal(otp.calls[0][0], "otp");
    assert.equal(otp.calls[0][1].type, type);
    assert.equal(otp.calls[0][1].token_hash, "hash");
  }
});

test("invalid/expired links never fall back to an existing signed-in user", async () => {
  for (const suffix of ["?error=access_denied", "#error_code=otp_expired", "?token_hash=hash&type=signup", "?token_hash=hash", "?code=", "#access_token=access&type=invite", "#access_token=access&refresh_token=refresh&type=signup"]) {
    const h = harness();
    await assert.rejects(establishAdminSession(h.auth, new URL(`https://example.test/admin/set-password${suffix}`)), { message: INVALID_INVITE });
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ exchangeError: true });
  await assert.rejects(establishAdminSession(h.auth, new URL("https://example.test/auth/callback?code=expired")), { message: INVALID_INVITE });
  assert.equal(h.calls.length, 1);
});

test("plain password page requires verified user; callback additionally requires a link", async () => {
  await establishAdminSession(harness().auth, new URL("https://example.test/admin/set-password"));
  await assert.rejects(establishAdminSession(harness({ signedIn: false }).auth, new URL("https://example.test/admin/set-password")), { message: INVALID_INVITE });
  await assert.rejects(establishAdminSession(harness().auth, new URL("https://example.test/auth/callback"), true), { message: INVALID_INVITE });
});

test("password validation and session verification happen before password update", async () => {
  const h = harness();
  await assert.rejects(saveAdminPassword(h.auth, "short", "short"), /at least 12/);
  await assert.rejects(saveAdminPassword(h.auth, "long-password", "different-password"), /do not match/);
  assert.equal(h.calls.length, 0);
  const expired = harness({ signedIn: false });
  await assert.rejects(saveAdminPassword(expired.auth, "long-password", "long-password"), { message: INVALID_INVITE });
  assert.equal(expired.calls.length, 1);
  await saveAdminPassword(h.auth, "long-password", "long-password");
  assert.equal(h.calls[0][0], "user");
  assert.equal(h.calls[1][0], "update");
  assert.equal(JSON.stringify(h.calls[1][1]), JSON.stringify({ password: "long-password" }));
});

test("provider password errors are generic, without leaking provider details", async () => {
  await assert.rejects(saveAdminPassword(harness({ saveError: true }).auth, "long-password", "long-password"), /We could not save your password/);
});

test("UI scrubs credentials before client initialization and uses only fixed local destinations", () => {
  const ui = readFileSync(new URL("../src/components/admin/AdminPasswordSetup.tsx", import.meta.url), "utf8");
  assert.ok(ui.indexOf("window.history.replaceState") < ui.indexOf("establishAdminSession(supabaseBrowser()"));
  assert.match(ui, /router\.replace\("\/admin\/set-password"\)/);
  assert.match(ui, /router\.replace\("\/admin"\)/);
  assert.match(ui, /initialization\.current = establishAdminSession/);
  assert.doesNotMatch(ui + source, /console\.|is_platform_admin|user_metadata|app_metadata|\.from\(/);
});
