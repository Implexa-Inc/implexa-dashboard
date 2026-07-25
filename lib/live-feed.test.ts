// node --test lib/live-feed.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveItems } from './live-feed.ts';

// The all-clear on Home ("Nothing needs you right now") may only be claimed when
// the live feed is READY. Ready is derived from this parse: a null result means
// unavailable, which suppresses the claim. So each case below is really asking
// "could a malformed-but-successful response make Home lie?"

test('a well-formed response yields the items — the only case that counts as READY', () => {
  const r = parseLiveItems<{ id: string }>({ items: [{ id: 'a' }, { id: 'b' }] });
  assert.deepEqual(r, [{ id: 'a' }, { id: 'b' }]);
});

test('a genuinely empty live feed is READY and empty — the all-clear must still be reachable', () => {
  // The guard must not overshoot: if it called a real empty feed unreadable,
  // Home could never say "nothing needs you" at all, which is its own dishonesty.
  const r = parseLiveItems({ items: [] });
  assert.deepEqual(r, [], 'an explicit empty array is a real answer, not a missing one');
});

// ── Every "successful" response that is NOT a real answer ────────────────────
// callBackend only throws on a non-2xx status, so all of these reach the caller
// as an ordinary success. Each one used to become `[]` → ready → all-clear.

test('a MISSING items field is unreadable, never empty (schema drift)', () => {
  assert.equal(parseLiveItems({}), null);
  assert.equal(parseLiveItems({ data: [] }), null, 'a renamed field must not read as "nothing live"');
});

test('an explicitly NULL items field is unreadable', () => {
  assert.equal(parseLiveItems({ items: null }), null);
});

test('a WRONG-SHAPE items field is unreadable', () => {
  assert.equal(parseLiveItems({ items: {} }), null, 'array → object is exactly the drift this catches');
  assert.equal(parseLiveItems({ items: 'none' }), null);
  assert.equal(parseLiveItems({ items: 0 }), null);
});

test('an empty or non-JSON 200 body is unreadable', () => {
  // callBackend returns `parsed`, which is null when the body was empty or did
  // not parse — with no throw. This is the quietest version of the bug.
  assert.equal(parseLiveItems(null), null);
  assert.equal(parseLiveItems(undefined), null);
  assert.equal(parseLiveItems(''), null);
  assert.equal(parseLiveItems('OK'), null, 'a plain-text 200 must not read as an empty feed');
  assert.equal(parseLiveItems([]), null, 'a bare array is not the documented envelope');
});
