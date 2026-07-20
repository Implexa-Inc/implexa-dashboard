// node --test app/(dashboard)/_components/judge-feedback-controls.test.ts
//
// The reusable calibration control, shown on the review dialog AND on the run's
// Judge card for every verdict. Source-guarded invariants (mutation-checked).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const CTRL = read('app/(dashboard)/_components/judge-feedback-controls.tsx');
const CARD = read('app/(dashboard)/_components/run-judgment-card.tsx');

test('it posts to the FEEDBACK endpoint and NEVER resolves', () => {
  assert.match(CTRL, /judge-blocks\/\$\{encodeURIComponent\(judgmentId\)\}\/feedback/);
  assert.match(CTRL, /body:\s*\{ feedback: value \}/);
  assert.doesNotMatch(CTRL, /\/resolve`|resolution:/, 'rating accuracy must never resolve the block');
});

test('a SAVED rating is shown, not blank buttons that invite a second vote', () => {
  assert.match(CTRL, /const \[saved, setSaved\] = useState<Rating \| null>\(initial\)/, 'seeds from the saved value');
  assert.match(CTRL, /const showButtons = saved === null \|\| editing/, 'buttons hide once rated, unless changing');
  assert.match(CTRL, /You rated this/, 'the saved state is rendered');
  assert.match(CTRL, /setEditing\(true\)/, 'and an intentional change is allowed');
});

test('it REPORTS the save upward so an owner can survive a remount', () => {
  // The dialog passes onSaved and holds the rating; if the control never calls it,
  // closing and reopening the modal shows blank buttons again. Passing the prop is
  // not enough — it has to be invoked, and only after a SUCCESSFUL save.
  assert.match(CTRL, /onSaved\?\.\(value\)/, 'the control must invoke onSaved');
  const rateFn = CTRL.slice(CTRL.indexOf('async function rate'), CTRL.indexOf('const showButtons'));
  const failIdx = rateFn.indexOf('return;');
  const callIdx = rateFn.indexOf('onSaved?.(value)');
  assert.ok(callIdx > -1 && failIdx > -1 && callIdx > failIdx,
    'onSaved fires only after the failure path has returned — never on a failed save');
});

test('it states the rating does NOT change the run', () => {
  assert.match(CTRL, /doesn.t change this run/i);
});

test('P1: the run Judge card shows feedback for EVERY verdict, not just blocks', () => {
  // Observe mode needs representative data: a wrong `pass` is the most valuable
  // signal. The controls render on the card whenever there is a judgment id —
  // NOT gated on verdict === 'blocked'.
  assert.match(CARD, /<JudgeFeedbackControls judgmentId=\{judgment\.id\} initial=\{judgment\.feedback \?\? null\}/);
  // Strip comments so the guard reflects CODE, not the prose explaining it (my own
  // comment says "verdict"). In the stripped source, the JSX region wrapping the
  // control must not reference `verdict`, so a gate inserted anywhere there is
  // caught regardless of the exact opening token.
  const stripped = CARD
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const anchor = stripped.indexOf('<JudgeFeedbackControls');
  const region = stripped.slice(anchor - 200, anchor);
  assert.doesNotMatch(region, /verdict/, 'feedback must NOT be gated on the verdict type — a wrong pass is the key signal');
});
