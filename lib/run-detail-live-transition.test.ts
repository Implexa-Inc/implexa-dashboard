import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isApprovalContinuationRecovery, isWatchableRunState, shouldShowRunProblem } from './run-state.ts';

test('run details keeps watching across queued to running', () => {
  assert.equal(isWatchableRunState('queued'), true);
  assert.equal(isWatchableRunState('running'), true);
  assert.equal(isWatchableRunState('completed'), false);
  assert.equal(isWatchableRunState('failed'), false);
});

const approvalSteps = [
  { index: 1, label: 'Transcribe source', status: 'done' as const },
  { index: 2, label: 'Review cut list for approval', status: 'running' as const },
  { index: 3, label: 'Render final MP4', status: 'pending' as const },
];

test('recovers only a structurally incomplete approval-gated historical completion', () => {
  const base = {
    runState: 'completed', reviewStatus: 'none', outputMarkdown: null,
    steps: approvalSteps, hasReviewEvidence: true, hasFinalOutput: false,
  };
  assert.equal(isApprovalContinuationRecovery(base), true);
  assert.equal(isApprovalContinuationRecovery({ ...base, hasFinalOutput: true }), false);
  assert.equal(isApprovalContinuationRecovery({ ...base, hasReviewEvidence: false }), false);
  assert.equal(isApprovalContinuationRecovery({ ...base, reviewStatus: 'pending' }), false);
  assert.equal(isApprovalContinuationRecovery({ ...base, outputMarkdown: '# Delivered' }), false);
  assert.equal(isApprovalContinuationRecovery({ ...base, steps: approvalSteps.map((step) => ({ ...step, status: 'done' as const })) }), false);
  assert.equal(isApprovalContinuationRecovery({
    ...base,
    steps: [approvalSteps[0], { ...approvalSteps[1], label: 'Write summary' }, approvalSteps[2]],
  }), false);

  const historicalDesktopFailure = {
    ...base,
    runState: 'failed',
    closeReason: 'exit_clean_no_completion_signal',
    progress: { history: [{
      note: 'step 6/17: Desktop adapter requires approval before rendering the presenter derivative; no rendering or provider action started',
    }] },
  };
  assert.equal(isApprovalContinuationRecovery(historicalDesktopFailure), true);
  assert.equal(isApprovalContinuationRecovery({
    ...historicalDesktopFailure,
    progress: { history: [{ note: 'Approval required before continuing.' }] },
  }), false);
  assert.equal(isApprovalContinuationRecovery({
    ...historicalDesktopFailure, closeReason: 'exit_code_nonzero',
  }), true, 'a worker may truthfully return code 1 after recording the exact approval boundary');
  assert.equal(isApprovalContinuationRecovery({
    ...historicalDesktopFailure, closeReason: 'brokered_input_settlement_verified',
  }), true, 'verified large-input settlement may be the preserved terminal provenance');
  assert.equal(isApprovalContinuationRecovery({
    ...historicalDesktopFailure, closeReason: 'exit_timeout',
  }), false);
});

test('run details renders the approval recovery action from structured authority', () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, '..', 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');
  assert.match(page, /isApprovalContinuationRecovery\(\{/);
  assert.match(page, /closeReason,/);
  assert.ok(page.indexOf("select('verification_status, run_close_reason')")
      < page.indexOf('const localApprovalContinuationRecovery = isApprovalContinuationRecovery'),
    'terminal close provenance must be loaded before the recovery verdict is derived');
  assert.match(page, /progress,/);
  assert.match(page, /artifact\.role === 'manifest'/);
  assert.match(page, /scene-execution-contract\.json/,
    'a validated Manager L1 scene contract must recover an approval held before the final manifest step');
  assert.match(page, /clean-cut-review-plan\.json/,
    'a validated clean-cut plan must surface its historical approval continuation');
  assert.match(page, /run-requests\/approval-recovery\/\$\{encodeURIComponent\(r\.id\)\}/,
    'the detail badge and action must use the server-authoritative recovery disposition');
  assert.match(page, /error instanceof BackendError && error\.status === 404/,
    'only a not-yet-deployed backend route may use the exact local compatibility classifier');
  assert.match(page, /approvalContinuationRecovery = false/,
    'an unavailable authority read must fail closed instead of advertising an unusable approval');
  assert.match(page, /review_status: approvalContinuationRecovery \? 'pending'/,
    'an eligible historical hold must present as waiting for approval, not failed');
  assert.match(page, /const effectiveHoldKind = approvalContinuationRecovery \? 'approval_before_action' : holdKind/,
    'historical approval must resume remaining work instead of marking the failed shell done');
  assert.match(page, /approvalRecovery=\{approvalContinuationRecovery\}/,
    'the unified held-run action must request the server-owned no-redo continuation');
  assert.match(page, /artifact\.role === 'final_output'/);
  assert.match(page, /\.select\('id, status, lifecycle_state, failure_reason'\)/,
    'terminal broker settlement reason must reach the exact retry classifier');
  assert.match(page, /linked_request_failure_reason: linked\.failure_reason/);
  assert.match(page, /!held && !approvalContinuationRecovery && runActions\.length > 0/,
    'a legacy proposed action must not replace the authority-preserving recovery action');
  assert.doesNotMatch(page, /approvalContinuationAlreadyQueued/,
    'the deterministic backend request makes a browser-side suppression query unnecessary');
});

test('approval recovery asks the backend for one server-authoritative continuation', () => {
  const button = fs.readFileSync(path.join(import.meta.dirname, '..', 'app', '(dashboard)', '_components', 'run-actions.tsx'), 'utf8');
  assert.match(button, /kind: 'continue', runId/);
  assert.match(button, /approvalRecovery: true/);
  assert.match(button, /Approve & finish/);
  assert.doesNotMatch(button, /const APPROVAL_RECOVERY_PROMPT/,
    'the browser must not be able to author the approval recovery instruction');
});

test('active queue/start states never render as a terminal stalled run', () => {
  assert.equal(shouldShowRunProblem({ state: 'queued', attention: false }, 'exit_timeout'), false);
  assert.equal(shouldShowRunProblem({ state: 'running', attention: false }, 'exit_timeout'), false);
  assert.equal(shouldShowRunProblem({ state: 'stalled', attention: true }, null), true);
  assert.equal(shouldShowRunProblem({ state: 'failed', attention: false }, null), true);
  assert.equal(shouldShowRunProblem({ state: 'completed', attention: false }, 'It ran past its time limit.'), true);
  assert.equal(shouldShowRunProblem({ state: 'completed', attention: false }, null), false,
    'successful settlement provenance has no failure explanation');
});
