import test from "node:test";
import assert from "node:assert/strict";
import { integer, requiredText, uuid, webUrl, hexColor } from "../src/lib/validation";
import { normalisePhone } from "../src/lib/phone";

test("whole-number limits reject fractions, nonfinite and out of range", () => {
  assert.equal(integer("4", 1, 4, "Bowls"), 4);
  for (const value of ["1.5", "Infinity", "no", "0", "5"]) assert.throws(() => integer(value, 1, 4, "Bowls"));
});
test("required fields and request IDs fail closed", () => {
  assert.equal(requiredText(" Ada ", "Name"), "Ada");
  assert.throws(() => requiredText(" ", "Name"));
  assert.throws(() => requiredText("too long", "Name", 3));
  assert.equal(uuid("b2c8a015-44a1-4d9d-9e10-f42ae06dc487"), "b2c8a015-44a1-4d9d-9e10-f42ae06dc487");
  assert.throws(() => uuid("not-a-request"));
});
test("post links reject scripts, plaintext HTTP and embedded credentials", () => {
  assert.equal(webUrl(""), null);
  assert.equal(webUrl("https://instagram.com/p/example"), "https://instagram.com/p/example");
  for (const value of ["javascript:alert(1)", "http://example.com", "https://user:pass@example.com"]) assert.throws(() => webUrl(value));
  assert.equal(hexColor("#AABBCC"), "#AABBCC");
  assert.throws(() => hexColor("red; color:black"));
});
test("creator phone formats resolve to the same account key", () => {
  assert.equal(normalisePhone("9123 4567"), "+6591234567");
  assert.equal(normalisePhone("+65 9123 4567"), "+6591234567");
  assert.equal(normalisePhone("0065 9123 4567"), "+6591234567");
  assert.equal(normalisePhone("abc"), null);
});
