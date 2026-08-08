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
  failSubmission, keepReviewing, phaseForSession, reviewSubmissionView, submitRevision,
  type SubmissionState, type SubmitOutcome,
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
    settleQueued(beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)), { continuationId: 'req-1' }),
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

test('REPRO: preparing is a transition, not a confirmation screen', () => {
  // The two-step version promised "Send N changes & start revision" on a click that
  // sent nothing, then asked for the same click again. One decisive click instead:
  // preparing is entered and left inside one handler and offers nothing to press.
  const v = view(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds));
  assert.equal(v.primaryEnabled, false, 'preparing offered a clickable primary');
  assert.doesNotMatch(v.primaryLabel, /& start revision/,
    'a click that transmits nothing repeats the promise of one that does');
  assert.equal(v.secondaryLabel, null);
  assert.equal(v.resubmissionDisabled, true);
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
  const settled = settleQueued(submitting, { continuationId: '   ' });
  assert.equal(settled.phase, 'error');
  assert.equal(settled.continuationId, null);
});

test('queued names the exact count and the continuation, and closes resubmission', () => {
  const queued = settleQueued(
    beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)),
    { continuationId: 'req-77', issueCount: 12 },
  );
  const v = view(queued, { draftCount: 0 });
  assert.equal(v.mode, 'queued');
  assert.equal(v.continuationId, 'req-77');
  assert.equal(v.statusLine, '12 changes were sent as one revision.');
  assert.equal(v.primaryEnabled, false);
  assert.equal(v.resubmissionDisabled, true);
  assert.equal(v.showNote, false);
});

test("REPRO: the queued count is the SERVER's, not this room's local freeze", () => {
  // The local snapshot is a display freeze, never a contract — the endpoint takes a
  // session id and snapshots server-side. When the two disagree the server is right,
  // and the room says so rather than repeating a number that was never submitted.
  const queued = settleQueued(
    beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)),
    { continuationId: 'req-77', issueCount: 11 },
  );
  assert.equal(queued.submittedCount, 11);
  const v = view(queued, { draftCount: 0 });
  assert.match(v.statusLine!, /^11 changes were sent as one revision/);
  assert.match(v.statusLine!, /this room had shown 12/);
});

test('a server count that matches the freeze is stated plainly', () => {
  const queued = settleQueued(
    beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)),
    { continuationId: 'req-77', issueCount: 12 },
  );
  assert.doesNotMatch(view(queued, { draftCount: 0 }).statusLine!, /this room had shown/);
});

test('a missing or malformed server count falls back to the freeze', () => {
  for (const issueCount of [undefined, null, -1, 1.5, Number.NaN]) {
    const queued = settleQueued(
      beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)),
      { continuationId: 'req-77', issueCount: issueCount as number | null | undefined },
    );
    assert.equal(queued.submittedCount, null, String(issueCount));
    assert.equal(view(queued, { draftCount: 0 }).statusLine, '12 changes were sent as one revision.');
  }
});

test('queued cannot be reached from a state that never submitted', () => {
  assert.equal(settleQueued(INITIAL_SUBMISSION_STATE, { continuationId: 'req-1' }).phase, 'draft');
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

test('Keep reviewing clears a failed attempt and returns to draft', () => {
  const failed = failSubmission(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds), 'nope');
  const back = keepReviewing(failed);
  assert.equal(back.phase, 'draft');
  assert.equal(back.snapshot, null);
  assert.equal(back.error, null);
});

test('Keep reviewing cannot cancel a request that is already out', () => {
  const sending = beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds));
  assert.equal(keepReviewing(sending), sending,
    'the room would claim "draft" while a continuation is being created');
});

// ── the whole click ─────────────────────────────────────────────────────────
//
// Every one of these is a way the room gets stuck on "Sending…" forever, and none of
// them is reachable from a test that reads JSX.

/** Drive one click, recording every state the caller was handed. */
async function click(submit: () => Promise<SubmitOutcome>, state = INITIAL_SUBMISSION_STATE) {
  const seen: SubmissionState[] = [];
  const final = await submitRevision({
    state, draftIssueIds: draftIds, submit, onState: (s) => seen.push(s),
  });
  return { final, seen };
}

