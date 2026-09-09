import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeControlPlaneRetry, retryConfirmed, mayClaimNoWork,
  RETRY_SAFELY_LABEL, RETRY_SAFELY_DISTINCTION, RUN_AGAIN_DISTINCTION, NO_WORK_CLAIM,
} from './control-plane-retry.ts';

const GRANT = '5b1f6c2e-2c1b-4b1e-9a3e-1f1f1f1f1f1f';
const VERSION = 'c3350000-0000-4000-8000-000000000010';
const ELIGIBLE = { ok: true, eligible: true, alreadyQueued: false, grantId: GRANT, workflowVersionId: VERSION, drainRetryEpoch: '2', failureCode: 'child_exited_before_attachment' };

const WORK_REASONS = ['consequential_work_recorded', 'external_action_recorded', 'artifact_recorded', 'review_mutation_recorded',
  'attempt_not_terminal', 'attempt_runtime_unverified', 'attempt_outcome_ambiguous', 'attempt_authority_unknown',
  'not_control_plane_attachment_failure', 'surfaced_attempt_mismatch'];
const PROMISE_REASONS = ['workflow_version_unpinned', 'workflow_version_unavailable', 'workflow_version_foreign', 'workflow_version_not_applied',
  'input_contract_identity_mismatch', 'continuation_parent_unavailable', 'bootstrap_retry_cap_reached', 'control_plane_retry_already_advanced'];
const HIDDEN_REASONS = ['request_not_found', 'request_still_pending', 'request_cancelled', 'no_launch_attempt', 'request_not_surfaced_failure',
  'control_plane_retry_schema_unavailable', 'control_plane_retry_identity_invalid', 'something_new', undefined, ''];

test('an eligible payload with a grant becomes an available action carrying the grant and the frozen version', () => {
  const p = describeControlPlaneRetry(ELIGIBLE);
  assert.deepEqual(p, { state: 'available', grantId: GRANT, workflowVersionId: VERSION, failureCode: 'child_exited_before_attachment' });
  assert.equal(mayClaimNoWork(p), true);
  const noCode = describeControlPlaneRetry({ ...ELIGIBLE, failureCode: '' });
  assert.equal(noCode.state === 'available' && noCode.failureCode, 'attachment_unobserved');
});

test('eligibility without a grant, with a malformed grant, or without a frozen version cannot be acted on', () => {
  assert.equal(describeControlPlaneRetry({ ...ELIGIBLE, grantId: undefined }).state, 'hidden');
  assert.equal(describeControlPlaneRetry({ ...ELIGIBLE, grantId: 'not-a-uuid' }).state, 'hidden');
  assert.equal(describeControlPlaneRetry({ ...ELIGIBLE, workflowVersionId: null }).state, 'hidden');
  assert.equal(describeControlPlaneRetry({ ...ELIGIBLE, workflowVersionId: undefined }).state, 'hidden');
  assert.equal(describeControlPlaneRetry({ eligible: true, grantId: GRANT, workflowVersionId: VERSION }).state, 'hidden', 'eligible without ok is not a grant');
});

test('queued is its own state and may carry the claim', () => {
  const p = describeControlPlaneRetry({ ok: true, eligible: true, alreadyQueued: true });
  assert.deepEqual(p, { state: 'queued' });
  assert.equal(mayClaimNoWork(p), true);
});

test('every refusal where work may have occurred is disabled, flagged, and may NEVER claim no work', () => {
  for (const reason of WORK_REASONS) {
    const p = describeControlPlaneRetry({ ok: false, eligible: false, reason });
    assert.equal(p.state, 'disabled', reason);
    if (p.state !== 'disabled') continue;
    assert.equal(p.workMayHaveOccurred, true, reason);
    assert.equal(mayClaimNoWork(p), false, reason);
    assert.doesNotMatch(p.explanation, /No work or provider action started/, reason);
    assert.ok(p.explanation.length > 20);
  }
});

test('promise-not-keepable refusals are disabled without the claim; everything else is hidden', () => {
  for (const reason of PROMISE_REASONS) {
    const p = describeControlPlaneRetry({ ok: false, eligible: false, reason });
    assert.equal(p.state, 'disabled', reason);
    if (p.state !== 'disabled') continue;
    assert.equal(p.workMayHaveOccurred, false, reason);
    assert.equal(mayClaimNoWork(p), false, reason);
  }
  for (const reason of HIDDEN_REASONS) {
    const p = describeControlPlaneRetry({ ok: false, eligible: false, reason });
    assert.equal(p.state, 'hidden', String(reason));
    assert.equal(mayClaimNoWork(p), false);
  }
  assert.equal(describeControlPlaneRetry(null).state, 'hidden');
});

test('only a server-confirmed requeue counts', () => {
  assert.equal(retryConfirmed({ ok: true, requeued: true }), true);
  assert.equal(retryConfirmed({ ok: true, requeued: true, alreadyQueued: true }), true);
  for (const bad of [{ ok: true }, { requeued: true }, { ok: false, requeued: true }, null, 'x', {}]) assert.equal(retryConfirmed(bad), false);
});

test('the distinction from Run again and the claim are explicit copy', () => {
  assert.equal(RETRY_SAFELY_LABEL, 'Retry safely — no work started previously');
  assert.equal(RETRY_SAFELY_DISTINCTION, 'Retry safely: same request and frozen inputs');
  assert.equal(RUN_AGAIN_DISTINCTION, 'Run again: creates a new request');
  assert.match(NO_WORK_CLAIM, /No work or provider action started\./);
});
