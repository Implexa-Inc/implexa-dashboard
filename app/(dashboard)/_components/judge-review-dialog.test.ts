// node --test app/(dashboard)/_components/judge-review-dialog.test.ts
//
// Source guards over invariants a screenshot cannot prove and that, if broken,
// silently strand the user or corrupt calibration. Each is mutation-checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const DLG = read('app/(dashboard)/_components/judge-review-dialog.tsx');
const STRIP = read('app/(dashboard)/_components/needs-you-strip.tsx');

test('the client no longer asserts a resolution — the server derives it', () => {
  // A second copy of the mapping here is the drift this workstream keeps paying
  // for, and a client-asserted resolution made the calibration record
  // unfalsifiable. Both now live only in the backend.
  assert.doesNotMatch(DLG, /resolution:/, 'no client-side resolution mapping');
  assert.match(DLG, /body:\s*\{ continuePrompt \}/, 'only the continuation is sent');
});

test('P1: a PREREQUISITE (grant/sign-in) has NO queue-nothing path — it must resume', () => {
  // The release blocker: "I've handled this" with continuePrompt:null resolved the
  // block and queued nothing, abandoning a mid-flight run. grant_permission and
  // open_service now ALWAYS continue; only review_result may close without one.
  const grant = DLG.slice(DLG.indexOf('grant_permission: {'), DLG.indexOf('open_service: {'));
  const openSvc = DLG.slice(DLG.indexOf('open_service: {'), DLG.indexOf('review_result: {'));
  const review = DLG.slice(DLG.indexOf('review_result: {'), DLG.indexOf('};', DLG.indexOf('review_result: {')));
  assert.match(grant, /allowClose: false/, 'a granted permission must not offer a queue-nothing close');
  assert.match(openSvc, /allowClose: false/, 'a completed sign-in must not offer a queue-nothing close');
  assert.match(review, /allowClose: true/, 'only a reviewed judgement call may close without continuing');
  // Each prerequisite carries a non-empty resume prompt so an empty box still resumes.
  assert.match(grant, /resumePrompt: '[^']+continue/i, 'grant must have a real resume prompt');
  assert.match(openSvc, /resumePrompt: '[^']+continue/i, 'sign-in must have a real resume prompt');
});

test('the null-continuation close is rendered ONLY when allowClose', () => {
  assert.match(DLG, /ui\.allowClose && \(/, 'the "close without continuing" button is gated on allowClose');
  assert.match(DLG, /resolve\(null, 'close'\)/, 'and only that path passes a null continuation');
});

test('the primary button ALWAYS continues with a non-null prompt', () => {
  assert.match(DLG, /resolve\(fix\.trim\(\) \|\| ui\.resumePrompt, 'continue'\)/,
    'an empty box for a prerequisite still resumes via resumePrompt — never queue nothing');
});

test('only provide_information requires text (the answer IS the info)', () => {
  const pi = DLG.slice(DLG.indexOf('provide_information: {'), DLG.indexOf('provide_information: {') + 220);
  assert.match(pi, /requireText: true/);
  assert.match(DLG, /const canContinue = ui\.requireText \? !!fix\.trim\(\) : true/);
});

test('resolve hits the RESOLVE endpoint; feedback is delegated, not inlined', () => {
  assert.match(DLG, /judge-blocks\/\$\{encodeURIComponent\(judgmentId\)\}\/resolve/);
  assert.match(DLG, /<JudgeFeedbackControls judgmentId=\{judgmentId\} initial=\{feedback\}/,
    'feedback is the reusable control, seeded with the card-owned rating');
  assert.doesNotMatch(DLG, /\/feedback`/, 'the dialog must not re-implement the feedback POST');
});

test('a FAILED resolve keeps the dialog open — the block must stay visible', () => {
  assert.match(DLG, /if \(!res \|\| res\.ok !== true\) \{ setError\([\s\S]*?\); setBusy\(null\); return; \}/);
  const resolveFn = DLG.slice(DLG.indexOf('async function resolve'), DLG.indexOf('// The primary button'));
  assert.ok(resolveFn.indexOf('return;') < resolveFn.indexOf('onResolved()'), 'failure returns before the success close');
});

test('copy no longer claims the run "stopped instead of guessing"', () => {
  // Not always true: the worker may have completed and the Judge then found a problem.
  assert.match(DLG, /found something that needs your attention/i);
  assert.doesNotMatch(DLG, /stopped instead of guessing/i);
});

test('the strip routes a judge_block to the dialog, everything else to the link', () => {
  assert.match(STRIP, /if \(item\.sourceType === 'judge_block'\) return <JudgeReviewCard item=\{item\} \/>/);
});

// ── accessibility: real focus management, not just role attributes ───────────

test('the modal is a labelled dialog with a focusable container', () => {
  assert.match(DLG, /role="dialog" aria-modal="true" aria-labelledby="judge-review-title"/);
  assert.match(DLG, /id="judge-review-title"/, 'the label target exists');
  assert.match(DLG, /tabIndex=\{-1\}/, 'the container can receive initial focus');
});

test('Escape dismisses, and focus is TRAPPED then RESTORED', () => {
  assert.match(DLG, /e\.key === 'Escape'.*stableClose\(\)/s, 'Escape closes');
  assert.match(DLG, /if \(e\.key !== 'Tab'\) return;/, 'Tab is intercepted for the trap');
  assert.match(DLG, /e\.shiftKey && active === first.*last\.focus\(\)/s, 'shift-Tab wraps to the end');
  assert.match(DLG, /active === last.*first\.focus\(\)/s, 'Tab wraps to the start');
  assert.match(DLG, /\(focusables\(\)\[0\] \|\| node\)\?\.focus\(\)/, 'initial focus enters the dialog');
  assert.match(DLG, /restoreFocusTo\.current\?\.focus\?\.\(\)/, 'focus returns to the trigger on close');
});

test('the focus trap CONTAINS focus that escaped the dialog', () => {
  // Clicking a feedback button removes it from the DOM (replaced by saved-state
  // text), so focus falls to <body> — neither first nor last. Without a
  // containment fallback every later Tab walks the page behind the modal.
  assert.match(DLG, /if \(!node \|\| !active \|\| !node\.contains\(active\)\)/,
    'focus outside the dialog must be pulled back in');
  assert.match(DLG, /\(e\.shiftKey \? last : first\)\.focus\(\)/, 'and land at the correct end');
});

test('the saved rating is owned by the CARD, so a reopen does not lose it', () => {
  // The modal unmounts on close; a control-local rating would vanish and the
  // reopened dialog would show blank buttons, inviting a second vote.
  assert.match(DLG, /const \[feedback, setFeedback\] = useState\(item\.feedback \?\? null\)/);
  assert.match(DLG, /onFeedbackSaved=\{setFeedback\}/, 'the control reports upward');
  assert.match(DLG, /initial=\{feedback\} onSaved=\{onFeedbackSaved\}/, 'and is seeded from the card state');
});