test('REPRO: a successful submit settles from ITS OWN response, not a refreshed prop', () => {
  return click(async () => ({ ok: true, requestId: 'req-500', issueCount: 12 })).then(({ final, seen }) => {
    assert.deepEqual(seen.map((s) => s.phase), ['submitting', 'revision_queued']);
    assert.equal(final.phase, 'revision_queued');
    assert.equal(final.continuationId, 'req-500');
    assert.equal(final.submittedCount, 12);
  });
});

test('REPRO: a REJECTED request lands in error, never stuck in flight', async () => {
  // fetch rejects offline, on navigation, on abort. Before this, the rejection escaped
  // the click handler and `submitting` was the last state the room ever saw.
  const { final, seen } = await click(async () => { throw new TypeError('Failed to fetch'); });
  assert.deepEqual(seen.map((s) => s.phase), ['submitting', 'error']);
  assert.equal(final.phase, 'error');
  assert.match(final.error!, /nothing was sent/i);
  assert.equal(final.snapshot!.issueCount, EXPECTED_TOTAL, 'a dead request discarded the drafts');
});

test('an ok response naming no continuation is a failure, not a queued revision', async () => {
  const { final } = await click(async () => ({ ok: true, requestId: '' }));
  assert.equal(final.phase, 'error');
  assert.equal(final.continuationId, null);
});

test('a refusal keeps every draft and offers the action again', async () => {
  const { final } = await click(async () => ({ ok: false }));
  assert.equal(final.phase, 'error');
  assert.equal(final.snapshot!.issueCount, EXPECTED_TOTAL);
  assert.equal(view(final, { draftCount: EXPECTED_TOTAL }).primaryLabel,
    'Send 12 changes & start revision');
});

test('ONE click sends: there is no second click that transmits nothing', async () => {
  let calls = 0;
  const { seen } = await click(async () => { calls += 1; return { ok: true, requestId: 'r', issueCount: 12 }; });
  assert.equal(calls, 1, 'the decisive click did not reach the network');
  // And it never renders a clickable primary carrying the same promise twice.
  assert.equal(view(seen[0]).primaryEnabled, false);
  assert.match(view(seen[0]).primaryLabel, /^Sending 12 changes/);
});

test('a double click cannot transmit twice', async () => {
  let calls = 0;
  const submit = async (): Promise<SubmitOutcome> => { calls += 1; return { ok: true, requestId: 'r' }; };
  const first = await submitRevision({
    state: INITIAL_SUBMISSION_STATE, draftIssueIds: draftIds, submit, onState: () => {},
  });
  // The second click arrives with the state the first one produced.
  await submitRevision({ state: first, draftIssueIds: draftIds, submit, onState: () => {} });
  assert.equal(calls, 1, 'a second click reached the network');
});

test('a click with nothing to send transmits nothing', async () => {
  let calls = 0;
  const final = await submitRevision({
    state: INITIAL_SUBMISSION_STATE, draftIssueIds: [],
    submit: async () => { calls += 1; return { ok: true, requestId: 'r' }; },
    onState: () => {},
  });
  assert.equal(calls, 0);
  assert.equal(final.phase, 'draft');
});

test('a retry after failure transmits again and can succeed', async () => {
  const { final: failed } = await click(async () => ({ ok: false }));
  const { final } = await click(async () => ({ ok: true, requestId: 'req-2', issueCount: 12 }), failed);
  assert.equal(final.phase, 'revision_queued');
  assert.equal(final.continuationId, 'req-2');
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

test('REPRO: a settled submission is not dragged back by a stale row', () => {
  // `session` is client state seeded from props once, so the row this tab holds is
  // whatever it read BEFORE the submit — including `submitting`, which the backend
  // sets while preparing. Letting a stale row win put a completed submission back on
  // "Sending…" with no way out.
  const queued = settleQueued(
    beginSubmitting(beginPreparing(INITIAL_SUBMISSION_STATE, draftIds)),
    { continuationId: 'req-9', issueCount: 12 },
  );
  for (const sessionState of ['submitting', 'draft', null]) {
    const s = phaseForSession({
      sessionState, submittedRequestId: null, submittedIssueIds: null, local: queued,
    });
    assert.equal(s.phase, 'revision_queued', `a '${sessionState}' row reopened a settled submission`);
    assert.equal(s.continuationId, 'req-9');
    assert.equal(view(s, { draftCount: 12 }).primaryEnabled, false);
  }
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
