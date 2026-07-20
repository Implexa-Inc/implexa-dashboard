// node --test app/(dashboard)/_components/judge-review-dialog.test.ts
//
// The review/fix dialog is a client component (DOM + Supabase + router), so this
// is a SOURCE GUARD over the invariants that a screenshot cannot prove and that,
// if broken, silently corrupt the calibration signal or strand the user:
//
//   • the typed action maps to the right resolution REASON (the calibration data),
//   • "Continue with this fix" and "I've handled this" hit the RESOLVE endpoint,
//   • Accurate/Not accurate hit the FEEDBACK endpoint and NEVER resolve,
//   • a FAILED resolve keeps the dialog open (the block stays visible),
//   • the strip routes a judge_block to this dialog, others to the plain link.
//
// Each assertion is mutation-checked (see the sibling matrix in review), so a
// regex that stops matching means the invariant moved, not that the test rotted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const DLG = read('app/(dashboard)/_components/judge-review-dialog.tsx');
const STRIP = read('app/(dashboard)/_components/needs-you-strip.tsx');

test('the typed action maps to a specific resolution reason, never a generic one', () => {
  for (const [action, reason] of [
    ['provide_information', 'provided_information'],
    ['grant_permission', 'granted_permission'],
    ['open_service', 'opened_service'],
    ['review_result', 'reviewed'],
  ]) {
    assert.match(DLG, new RegExp(`${action}:\\s*'${reason}'`),
      `${action} must resolve as ${reason} — the calibration signal for whether blocked verdicts are actionable`);
  }
});

test('resolve hits the RESOLVE endpoint with resolution + continuePrompt', () => {
  assert.match(DLG, /judge-blocks\/\$\{encodeURIComponent\(judgmentId\)\}\/resolve/);
  assert.match(DLG, /body:\s*\{ resolution, continuePrompt \}/, 'the edited fix is the continuation');
});

test('"Continue with this fix" sends the edited text; "I\'ve handled this" sends null', () => {
  assert.match(DLG, /resolve\(fix\.trim\(\), 'continue'\)/, 'continue sends the edited fix');
  assert.match(DLG, /resolve\(null, 'handled'\)/, 'handled resolves with NO continuation');
});

test('feedback hits the FEEDBACK endpoint and is orthogonal to resolve', () => {
  assert.match(DLG, /judge-blocks\/\$\{encodeURIComponent\(judgmentId\)\}\/feedback/);
  // rate() must never call resolve(), or a "not accurate" click could clear the block.
  const rateFn = DLG.slice(DLG.indexOf('async function rate'), DLG.indexOf('async function rate') + 500);
  assert.doesNotMatch(rateFn, /\bresolve\(/, 'rating accuracy must NEVER resolve — the work may still need a human');
  assert.match(DLG, /body:\s*\{ feedback: value \}/);
});

test('a FAILED resolve keeps the dialog open — the block must stay visible', () => {
  // onResolved (which closes + refreshes) may only fire on ok===true. On failure
  // the dialog sets an error and stays, mirroring the backend leaving the block open.
  assert.match(DLG, /if \(!res \|\| res\.ok !== true\) \{ setError\([\s\S]*?\); setBusy\(null\); return; \}/,
    'a failed enqueue must surface the error and NOT close');
  assert.match(DLG, /onResolved\(\);/, 'success closes');
  const resolveFn = DLG.slice(DLG.indexOf('async function resolve'), DLG.indexOf('async function rate'));
  const errIdx = resolveFn.indexOf('return;');
  const okIdx = resolveFn.indexOf('onResolved()');
  assert.ok(errIdx > -1 && okIdx > errIdx, 'the failure path returns BEFORE the success close');
});

test('the strip routes a judge_block to the dialog, everything else to the link', () => {
  assert.match(STRIP, /if \(item\.sourceType === 'judge_block'\) return <JudgeReviewCard item=\{item\} \/>/,
    'a Judge block is actionable here; a held/stalled run keeps its link to the run');
});

test('the modal is dismissable and accessible', () => {
  assert.match(DLG, /role="dialog" aria-modal="true"/, 'it is a real modal (rare interruptions are modals, not inline)');
  assert.match(DLG, /onClick=\{onClose\}/, 'backdrop closes');
  assert.match(DLG, /e\.stopPropagation\(\)/, 'but a click inside does not');
});

test('the feedback copy states it does NOT change the run', () => {
  assert.match(DLG, /doesn.t change this run/i,
    'the user must know rating accuracy is calibration, not an action on the work');
});
