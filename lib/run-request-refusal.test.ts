import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BackendError } from './api.ts';
import { runRequestRefusalCopy, classifyRunRequestRefusal } from './run-request-refusal.ts';

const REQUEST = '76669b5c-bb85-4785-820a-6103cbc90316';
const refusal = (reason: string, extra: Record<string, unknown> = {}) =>
  new BackendError(reason, 400, { ok: false, reason, ...extra });

test('Review Room retry refusals retain their distinct recovery meaning', () => {
  const cases = [
    ['review_continuation_still_running', 'still running'],
    ['review_continuation_live_state_unknown', 'can’t yet verify|cannot yet verify'],
    ['review_continuation_not_terminal', 'has not finished yet'],
    ['review_continuation_cancelled', 'cancelled'],
    ['review_submission_already_reported', 'already finished'],
    ['review_retry_schema_unavailable', 'temporarily unavailable'],
  ];
  for (const [reason, phrase] of cases) {
    assert.match(runRequestRefusalCopy(refusal(reason), 'fallback'), new RegExp(phrase, 'i'));
  }
});

test('"still running" and "unable to verify" are DIFFERENT states, not two spellings of failure', () => {
  // The 2026-08-11 UX defect in one assertion. Both refusals rendered as the
  // same grey dead-end sentence, so the user could not tell "wait" from "do
  // something specific" — and the specific thing was one they had already done.
  const running = classifyRunRequestRefusal(refusal('review_continuation_still_running', { requestId: REQUEST }))!;
  const unknown = classifyRunRequestRefusal(refusal('review_continuation_live_state_unknown', { requestId: REQUEST }))!;
  assert.equal(running.kind, 'still_running');
  assert.equal(unknown.kind, 'unverifiable');
  assert.notEqual(running.message, unknown.message);
  assert.deepEqual(running.action, { type: 'wait' });
  assert.deepEqual(unknown.action, { type: 'restart_executor_then_retry', executorLabel: 'ChatGPT / Codex' });
  assert.equal(running.recoverable, false, 'a live attempt must offer no retry button at all');
  assert.equal(unknown.recoverable, true, 'and an unverifiable one must offer the action that produces the proof');
});

test('the state_unknown copy names the action, not just the fact', () => {
  const copy = runRequestRefusalCopy(refusal('review_continuation_live_state_unknown'), 'fallback');
  assert.match(copy, /quit and reopen/i, 'the old copy stopped at the fact, which is why it read as a dead end');
  assert.match(copy, /retry/i);
  assert.match(copy, /nothing was queued/i, 'and it must still say plainly that nothing started');
});

test('a terminal revision offers new work, never a retry', () => {
  for (const reason of ['review_continuation_cancelled', 'review_submission_already_reported', 'review_submission_not_retryable']) {
    const classified = classifyRunRequestRefusal(refusal(reason, { requestId: REQUEST }))!;
    assert.equal(classified.kind, 'terminal');
    assert.deepEqual(classified.action, { type: 'start_new_work' });
    assert.equal(classified.recoverable, false);
  }
});

test('recovery is offered ONLY when the backend named the request', () => {
  const withId = classifyRunRequestRefusal(refusal('review_continuation_live_state_unknown', { requestId: REQUEST }))!;
  const withoutId = classifyRunRequestRefusal(refusal('review_continuation_live_state_unknown'))!;
  assert.equal(withId.recoverable, true);
  assert.equal(withId.requestId, REQUEST);
  assert.equal(withoutId.recoverable, false, 'no address means no button — never a guessed one');
  assert.equal(withoutId.requestId, null);
});

test('unknown or non-backend failures use the caller-owned safe fallback', () => {
  assert.equal(runRequestRefusalCopy(new Error('private transport detail'), 'Try again.'), 'Try again.');
  assert.equal(runRequestRefusalCopy(refusal('some_new_reason'), 'Try again.'), 'Try again.');
  assert.equal(classifyRunRequestRefusal(new Error('boom')), null, 'a transport error is not a diagnosis');
  const unrecognised = classifyRunRequestRefusal(refusal('some_new_reason'))!;
  assert.equal(unrecognised.kind, 'unknown');
  assert.equal(unrecognised.recoverable, false);
  assert.doesNotMatch(unrecognised.message, /some_new_reason/,
    'a raw SQL or RPC reason must never become product copy');
});

test('both continuation surfaces render the typed refusal instead of a generic catch', () => {
  const root = path.resolve(import.meta.dirname, '..');
  for (const file of ['run-actions.tsx', 'run-continue-box.tsx']) {
    const source = fs.readFileSync(path.join(root, 'app', '(dashboard)', '_components', file), 'utf8');
    assert.match(source, /runRequestRefusalCopy[\s\S]*from '@\/lib\/run-request-refusal';/);
    assert.match(source, /set(?:Err|Msg)\(runRequestRefusalCopy\((?:error|e), 'Could not queue/);
  }
});

test('both surfaces hand a recoverable refusal to the recovery panel', () => {
  const root = path.resolve(import.meta.dirname, '..');
  for (const file of ['run-actions.tsx', 'run-continue-box.tsx']) {
    const source = fs.readFileSync(path.join(root, 'app', '(dashboard)', '_components', file), 'utf8');
    assert.match(source, /classifyRunRequestRefusal/, `${file} must classify, not just stringify`);
    assert.match(source, /if \(classified\?\.recoverable\) \{[\s\S]{0,200}setRefusal\(classified\)/,
      `${file} must route a recoverable refusal to the action, not to a sentence`);
    assert.match(source, /<ReviewContinuationRecovery[\s\S]{0,400}requestId=\{refusal\.requestId\}/,
      `${file} must render the recovery panel`);
    // REV-COR04 (Tranche 1): the panel retries the SUBMITTED round exactly, so the
    // live composer text must NOT ride along — a note here would resurrect a stale
    // instruction into a retry whose copy promises exact reuse. The note stays in
    // the composer for a genuinely new continue.
    assert.doesNotMatch(source, /<ReviewContinuationRecovery[\s\S]{0,400}note=/,
      `${file} must not hand live composer text to the exact-reuse retry`);
  }
});

test('a refusal never clears the user’s note, and never marks the composer done', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const box = fs.readFileSync(path.join(root, 'app', '(dashboard)', '_components', 'run-continue-box.tsx'), 'utf8');
  const submit = box.slice(box.indexOf('async function submit('), box.indexOf('if (done) {'));
  const catchBlock = submit.slice(submit.indexOf('} catch (e) {'));
  assert.doesNotMatch(catchBlock, /setNote\(/, 'a refusal must never wipe the feedback the user typed');
  assert.doesNotMatch(catchBlock, /setDone\(true\)/, 'and must never render as queued');
  // setDone(true) exists exactly twice: after a successful POST, and from the
  // recovery panel's onQueued — which itself only fires on a successful call.
  assert.equal((box.match(/setDone\(true\)/g) || []).length, 2);
});
