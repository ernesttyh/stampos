import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('code controls require a nonempty successfully requested phone', () => {
  const source=readFileSync('src/components/card/PhoneVerification.tsx','utf8');
  assert.match(source,/const codeRequested = Boolean\(phone && sentTo && sentTo === phone\)/);
  assert.match(source,/\{codeRequested && <div/);
  for (const [phone,sentTo,expected] of [['','',false],['+6590000001','',false],['+6590000001','+6590000002',false],['+6590000001','+6590000001',true]]) {
    assert.equal(Boolean(phone && sentTo && sentTo===phone),expected);
  }
});

test('page viewport does not prohibit customer zoom', () => {
  const source=readFileSync('src/app/layout.tsx','utf8');
  assert.doesNotMatch(source,/maximumScale\s*:\s*1\b|userScalable\s*:\s*false/);
});
