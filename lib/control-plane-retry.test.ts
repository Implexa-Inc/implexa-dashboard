import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeControlPlaneRetry, retryConfirmed, RETRY_SAFELY_LABEL, RETRY_SAFELY_DISTINCTION, RUN_AGAIN_DISTINCTION } from './control-plane-retry.ts';

const DIGEST = 'a'.repeat(64);
const ELIGIBLE = { ok: true, eligible: true, alreadyQueued: false, drainRetryEpoch: '2', workflowVersionId: 'v-1', inputBindingsDigest: DIGEST, failureCode: 'child_exited_before_attachment' };

test('an eligible payload becomes an available action carrying exactly the server pins', () => {
  const p = describeControlPlaneRetry(ELIGIBLE);
  assert.equal(p.state, 'available');
  if (p.state !== 'available') return;
  assert.deepEqual(p.pins, { expectedDrainRetryEpoch: 2, expectedWorkflowVersionId: 'v-1', expectedInputBindingsDigest: DIGEST });
  assert.equal(p.failureCode, 'child_exited_before_attachment');
  const unversioned = describeControlPlaneRetry({ ...ELIGIBLE, workflowVersionId: null, failureCode: '' });
  assert.equal(unversioned.state, 'available');
  if (unversioned.state === 'available') { assert.equal(unversioned.pins.expectedWorkflowVersionId, null); assert.equal(unversioned.failureCode, 'attachment_unobserved'); }
});

test('an eligibility without exact pins cannot be acted on', () => {
  assert.equal(describeControlPlaneRetry({ ...ELIGIBLE, inputBindingsDigest: undefined }).state, 'hidden');
  assert.equal(describeControlPlaneRetry({ ...ELIGIBLE, inputBindingsDigest: 'short' }).state, 'hidden');
  assert.equal(describeControlPlaneRetry({ ...ELIGIBLE, drainRetryEpoch: 'x' }).state, 'hidden');
  assert.equal(describeControlPlaneRetry({ ...ELIGIBLE, drainRetryEpoch: -1 }).state, 'hidden');
});

test('already queued is its own state; evidence refusals are disabled with an explanation; the rest are hidden', () => {
  assert.deepEqual(describeControlPlaneRetry({ ok: true, eligible: true, alreadyQueued: true }), { state: 'queued' });
  for (const reason of ['consequential_work_recorded', 'external_action_recorded', 'artifact_recorded', 'review_mutation_recorded',
    'workflow_version_unavailable', 'bootstrap_retry_cap_reached', 'continuation_parent_unavailable']) {
    const p = describeControlPlaneRetry({ ok: false, eligible: false, reason });
    assert.equal(p.state, 'disabled', reason);
    if (p.state === 'disabled') { assert.equal(p.reason, reason); assert.ok(p.explanation.length > 20); }
  }
  for (const reason of ['request_not_found', 'not_control_plane_attachment_failure', 'request_still_pending', 'request_cancelled',
    'no_launch_attempt', 'control_plane_retry_schema_unavailable', undefined, '']) {
    assert.equal(describeControlPlaneRetry({ ok: false, eligible: false, reason }).state, 'hidden', String(reason));
  }
  assert.equal(describeControlPlaneRetry(null).state, 'hidden');
  assert.equal(describeControlPlaneRetry({ eligible: true }).state, 'hidden', 'eligible without ok is not a grant');
});

test('only a server-confirmed requeue counts', () => {
  assert.equal(retryConfirmed({ ok: true, requeued: true }), true);
  assert.equal(retryConfirmed({ ok: true, requeued: true, alreadyQueued: true }), true);
  for (const bad of [{ ok: true }, { requeued: true }, { ok: false, requeued: true }, null, 'x', {}]) assert.equal(retryConfirmed(bad), false);
});

test('the distinction from Run again is explicit copy, not implied', () => {
  assert.equal(RETRY_SAFELY_LABEL, 'Retry safely — no work started previously');
  assert.equal(RETRY_SAFELY_DISTINCTION, 'Retry safely: same request and frozen inputs');
  assert.equal(RUN_AGAIN_DISTINCTION, 'Run again: creates a new request');
});
