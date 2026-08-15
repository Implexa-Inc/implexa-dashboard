// node --test lib/review-evidence-status.test.ts
//
// The Submit gate for spatial evidence, extended for Revision Reliability Tranche 1
// (REV-U01): typed per-item states, a typed `disabled` verdict that mirrors the
// backend's fail-closed compile gate instead of an unknown-state spinner, a stall
// clock that turns "pending forever" into a named, retryable state, and a retry set
// that can NEVER contain a verified capture.
//
// Pure module, pure tests: which submissions are blocked — and which captures a
// retry may touch — is exactly the kind of claim that must be executable here
// rather than asserted by reading JSX.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evidenceGate, evidenceChip, isSpatialIssue, trackPendingPolls,
  STALLED_POLL_THRESHOLD,
  type PendingPollCounts, type SessionEvidenceStatus,
} from './review-evidence-status.ts';

const spatialAnchor = { version: 2, type: 'visual_spatial' };
const issue = (id: string) => ({ id, anchor: spatialAnchor });
const temporalIssue = (id: string) => ({ id, anchor: { version: 1, type: 'media_time' } });

const ready = (issueId: string): SessionEvidenceStatus extends null ? never : NonNullable<SessionEvidenceStatus>['issues'][number] => ({
  issueId, anchorDigest: 'f'.repeat(64), evidence: { status: 'validated', ready: true },
});
const withEvidence = (issueId: string, status: string): NonNullable<SessionEvidenceStatus>['issues'][number] => ({
  issueId, anchorDigest: 'f'.repeat(64), evidence: { status, ready: false },
});
const statusOf = (issues: NonNullable<SessionEvidenceStatus>['issues']): SessionEvidenceStatus => ({
  state: 'ready', issues,
});

// ── the disabled backend, TYPED (REV-U01 §3) ────────────────────────────────

test('disabled with spatial drafts blocks FAIL CLOSED, with typed words and a retry — never the unknown spinner', () => {
  // The backend's compileSubmission treats `disabled` with spatial issues as a
  // contradiction and refuses; the button must mirror that verdict, not spin.
  const gate = evidenceGate({
    draftIssues: [issue('a'), issue('b')],
    status: { state: 'disabled', issues: [] },
  });
  assert.equal(gate.blocked, true, 'disabled must not unlock submit over unverifiable pins');
  assert.equal(gate.reason, 'disabled', 'the state is typed, not collapsed into unknown');
  assert.deepEqual(gate.retryIssueIds, ['a', 'b'], 'every spatial draft is retryable in case support returns');
  assert.match(gate.statusLine!, /disabled on this backend/i, 'the copy names the real situation');
  assert.doesNotMatch(gate.statusLine!, /Checking screenshot evidence/, 'and never the forever-spinner sentence');
});

test('disabled with NO spatial drafts requires nothing — visual-free feedback is untouched', () => {
  const gate = evidenceGate({
    draftIssues: [temporalIssue('t1')],
    status: { state: 'disabled', issues: [] },
  });
  assert.equal(gate.blocked, false);
  assert.equal(gate.reason, 'none_required');
});

test('an unreadable status read is still UNKNOWN — blocked, with no retry to mash', () => {
  for (const status of [null, { state: 'unavailable', issues: [] } as SessionEvidenceStatus]) {
    const gate = evidenceGate({ draftIssues: [issue('a')], status });
    assert.equal(gate.blocked, true);
    assert.equal(gate.reason, 'unknown');
    assert.deepEqual(gate.retryIssueIds, [], 'unknown offers no retry — we could not even look');
    assert.match(gate.statusLine!, /Checking screenshot evidence/);
  }
});

// ── per-item chip states (REV-U01 §2) ───────────────────────────────────────

test('the chip names each typed state: waiting, capturing, verified, failed, outdated, stalled', () => {
  assert.deepEqual(evidenceChip(null), { label: 'Screenshot: waiting', tone: 'waiting' });
  assert.deepEqual(evidenceChip({ status: 'pending', ready: false }), { label: 'Screenshot: capturing…', tone: 'waiting' });
  assert.deepEqual(evidenceChip({ status: 'validated', ready: true }), { label: 'Screenshot: verified', tone: 'ok' });
  assert.deepEqual(evidenceChip({ status: 'unavailable', ready: false }), { label: 'Screenshot: failed', tone: 'failed' });
  assert.deepEqual(evidenceChip({ status: 'stale', ready: false }), { label: 'Screenshot: outdated', tone: 'failed' });
  assert.deepEqual(evidenceChip({ status: 'revoked', ready: false }), { label: 'Screenshot: outdated', tone: 'failed' });
  assert.deepEqual(
    evidenceChip({ status: 'pending', ready: false }, { stalled: true }),
    { label: 'Screenshot: stalled — retry', tone: 'failed' },
  );
});

test('a VERIFIED capture out-ranks a stale stall flag — verified items stay verified', () => {
  assert.deepEqual(
    evidenceChip({ status: 'validated', ready: true }, { stalled: true }),
    { label: 'Screenshot: verified', tone: 'ok' },
  );
});

