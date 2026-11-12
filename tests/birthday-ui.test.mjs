import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("birthday uses a bounded display shell and empty placeholder, not today's date", () => {
  const source = readFileSync("src/components/card/BirthdayInput.tsx", "utf8");
  assert.match(source, /DD \/ MM \/ YYYY/);
  assert.match(source, /min-w-0 max-w-full/);
  assert.match(source, /overflow-hidden/);
  assert.match(source, /absolute inset-0 block h-full w-full min-w-0 max-w-full/);
  assert.match(source, /type="date"/);
  assert.match(source, /value=\{value\}/);
  assert.match(source, /aria-describedby="birthday-help"/);
  assert.match(source, /aria-label="Clear birthday"/);
  assert.match(source, /onChange\(""\)/);
  assert.doesNotMatch(source, /defaultValue|required/);
});
