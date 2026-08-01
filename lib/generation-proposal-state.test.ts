// node --test lib/generation-proposal-state.test.ts
//
// The action and honesty guards of the paid-generation surface. These are the
// rules a DOM test could only assert indirectly; pure functions make them
// executable: one approval per click storm, no payment claims, no retry offers on
// unknown, no fabricated progress, no dollars.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalConfirmationCopy, approvalErrorCopy, beginApproval, buildApprovalRequest,
  creditsLine, deriveClipProgress, editReset, formatWindow, progressPresentation,
  proposalActions, settleApproval, taskNoun,
  type ApprovalFlight,
} from './generation-proposal-state.ts';
import type { GenerationProgress } from './generation-proposal.ts';

const NOW = Date.parse('2026-08-01T10:00:00.000Z');
const FUTURE = '2026-08-01T11:00:00.000Z';
const PAST = '2026-08-01T09:00:00.000Z';

const base = {
  lifecycle: 'awaiting_approval' as const,
  availability: true,
  taskCount: 3,
  maximumCredits: 180,
  capabilityKey: 'video.generate_broll',
  expiresAt: FUTURE,
};

// ── approval offering ───────────────────────────────────────────────────────

test('awaiting approval offers the explicit label with backend numbers verbatim', () => {
  const acts = proposalActions(base, NOW);
  assert.equal(acts.canApprove, true);
  assert.equal(acts.canCancel, true);
  assert.equal(acts.approveLabel, 'Generate 3 B-rolls — up to 180 credits');
});

test('non-broll capabilities say clips, not B-rolls', () => {
  assert.equal(taskNoun('video.generate_other', 2), 'clips');
  assert.equal(taskNoun('video.generate_broll', 1), 'B-roll');
});

test('no lifecycle other than awaiting_approval can approve or cancel', () => {
  for (const lifecycle of ['approved', 'cancelled', 'expired', 'unavailable'] as const) {
    const acts = proposalActions({ ...base, lifecycle }, NOW);
    assert.equal(acts.canApprove, false, lifecycle);
    assert.equal(acts.canCancel, false, lifecycle);
  }
});

test('an unavailable proposal is never approvable even while awaiting approval', () => {
  const acts = proposalActions({ ...base, availability: false }, NOW);
  assert.equal(acts.canApprove, false);
  assert.ok(acts.blockedReason);
});

test('a clock-expired proposal is not offered for approval', () => {
  const acts = proposalActions({ ...base, expiresAt: PAST }, NOW);
  assert.equal(acts.canApprove, false);
  assert.match(String(acts.blockedReason), /expired/i);
});

// ── the approval request carries the rendered identity verbatim ─────────────

test('buildApprovalRequest echoes exactly the id/version/digest the user saw', () => {
  const req = buildApprovalRequest(
    { proposalId: 'p-1', proposalVersion: 'generation-quality.v1', proposalDigest: 'a'.repeat(64) },
    'approve-key-123',
  );
  assert.equal(req.path, '/api/v2/generation-proposals/p-1/approve');
  assert.deepEqual(req.body, { proposalVersion: 'generation-quality.v1', proposalDigest: 'a'.repeat(64) });
  assert.equal(req.idempotencyKey, 'approve-key-123');
});

// ── single-flight: a double-click sends exactly one request ─────────────────

test('a rapid double-click yields exactly one send', () => {
  let state: ApprovalFlight = { phase: 'idle' };
  const first = beginApproval(state);
  state = first.next;
  const second = beginApproval(state); // the second click of the double-click
  assert.equal(first.shouldSend, true);
  assert.equal(second.shouldSend, false);
  assert.equal(second.next.phase, 'submitting');
});

test('after success no further click can send again', () => {
  let state: ApprovalFlight = { phase: 'submitting' };
  state = settleApproval(state, 'success');
  assert.equal(state.phase, 'settled');
  assert.equal(beginApproval(state).shouldSend, false);
});

test('a retryable error returns to idle so a DELIBERATE retry may send once more', () => {
  let state: ApprovalFlight = { phase: 'submitting' };
  state = settleApproval(state, 'retryable_error');
  assert.equal(state.phase, 'idle');
  assert.equal(beginApproval(state).shouldSend, true);
});

// ── edit destroys the approval identity ─────────────────────────────────────

test('editReset leaves no identity that could approve the old payload', () => {
  const after = editReset({ proposalId: 'p-1', proposalVersion: 'v1', proposalDigest: 'a'.repeat(64) });
  assert.deepEqual(after, { proposalId: null, proposalVersion: null, proposalDigest: null });
});

// ── refusal copy ────────────────────────────────────────────────────────────

test('stale and expired refusals say nothing was authorized', () => {
  for (const code of ['stale_proposal', 'proposal_expired', 'authorization_mismatch']) {
    assert.match(approvalErrorCopy(code), /nothing was authorized/i, code);
  }
  // an unknown machine code is surfaced, not hidden
  assert.match(approvalErrorCopy('some_new_code'), /some_new_code/);
});

// ── progress derivation: durable records only ───────────────────────────────

