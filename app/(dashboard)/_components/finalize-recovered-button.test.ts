// node --test "app/(dashboard)/_components/finalize-recovered-button.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const btn = readFileSync(join(dir, 'finalize-recovered-button.tsx'), 'utf8');

test('finalize calls the runs finalize route, not a generic resolve endpoint', () => {
  assert.match(btn, /\/api\/v2\/runs\/\$\{runId\}\/finalize/, 'must hit the run-scoped finalize route');
  assert.match(btn, /method:\s*'POST'/);
});

test('a confirm step exists — finalize never fires on a single click', () => {
  assert.match(btn, /state === 'confirm'/);
  assert.match(btn, /onClick=\{\(\) => setState\('confirm'\)\}/, 'the visible button opens confirm, it does not finalize directly');
});

test('a 409 (superseded/reported/live underneath the user) refreshes instead of erroring', () => {
  assert.match(btn, /e\.status === 409\) \{ router\.refresh\(\); return; \}/,
    'the 2026-07-24 cross-feature case (already_recovered_elsewhere) is a 409 and must read as "refresh", not "error"');
});

test('the button never claims delivery — it is explicit that this is recovered, not delivered', () => {
  assert.match(btn, /saved as .*recovered.*,\s*\n\s*not delivered/s);
});

// Caught by tsc, not by eye: gating the card render on state === 'confirm'
// ALONE type-narrows `state` to the literal 'confirm' inside that block, so a
// later `state === 'busy'` check reads as a compile error (impossible
// comparison) — which is what surfaced that 'busy' was never actually part of
// the render gate. At runtime that meant finalize()'s setState('busy') re-render
// fell through to the bare CTA, silently dropping the "Finalizing…" state and
// leaving the button clickable again mid-request.
test('the card stays open for busy AND error, not just confirm — the exact gap tsc caught', () => {
  assert.match(btn, /state === 'confirm' \|\| state === 'busy' \|\| state === 'error'/,
    'all three in-flight/failed states must keep showing the card; confirm alone drops busy and error on the next render');
});

// The twin of the above: setState('error') + setNote(message) on a failed
// finalize has NOWHERE to render if the gate only covers confirm/busy — the
// user would see the plain "Mark as done" button again with zero indication
// anything went wrong, silently losing the error entirely.
test('the error note only makes sense if the error state also renders the card that shows it', () => {
  const i = btn.indexOf(`state === 'confirm' || state === 'busy' || state === 'error'`);
  assert.notEqual(i, -1);
  const block = btn.slice(i, i + 700);
  assert.match(block, /\{note && <p/, 'the note must render inside the SAME branch the error state reaches');
});

test('busy disables both buttons — the confirm click cannot fire twice, and Cancel cannot abandon an in-flight request', () => {
  assert.match(btn, /disabled=\{busy\}[\s\S]{0,160}Yes, mark this done/);
  assert.match(btn, /disabled=\{busy\}[\s\S]{0,100}Cancel/);
});
