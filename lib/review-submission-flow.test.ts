// node --test lib/review-submission-flow.test.ts
//
// The action Review Room owns end to end. These tests pin the state machine
// (draft -> preparing -> submitting -> revision_queued), the copy at each step, and
// the four properties the production failure violated: a frozen count, no second
// approval page, no duplicate on a double click, and durable state on reload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_SUBMISSION_STATE, beginPreparing, beginSubmitting, settleQueued,
  failSubmission, keepReviewing, phaseForSession, reviewSubmissionView,
  type SubmissionState,
} from './review-submission-flow.ts';
import { fixtureIssues, EXPECTED_TOTAL } from './review-multi-file-fixture.ts';

const draftIds = fixtureIssues.map((i) => i.id);

const view = (state: SubmissionState, over: { draftCount?: number; busy?: boolean; noteEnabled?: boolean } = {}) =>
  reviewSubmissionView({
    state, draftCount: over.draftCount ?? draftIds.length,
    busy: over.busy ?? false, noteEnabled: over.noteEnabled ?? false,
  });

// ── the offer ───────────────────────────────────────────────────────────────

test('the 12-draft production session offers exactly the required primary action', () => {
  const v = view(INITIAL_SUBMISSION_STATE, { draftCount: EXPECTED_TOTAL });
  assert.equal(v.primaryLabel, 'Send 12 changes & start revision');
  assert.equal(v.secondaryLabel, 'Keep reviewing');
  assert.equal(v.mode, 'send_changes');
  assert.equal(v.showNote, true);
});

test('one draft reads as one change', () => {
  assert.equal(view(INITIAL_SUBMISSION_STATE, { draftCount: 1 }).primaryLabel,
    'Send 1 change & start revision');
});

test('with no drafts the action is explicit acceptance, not a vague continue', () => {
  const v = view(INITIAL_SUBMISSION_STATE, { draftCount: 0 });
  assert.equal(v.primaryLabel, 'Accept result & continue');
  assert.equal(v.mode, 'accept_result');
  // Nothing is being revised, so there is nothing for a revision note to supplement.
  assert.equal(v.showNote, false);
  assert.equal(v.secondaryLabel, null);
});

test('no state ever labels the primary action as a second approval gate', () => {
  const states: SubmissionState[] = [
    INITIAL_SUBMISSION_STATE,
    beginPreparing(INITIAL_SUBMISSION_STATE, draftIds),
    beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)),
    settleQueued(beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)), 'req-1'),
    failSubmission(beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)), 'upstream refused'),
  ];
  for (const s of states) {
    for (const count of [0, 1, 12]) {
      const v = view(s, { draftCount: count });
      const copy = `${v.primaryLabel} ${v.secondaryLabel ?? ''} ${v.statusLine ?? ''}`;
      assert.doesNotMatch(copy, /approve next action|continue work|generate b-roll/i,
        `${s.phase}/${count} offered an unrelated next action: ${copy}`);
    }
  }
});

// ── preparing freezes ───────────────────────────────────────────────────────

test('preparing freezes a visible, immutable count', () => {
  const prepared = beginPreparing(INITIAL_SUBMISSION_STATE, draftIds);
  assert.equal(prepared.phase, 'preparing');
  assert.equal(prepared.snapshot!.issueCount, EXPECTED_TOTAL);
  const v = view(prepared);
  assert.equal(v.frozenCount, EXPECTED_TOTAL);
  assert.match(v.statusLine!, /12 changes frozen/);
});

test('the frozen count does not follow the live drafts', () => {
  const prepared = beginPreparing(INITIAL_SUBMISSION_STATE, draftIds);
  // Something deleted a draft after the snapshot. The button must keep promising the
  // number the reviewer confirmed, not silently renegotiate it.
  assert.equal(view(prepared, { draftCount: 3 }).frozenCount, EXPECTED_TOTAL);
});

test('the snapshot cannot be mutated after it is frozen', () => {
  const prepared = beginPreparing(INITIAL_SUBMISSION_STATE, draftIds);
  assert.throws(() => {
    (prepared.snapshot!.issueIds as string[]).push('sneaky');
  });
  assert.equal(prepared.snapshot!.issueIds.length, EXPECTED_TOTAL);
});

test('preparing with nothing to send is refused', () => {
  assert.equal(beginPreparing(INITIAL_SUBMISSION_STATE, []).phase, 'draft');
});

// ── no duplicate ────────────────────────────────────────────────────────────

test('a second click during preparing does not re-freeze the snapshot', () => {
  const first = beginPreparing(INITIAL_SUBMISSION_STATE, draftIds);
  const second = beginPreparing(first, ['only-one']);
  assert.equal(second, first, 'the frozen snapshot was replaced by a re-entry');
});

test('a double click cannot start two submissions', () => {
  const submitting = beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds));
  assert.equal(beginSubmitting(submitting), submitting);
  assert.equal(view(submitting).primaryEnabled, false, 'in-flight primary stayed clickable');
  assert.equal(view(submitting).resubmissionDisabled, true);
});

test('submitting cannot be re-entered from draft without freezing first', () => {
  assert.equal(beginSubmitting(INITIAL_SUBMISSION_STATE).phase, 'draft');
});

// ── only a durable response marks it sent ───────────────────────────────────

test('a response with no continuation id is a failure, not a success', () => {
  const submitting = beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds));
  const settled = settleQueued(submitting, '   ');
  assert.equal(settled.phase, 'error');
  assert.equal(settled.continuationId, null);
});

