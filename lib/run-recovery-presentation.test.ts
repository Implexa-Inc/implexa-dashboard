import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveredArtifactHeadline, recoveredResultWarning, runProblemHeadline, suppressDuplicateRetry } from './run-recovery-presentation.ts';

test('a failed run with a validated final output leads with the artifact, not a contradictory failure conclusion', () => {
  const input = { hasValidatedFinalOutput: true, runState: 'failed', hasDeterministicContinuation: false };
  assert.match(recoveredArtifactHeadline(input)!, /validated final output/i);
  assert.match(runProblemHeadline(input, true), /verified result is available/i);
  assert.equal(suppressDuplicateRetry(input), true);
});

test('a deterministic continuation is surfaced without claiming a final artifact exists', () => {
  const input = { hasValidatedFinalOutput: false, runState: 'failed', hasDeterministicContinuation: true };
  assert.equal(recoveredArtifactHeadline(input), null);
  assert.match(runProblemHeadline(input, true), /verified recovery path/i);
  assert.equal(suppressDuplicateRetry(input), true);
});

test('an ordinary failure keeps the ordinary failure conclusion and retry', () => {
  const input = { hasValidatedFinalOutput: false, runState: 'failed', hasDeterministicContinuation: false };
  assert.equal(runProblemHeadline(input, true), 'This run did not finish');
  assert.equal(suppressDuplicateRetry(input), false);
});

test('recovered result warnings use recorded interruption details across recovery types', () => {
  const steps = [
    {index: 1, status: 'done', label: 'Editing'},
    {index: 2, status: 'failed', label: 'Delivery check'},
    {index: 3, status: 'running', label: 'Publishing'},
  ] as const;
  assert.match(recoveredResultWarning('owner_verified_export', [...steps])!, /reported a failure at “Delivery check/);
  assert.match(recoveredResultWarning('user_finalized_recovered', [steps[2]])!, /still working on “Publishing/);
  assert.equal(recoveredResultWarning('user_finalized_brokered_recovered_artifact', [steps[0]]),
    'The run did not complete its normal delivery. The saved output was recovered.');
  assert.equal(recoveredResultWarning('brokered_input_settlement_verified', [...steps]), null);
});
