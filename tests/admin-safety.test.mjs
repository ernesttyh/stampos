import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function authHarness(role = "viewer", platform = false) {
  const source = readFileSync(new URL("../src/lib/admin-auth.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let failed = false;
  const db = { from(table) {
    const result = () => failed ? { data: null, error: { message: "offline" } } : {
      data: table === "profiles" ? { is_platform_admin: platform } : table === "brand_members" ? [{ brand_id: "brand-a", role }] : { id: "brand-a", slug: "pilot" }, error: null,
    };
    const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => result(), then(resolve) { return Promise.resolve(result()).then(resolve); } };
    return q;
  } };
  const mocks = {
    "next/navigation": { redirect: (path) => { throw new Error(`REDIRECT:${path}`); } },
    "./supabase/server": { supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "actor", email: "test@example.invalid" } } }) } }) },
    "./supabase/admin": { supabaseAdmin: () => db },
  };
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, console });
  return { api: module.exports, fail: () => { failed = true; } };
}

test("viewer can read brand but cannot perform writes or owner actions", async () => {
  const { api } = authHarness();
  assert.equal((await api.requireBrand("pilot")).brand.id, "brand-a");
  await assert.rejects(api.requireBrand("pilot", "write"), /view-only/);
  await assert.rejects(api.requireBrand("pilot", "owner"), /view-only/);
});
test("manager can operate but cannot manage programme or staff", async () => {
  const { api } = authHarness("manager");
  assert.equal((await api.requireBrand("pilot", "write")).user.brandRoles["brand-a"], "manager");
  await assert.rejects(api.requireBrand("pilot", "owner"), /view-only/);
});
test("owner and platform admin can perform owner operations", async () => {
  assert.equal((await authHarness("owner").api.requireBrand("pilot", "owner")).brand.id, "brand-a");
  assert.equal((await authHarness("viewer", true).api.requireBrand("pilot", "owner")).user.isPlatformAdmin, true);
});
test("membership/database failure rejects rather than assuming access", async () => {
  const h = authHarness("owner"); h.fail();
  await assert.rejects(h.api.requireBrand("pilot", "write"), /Unable to verify/);
});