test('queued names the exact count and the continuation, and closes resubmission', () => {
  const queued = settleQueued(beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)), 'req-77');
  const v = view(queued, { draftCount: 0 });
  assert.equal(v.mode, 'queued');
  assert.equal(v.continuationId, 'req-77');
  assert.equal(v.statusLine, '12 changes were sent as one revision.');
  assert.equal(v.primaryEnabled, false);
  assert.equal(v.resubmissionDisabled, true);
  assert.equal(v.showNote, false);
});

test('queued cannot be reached from a state that never submitted', () => {
  assert.equal(settleQueued(INITIAL_SUBMISSION_STATE, 'req-1').phase, 'draft');
});

// ── failure preserves everything ────────────────────────────────────────────

test('a failure keeps the frozen snapshot and offers the same send action again', () => {
  const submitting = beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds));
  const failed = failSubmission(submitting, 'the backend refused');
  assert.equal(failed.phase, 'error');
  assert.equal(failed.snapshot!.issueCount, EXPECTED_TOTAL, 'the snapshot was discarded on failure');

  const v = view(failed, { draftCount: EXPECTED_TOTAL });
  assert.equal(v.errorLine, 'the backend refused');
  assert.equal(v.primaryLabel, 'Send 12 changes & start revision', 'retry must re-offer the same action');
  assert.equal(v.primaryEnabled, true);
  assert.equal(v.showNote, true, 'the note composer must survive a failure');
});

test('a blank failure message still says something honest', () => {
  const failed = failSubmission(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds), '   ');
  assert.match(failed.error!, /nothing was sent/i);
});

test('Keep reviewing returns to draft without sending', () => {
  const prepared = beginPreparing(INITIAL_SUBMISSION_STATE, draftIds);
  const back = keepReviewing(prepared);
  assert.equal(back.phase, 'draft');
  assert.equal(back.snapshot, null);
  assert.equal(back.continuationId, null);
});

// ── durable state on reload ─────────────────────────────────────────────────

test('a reload with no local memory still shows the queued revision and its count', () => {
  const s = phaseForSession({
    sessionState: 'submitted',
    submittedRequestId: 'req-42',
    submittedIssueIds: draftIds,
    local: INITIAL_SUBMISSION_STATE, // a fresh tab knows nothing
  });
  assert.equal(s.phase, 'revision_queued');
  const v = view(s, { draftCount: 0 });
  assert.equal(v.statusLine, '12 changes were sent as one revision.');
  assert.equal(v.continuationId, 'req-42');
  assert.equal(v.resubmissionDisabled, true);
});

test('the durable row outranks a local state that thinks it is still drafting', () => {
  const s = phaseForSession({
    sessionState: 'submitted', submittedRequestId: 'req-9', submittedIssueIds: ['a', 'b'],
    local: INITIAL_SUBMISSION_STATE,
  });
  assert.equal(s.phase, 'revision_queued');
  assert.equal(view(s, { draftCount: 2 }).primaryEnabled, false,
    'a second tab was still offering to send an already-submitted session');
});

test('a submitted row missing its request id states the count but offers no link', () => {
  const s = phaseForSession({
    sessionState: 'submitted', submittedRequestId: null, submittedIssueIds: ['a', 'b', 'c'],
    local: INITIAL_SUBMISSION_STATE,
  });
  const v = view(s, { draftCount: 0 });
  assert.equal(v.continuationId, null);
  assert.equal(v.statusLine, '3 changes were sent as one revision.');
});

test('a submitting row renders in flight even in a fresh tab', () => {
  const s = phaseForSession({
    sessionState: 'submitting', submittedRequestId: null, submittedIssueIds: null,
    local: INITIAL_SUBMISSION_STATE,
  });
  assert.equal(s.phase, 'submitting');
  assert.equal(view(s).primaryEnabled, false);
});

test('a draft row defers to whatever this tab is doing', () => {
  const local = beginPreparing(INITIAL_SUBMISSION_STATE, draftIds);
  const s = phaseForSession({
    sessionState: 'draft', submittedRequestId: null, submittedIssueIds: null, local,
  });
  assert.equal(s, local);
});

// ── the note ────────────────────────────────────────────────────────────────

test('the composer sits on the send path and says so when it cannot yet be collected', () => {
  const v = view(INITIAL_SUBMISSION_STATE, { noteEnabled: false });
  assert.equal(v.showNote, true, 'the composer belongs above the action');
  assert.equal(v.noteEnabled, false);
  assert.match(v.noteHint!, /not collected yet/i);
});

test('with the contract pinned the composer simply enables — no other copy moves', () => {
  const off = view(INITIAL_SUBMISSION_STATE, { noteEnabled: false });
  const on = view(INITIAL_SUBMISSION_STATE, { noteEnabled: true });
  assert.equal(on.noteEnabled, true);
  assert.equal(on.noteHint, null);
  assert.equal(on.primaryLabel, off.primaryLabel);
  assert.equal(on.secondaryLabel, off.secondaryLabel);
});

test('the composer is never typable while a submission is in flight', () => {
  const submitting = beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds));
  assert.equal(view(submitting, { noteEnabled: true }).noteEnabled, false);
});

// ── in-flight writes elsewhere ──────────────────────────────────────────────

test('a busy room disables the action without changing what it promises', () => {
  const idle = view(INITIAL_SUBMISSION_STATE);
  const busy = view(INITIAL_SUBMISSION_STATE, { busy: true });
  assert.equal(busy.primaryEnabled, false);
  assert.equal(busy.primaryLabel, idle.primaryLabel);
});
