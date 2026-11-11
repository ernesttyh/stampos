import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { singaporeLocalDigits } from "../src/lib/phone";

test("fixed Singapore prefix accepts local, spaced and full pasted numbers", () => {
  for (const value of ["91234567", "9123 4567", "+65 9123 4567", "006591234567", "6591234567"]) {
    assert.equal(singaporeLocalDigits(value), "91234567");
  }
  assert.equal(singaporeLocalDigits(""), "");
});

test("join verification opens the card only after phone-bound verification", () => {
  const source = readFileSync("src/components/card/JoinForm.tsx", "utf8");
  assert.match(source, /Verify and open my card/);
  assert.match(source, /confirmedPhone !== `\+65\$\{currentPhone.current\}`/);
  assert.match(source, /setVerifiedPhone\(confirmedPhone\); await openCard\(\)/);
  assert.match(source, /phone: `\+65\$\{phone\}`/);
  assert.match(source, /useState\(false\)/); // marketing remains opt-in
});

test("verification supports Enter without submitting unverified signup", () => {
  const source = readFileSync("src/components/card/PhoneVerification.tsx", "utf8");
  assert.match(source, /e.key === "Enter"/);
  assert.match(source, /e.preventDefault\(\)/);
  assert.match(source, /await onVerified\(phone\)/);
});