test('the gate copy counts progress: N of M verified', () => {
  const gate = evidenceGate({
    draftIssues: [issue('a'), issue('b'), issue('c')],
    status: statusOf([ready('a'), withEvidence('b', 'pending'), withEvidence('c', 'pending')]),
  });
  assert.equal(gate.reason, 'waiting');
  assert.equal(gate.verifiedCount, 1);
  assert.equal(gate.spatialCount, 3);
  assert.match(gate.statusLine!, /1 of 3 verified/, 'the footer states real progress, not a bare spinner');
});

// ── stalled-pending detection (REV-U01 §4) ──────────────────────────────────

test('the stall clock counts CONSECUTIVE pending polls and resets the moment a capture leaves pending', () => {
  let counts: PendingPollCounts = {};
  const pending = statusOf([withEvidence('a', 'pending')]);
  counts = trackPendingPolls(counts, pending);
  counts = trackPendingPolls(counts, pending);
  assert.equal(counts.a, 2);
  // Validated: off the clock entirely.
  counts = trackPendingPolls(counts, statusOf([ready('a')]));
  assert.equal('a' in counts, false, 'a completed capture must not keep an age');
  // Re-requested later: starts from one, never from where it left off.
  counts = trackPendingPolls(counts, pending);
  assert.equal(counts.a, 1);
});

test('an unreadable poll advances NOTHING — it is evidence of neither progress nor stalling', () => {
  const before: PendingPollCounts = { a: 7 };
  assert.equal(trackPendingPolls(before, null), before);
  assert.equal(trackPendingPolls(before, { state: 'unavailable', issues: [] }), before);
});

test('a capture pending across the bound becomes STALLED: blocked fail-closed, named, and retryable', () => {
  const status = statusOf([withEvidence('a', 'pending'), withEvidence('b', 'pending')]);
  const gate = evidenceGate({
    draftIssues: [issue('a'), issue('b')],
    status,
    pendingPolls: { a: STALLED_POLL_THRESHOLD, b: STALLED_POLL_THRESHOLD - 1 },
  });
  assert.equal(gate.blocked, true, 'submit stays blocked — the compile gate would refuse anyway');
  assert.equal(gate.reason, 'stalled');
  assert.deepEqual(gate.stalledIssueIds, ['a'], 'exactly the item over the bound is stalled');
  assert.deepEqual(gate.retryIssueIds, ['a'], 'the stalled capture is retryable');
  assert.deepEqual(gate.waitingIssueIds, ['b'], 'a capture under the bound is still just waiting');
  assert.match(gate.statusLine!, /stalled/i, 'the user sees which situation is true, not a silent lock');
});

test('below the bound — or with no clock supplied — pending is WAITING, with no retry offered', () => {
  const status = statusOf([withEvidence('a', 'pending')]);
  for (const pendingPolls of [undefined, { a: STALLED_POLL_THRESHOLD - 1 }]) {
    const gate = evidenceGate({ draftIssues: [issue('a')], status, pendingPolls });
    assert.equal(gate.reason, 'waiting');
    assert.deepEqual(gate.retryIssueIds, []);
  }
});

// ── retryIssueIds composition (REV-U01 §1/§2) ───────────────────────────────

test('the retry set is failures plus stalls — and NEVER a verified capture', () => {
  const gate = evidenceGate({
    draftIssues: [issue('ok'), issue('failed1'), issue('stalled1'), issue('waiting1'), issue('failed2')],
    status: statusOf([
      ready('ok'),
      withEvidence('failed1', 'unavailable'),
      withEvidence('stalled1', 'pending'),
      withEvidence('waiting1', 'pending'),
      withEvidence('failed2', 'revoked'),
    ]),
    pendingPolls: { stalled1: STALLED_POLL_THRESHOLD, ok: STALLED_POLL_THRESHOLD },
  });
  assert.equal(gate.reason, 'failed', 'an outright failure is the louder fact than a stall');
  assert.deepEqual(gate.retryIssueIds, ['failed1', 'failed2', 'stalled1']);
  assert.equal(gate.retryIssueIds.includes('ok'), false,
    're-requesting a verified capture would revoke the validated frame the gate already accepted');
  assert.equal(gate.retryIssueIds.includes('waiting1'), false, 'a merely-waiting capture is not retried over');
  assert.equal(gate.verifiedCount, 1);
  assert.equal(gate.spatialCount, 5);
  assert.match(gate.statusLine!, /1 of 5 verified/);
});

test('all verified unlocks; the pre-tranche verdicts are unchanged', () => {
  const gate = evidenceGate({
    draftIssues: [issue('a'), issue('b')],
    status: statusOf([ready('a'), ready('b')]),
  });
  assert.equal(gate.blocked, false);
  assert.equal(gate.reason, 'ready');
  assert.equal(gate.verifiedCount, 2);
  assert.equal(isSpatialIssue(issue('x')), true);
  assert.equal(isSpatialIssue(temporalIssue('x')), false);
});
