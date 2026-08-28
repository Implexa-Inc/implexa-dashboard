import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveredArtifactHeadline, runProblemHeadline, suppressDuplicateRetry } from './run-recovery-presentation.ts';

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
