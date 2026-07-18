// node --test "app/(dashboard)/_components/api-key-waiting-state.test.ts"
// (Node 22.6+ strips the types natively)
//
// REGRESSION GUARD — the key-entry "waiting" state must never trap the user.
//
// THIS BUG HAS SHIPPED TWICE. The #56 reviewer raised it as a P1 ("cancelling
// the local key window leaves the dashboard on 'Waiting for you to save…' until
// refresh — it needs a cancellation event so the Add key button returns"), and
// it was then reproduced verbatim in InlineAddKeyButton when that component was
// written for the requirements panel. The founder hit it live: clicked "Add API
// key", closed the window without saving, and both rows sat on "Waiting for
// save…" with no control at all and no way back short of a page reload.
//
// Root cause is structural, not cosmetic: the desktop bridge fires an event when
// a key IS saved (onKeysChanged) but has NO event for "the user closed the
// window without saving". So `awaiting` had exactly one exit — a successful save
// — and every other path (close, cancel, walk away) was a dead end. A real
// cancel event needs a desktop release; these two invariants fix it against the
// CURRENT installed app and stay correct once that event lands:
//
//   1. The control stays CLICKABLE while awaiting (re-opens the window).
//   2. The wait SELF-EXPIRES, so it stops claiming a save is still coming.
//
// Both components that render key entry must hold both invariants.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, 'api-key-row.tsx'), 'utf8');

function componentBody(name: string) {
  const start = src.indexOf(`export function ${name}`);
  assert.ok(start !== -1, `${name} must still exist`);
  // Up to the next top-level export (or EOF).
  const next = src.indexOf('\nexport function ', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

test('InlineAddKeyButton never renders a dead span while awaiting — the exact founder-reported trap', () => {
  const body = componentBody('InlineAddKeyButton');
  // The original bug, verbatim: `if (awaiting) { return <span>…</span>; }` —
  // an early return that drops the button entirely.
  assert.doesNotMatch(
    body,
    /if \(awaiting\)\s*\{\s*return\s*<span/,
    'awaiting must NOT early-return a non-interactive <span> — that is precisely what left the row with no way back',
  );
  // The button must be reachable on the awaiting path: the only early returns
  // allowed before it are `configured` (success) and no-bridge (plain web).
  assert.match(body, /if \(configured\)\s*\{\s*return/, 'configured may early-return (success state)');
  assert.match(body, /if \(!bridge\?\.openKeySetup\)/, 'no-bridge may early-return (nothing to click)');
  assert.match(body, /\{awaiting \? 'Waiting for save… — reopen' : 'Add API key'\}/, 'the awaiting state must relabel the SAME button, not replace it');
});

test('KeyRow keeps its Add-key control visible while awaiting', () => {
  const body = componentBody('KeyRow');
  // The original hid the whole button cluster behind `!awaiting`.
  assert.doesNotMatch(
    body,
    /\{!item\.configured && !awaiting && \(/,
    'the control cluster must not be hidden by !awaiting — that strands the row mid-flow',
  );
  assert.match(body, /\{!item\.configured && \(/, 'the cluster is gated on configured only');
  assert.match(body, /\{awaiting \? 'Reopen' : 'Add key'\}/, 'the button relabels to Reopen while awaiting');
});

test('both components expire the wait instead of polling forever', () => {
  assert.match(src, /const KEY_WAIT_TIMEOUT_MS = 90 \* 1000;/, 'a shared, named timeout — not a magic number duplicated per component');
  for (const name of ['KeyRow', 'InlineAddKeyButton']) {
    const body = componentBody(name);
    assert.match(
      body,
      /setTimeout\(\(\) => \{ done = true; setAwaiting\(false\); \}, KEY_WAIT_TIMEOUT_MS\)/,
      `${name} must self-expire the awaiting state`,
    );
    assert.match(body, /clearTimeout\(expiry\)/, `${name} must clear its expiry timer on unmount (no leak, no setState after unmount)`);
  }
});
