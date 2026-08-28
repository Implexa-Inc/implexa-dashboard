export type RecoveryPresentation = {
  hasValidatedFinalOutput: boolean;
  runState: string | null | undefined;
  hasDeterministicContinuation: boolean;
};

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
  return failed ? 'This run did not finish' : 'This run stalled';
}

export function suppressDuplicateRetry(input: RecoveryPresentation): boolean {
  return input.hasValidatedFinalOutput || input.hasDeterministicContinuation;
}
