// "Retry safely — no work started previously" (backend 0335).
//
// A request whose Codex child never attached Implexa's control tools did no
// work. The BACKEND decides that from its ledger; this module only turns the
// eligibility payload into what the UI may say and do. It is deliberately
// separate from "Run again" (a new request) — the two are never merged.

export type ControlPlaneRetryEligibility = {
  ok?: boolean;
  eligible?: boolean;
  alreadyQueued?: boolean;
  reason?: string;
  unavailable?: boolean;
  requestId?: string;
  failedLaunchAttemptId?: string;
  drainRetryEpoch?: number | string;
  bootstrapRetryEpoch?: number | string;
  workflowVersionId?: string | null;
  inputContractDigest?: string | null;
  inputBindingsDigest?: string;
  failureCode?: string;
  noWorkEvidence?: {
    consequentialWorkStarted?: boolean;
    operationReceipts?: number;
    artifacts?: number;
    reviewMutations?: number;
  };
};

export type ControlPlaneRetryPresentation =
  | { state: 'hidden' }
  | { state: 'queued' }
  | { state: 'disabled'; reason: string; explanation: string }
  | {
      state: 'available';
      pins: { expectedDrainRetryEpoch: number; expectedWorkflowVersionId: string | null; expectedInputBindingsDigest: string };
      failureCode: string;
    };

export const RETRY_SAFELY_LABEL = 'Retry safely — no work started previously';
export const RETRY_SAFELY_DISTINCTION = 'Retry safely: same request and frozen inputs';
export const RUN_AGAIN_DISTINCTION = 'Run again: creates a new request';

// Evidence that DISABLES the action but is worth explaining. Anything else
// (not found, not this failure class, still pending, unavailable) hides it.
const DISABLED_COPY: Record<string, string> = {
  consequential_work_recorded: 'A previous attempt recorded work with outside effects, so it cannot be replayed as if nothing happened.',
  external_action_recorded: 'A previous attempt recorded an external action, so a safe replay cannot be proven.',
  artifact_recorded: 'A previous attempt declared an artifact, so a safe replay cannot be proven.',
  review_mutation_recorded: 'The Review submission was already reported, so it cannot be replaced by a retry.',
  workflow_version_unavailable: 'The exact agent version this request was frozen to is no longer available.',
  continuation_parent_unavailable: 'The run this continuation belongs to is no longer available.',
  bootstrap_retry_cap_reached: 'This request has already been retried safely the maximum number of times. Use Run again to create a new request.',
  surfaced_attempt_mismatch: 'The failure on file is not the most recent attempt of this request.',
  control_plane_retry_already_advanced: 'This request already moved on from the failed attempt.',
};

export function describeControlPlaneRetry(value: unknown): ControlPlaneRetryPresentation {
  const e = (value && typeof value === 'object' ? value : {}) as ControlPlaneRetryEligibility;
  if (e.ok === true && e.eligible === true && e.alreadyQueued === true) return { state: 'queued' };
  if (e.ok === true && e.eligible === true) {
    const epoch = Number(e.drainRetryEpoch);
    const digest = typeof e.inputBindingsDigest === 'string' ? e.inputBindingsDigest : '';
    // Every pin the server handed us must be echoed back exactly; an eligibility
    // without them is not one we can act on safely.
    if (!Number.isSafeInteger(epoch) || epoch < 0 || !/^[0-9a-f]{64}$/.test(digest)) {
      return { state: 'hidden' };
    }
    return {
      state: 'available',
      pins: {
        expectedDrainRetryEpoch: epoch,
        expectedWorkflowVersionId: typeof e.workflowVersionId === 'string' ? e.workflowVersionId : null,
        expectedInputBindingsDigest: digest,
      },
      failureCode: typeof e.failureCode === 'string' && e.failureCode ? e.failureCode : 'attachment_unobserved',
    };
  }
  const reason = typeof e.reason === 'string' ? e.reason : '';
  if (reason && DISABLED_COPY[reason]) return { state: 'disabled', reason, explanation: DISABLED_COPY[reason] };
  return { state: 'hidden' };
}

// The POST result. Only a server-confirmed requeue counts; anything else is
// reported as not queued and the eligibility is re-read.
export function retryConfirmed(value: unknown): boolean {
  const r = (value && typeof value === 'object' ? value : {}) as { ok?: boolean; requeued?: boolean };
  return r.ok === true && r.requeued === true;
}