const tasks = [
  { taskId: 't1', momentId: 'a', variant: 'primary', window: { startSeconds: 0, endSeconds: 5 }, model: 'm', promptText: 'p', promptDigest: 'a'.repeat(64), ratio: '720:1280', durationSeconds: 5, credits: 60 },
  { taskId: 't2', momentId: 'b', variant: 'primary', window: { startSeconds: 5, endSeconds: 10 }, model: 'm', promptText: 'p', promptDigest: 'a'.repeat(64), ratio: '720:1280', durationSeconds: 5, credits: 60 },
  { taskId: 't3', momentId: 'c', variant: 'primary', window: { startSeconds: 10, endSeconds: 15 }, model: 'm', promptText: 'p', promptDigest: 'a'.repeat(64), ratio: '720:1280', durationSeconds: 5, credits: 60 },
];
const PROVIDER = '11111111-0000-4000-8000-000000000000';
const event = (taskId: string, status: 'created' | 'succeeded') => ({
  taskId,
  eventType: (status === 'created' ? 'task_created' : 'task_succeeded') as 'task_created' | 'task_succeeded',
  providerTaskId: PROVIDER,
  status,
  artifactSha256: status === 'succeeded' ? 'b'.repeat(64) : null,
  createdAt: null,
});
const receiptTask = (taskId: string, status: 'succeeded' | 'failed' | 'unknown') => ({
  taskId, providerTaskId: PROVIDER, promptDigest: 'a'.repeat(64), status, artifactSha256: status === 'succeeded' ? 'b'.repeat(64) : null,
});
const receiptOf = (rows: ReturnType<typeof receiptTask>[]) => ({
  authorizationId: 'auth-1', authorizationDigest: 'c'.repeat(64), digest: 'd'.repeat(64), tasks: rows,
});

test('zero events is reported as zero events, never as a complete zero', () => {
  const clips = deriveClipProgress({ tasks, events: [], receipt: null });
  assert.equal(clips.noEventsYet, true);
  const p = progressPresentation('generating', clips);
  assert.match(p.description, /no clip events have been recorded/i);
  assert.ok(!/0 of 0/.test(p.description));
});

test('progress counts only durable events — nothing interpolated', () => {
  const clips = deriveClipProgress({
    tasks,
    events: [event('t1', 'created'), event('t1', 'succeeded'), event('t2', 'created')],
    receipt: null,
  });
  assert.equal(clips.succeeded, 1);
  assert.equal(clips.started, 1);
  const p = progressPresentation('generating', clips);
  assert.match(p.description, /1 of 3 clips finished/);
});

test('receipt rows are the finalized outcome and override event state', () => {
  const clips = deriveClipProgress({
    tasks,
    events: [event('t1', 'created'), event('t1', 'succeeded')],
    receipt: receiptOf([
      receiptTask('t1', 'failed'),
      receiptTask('t2', 'succeeded'),
      receiptTask('t3', 'unknown'),
    ]),
  });
  assert.equal(clips.failed, 1);
  assert.equal(clips.succeeded, 1);
  assert.equal(clips.unknown, 1);
  const p = progressPresentation('completed', clips);
  assert.match(p.description, /1 of 3 clips succeeded, 1 failed, 1 unknown/);
});

// ── every progress state has its own honest words ───────────────────────────

test('every progress state renders distinct copy, and only unknown forbids retry', () => {
  const states: GenerationProgress[] = ['awaiting_approval', 'pending', 'generating', 'completed', 'failed', 'unknown', 'expired', 'cancelled', 'unavailable'];
  const clips = deriveClipProgress({ tasks, events: [], receipt: null });
  const seen = new Set<string>();
  for (const state of states) {
    const p = progressPresentation(state, clips);
    assert.ok(p.label && p.description, state);
    assert.ok(!seen.has(p.label), `duplicate label: ${p.label}`);
    seen.add(p.label);
    assert.equal(p.doNotRetry, state === 'unknown', state);
  }
});

test('unknown is not failed, and it instructs against retrying', () => {
  const clips = deriveClipProgress({ tasks, events: [], receipt: null });
  const p = progressPresentation('unknown', clips);
  assert.ok(!/fail/i.test(p.label));
  assert.match(p.description, /do not retry/i);
  assert.match(p.description, /twice/i);
});

test('pending says waiting for Desktop and does not claim generation started', () => {
  const clips = deriveClipProgress({ tasks, events: [], receipt: null });
  const p = progressPresentation('pending', clips);
  assert.match(p.label, /waiting for your desktop/i);
  assert.match(p.description, /nothing has been generated yet/i);
});

// ── money honesty ───────────────────────────────────────────────────────────

test('the credit line never mentions dollars and never claims payment pre-completion', () => {
  const line = creditsLine({ maximumCredits: 180, incurredCredits: 0, progress: 'pending', dollars: null });
  assert.ok(!line.includes('$'));
  assert.ok(!/paid|charged/i.test(line));
  assert.match(line, /up to 180 credits/i);
  assert.match(line, /no clip has started/i);
});

test('mid-flight incurred spend is stated as incurred, tied to started clips', () => {
  const line = creditsLine({ maximumCredits: 180, incurredCredits: 60, progress: 'generating', dollars: null });
  assert.match(line, /60 of up to 180/);
  assert.match(line, /clips that have started/i);
  assert.ok(!line.includes('$'));
  assert.ok(!/paid/i.test(line));
});

test('completed shows the recorded figure as recorded, still no dollars', () => {
  const line = creditsLine({ maximumCredits: 180, incurredCredits: 180, progress: 'completed', dollars: null });
  assert.match(line, /180 credits recorded/);
  assert.ok(!line.includes('$'));
});

test('approval confirmation states authorization, never payment', () => {
  const copy = approvalConfirmationCopy({ taskCount: 3, maximumCredits: 180, capabilityKey: 'video.generate_broll' });
  assert.match(copy, /up to 180 credits/);
  assert.match(copy, /not a payment/i);
  assert.ok(!/paid|charged/i.test(copy));
});

// ── formatting ──────────────────────────────────────────────────────────────

test('windows format as m:ss ranges', () => {
  assert.equal(formatWindow({ startSeconds: 12, endSeconds: 17 }), '0:12–0:17');
  assert.equal(formatWindow({ startSeconds: 90, endSeconds: 95.5 }), '1:30–1:35');
});
