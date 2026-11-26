import type { RunStep } from './run-state';

export type RecoveryPresentation = {
  hasValidatedFinalOutput: boolean;
  runState: string | null | undefined;
  hasDeterministicContinuation: boolean;
};

export function closeReasonMessage(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'continuation_successor_never_opened':
      return 'The continuation could not start. Earlier verified work is preserved.';
    case 'silence_ceiling_forced':
      return 'Tukido closed this run after a prolonged period without progress.';
    case 'orphaned_parent_gone':
      return 'Tukido closed the run after its routine was paused or removed.';
    case 'exit_code_nonzero':
      return 'The executor exited with an error.';
    case 'exit_signal':
      return 'The executor was stopped before it could finish.';
    case 'exit_timeout':
      return 'The executor reached its time limit.';
    case 'exit_clean_no_completion_signal':
      return 'The executor closed before reporting a result.';
    default:
      return null;
  }
}

export function recoveredResultWarning(reason: string | null, steps: RunStep[]): string | null {
  if (reason !== 'owner_verified_export' && reason !== 'user_finalized_recovered'
    && reason !== 'user_finalized_brokered_recovered_artifact') return null;

  const failed = steps.find(step => step.status === 'failed' && step.label)?.label;
  const unfinished = steps.find(step => step.status === 'running' && step.label)?.label;
  if (failed) return `The run reported a failure at “${failed}.” The saved output was recovered.`;
  if (unfinished) return `The run was still working on “${unfinished}.” The saved output was recovered.`;
  return 'The run did not complete its normal delivery. The saved output was recovered.';
}

export function recoveredArtifactHeadline(input: RecoveryPresentation): string | null {
  if (!input.hasValidatedFinalOutput) return null;
  if (input.runState === 'failed' || input.runState === 'stalled') {
    return 'A validated final output was recovered from this run';
  }
  return null;
}

export function runProblemHeadline(input: RecoveryPresentation, failed: boolean): string {
  if (recoveredArtifactHeadline(input)) return 'The execution ended, but its verified result is available';
  if (input.hasDeterministicContinuation) return 'This run has a verified recovery path';
  return failed ? 'This run did not finish' : 'Progress interrupted';
}

export function suppressDuplicateRetry(input: RecoveryPresentation): boolean {
  return input.hasValidatedFinalOutput || input.hasDeterministicContinuation;
}
