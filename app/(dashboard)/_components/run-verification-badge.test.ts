import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'run-verification-badge.tsx'), 'utf8');

// A run showed the top badge as "Verified" at the exact same time Implexa
// Judge's own verdict was `uncertain` — plain "Verified" reads as "Judge
// approved this", but this badge has never meant that; it means the
// deliverable exists (a narrower, different claim from server-side exit/
// output evidence). Renamed to "Delivered" so the two claims can never look
// like they're contradicting each other.
test('the delivery badge says "Delivered", never plain "Verified"', () => {
  assert.match(src, /label:\s*'Delivered'/, 'verified_complete must render as Delivered');
  assert.doesNotMatch(src, /label:\s*'Verified'/, 'the old label must not survive anywhere in the spec table');
});

test('the tooltip explicitly disambiguates this badge from Judge review', () => {
  assert.match(src, /separate from Implexa Judge review/i);
});

test('the other two verdicts (incomplete/unverified) are unchanged by the rename', () => {
  assert.match(src, /label:\s*'May be incomplete'/);
  assert.match(src, /label:\s*'Unverified'/);
});
