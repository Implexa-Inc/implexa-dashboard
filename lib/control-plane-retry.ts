// "Retry safely — no work started previously" (backend 0336).
//
// A request whose Codex child never attached Implexa's control tools did no
// work. The BACKEND proves that positively from its ledger and hands back an
// opaque, single-use GRANT bound to exactly what it read; this module only turns
// that payload into what the UI may say and do. It is deliberately separate
// from "Run again" (a new request) — the two are never merged.
//
// The sentence "No work or provider action started" is a CLAIM. It is shown only
// when the backend affirmed eligibility (available) or confirmed a queued
// receipt. Every refused or uncertain state says only why the action is not
// available, never that nothing happened.

export type ControlPlaneRetryEligibility = {
  ok?: boolean;
  eligible?: boolean;
  alreadyQueued?: boolean;
  reason?: string;
  unavailable?: boolean;
  grantId?: string;
  grantExpiresAt?: string;
  requestId?: string;
  failedLaunchAttemptId?: string;
  drainRetryEpoch?: number | string;
  bootstrapRetryEpoch?: number | string;
  workflowVersionId?: string | null;
  inputContractDigest?: string | null;
  inputBindingsDigest?: string;
  failureCode?: string;
  leaseRetirementRequired?: boolean;
  noWorkEvidence?: {
    attemptsProven?: number;
    consequentialWorkStarted?: boolean;
    operationReceipts?: number;
    artifacts?: number;
    reviewMutations?: number;
    ownerRecoveryIndex?: number;
    ownerRecoveryLimit?: number;
    ownerRecoveryExpiresAt?: string;
    priorWorkerStarted?: boolean;
    globalNoActionProven?: boolean | null;
  };
};

export type ControlPlaneRetryPresentation =
  | { state: 'hidden' }
  | { state: 'queued'; paidPrelaunch?: true }
  | { state: 'disabled'; reason: string; explanation: string; workMayHaveOccurred: boolean }
  | { state: 'available'; grantId: string; failureCode: string; workflowVersionId: string; paidPrelaunch?: true; leaseRetirement?: true; ownerRecoveryIndex?: number; ownerRecoveryLimit?: number; unknownRuntimeHistory?: true };

export const RETRY_SAFELY_LABEL = 'Retry safely — no work started previously';
export const RETRY_SAFELY_DISTINCTION = 'Retry safely: same request and frozen inputs';
export const RUN_AGAIN_DISTINCTION = 'Run again: creates a new request';
export const NO_WORK_CLAIM = 'Implexa could not attach its control tools before work began. No work or provider action started.';
export const QUEUED_RECEIPT = 'Queued again safely — same request, frozen inputs. Implexa will verify its control tools before any work starts.';
export const PAID_RECOVERY_LABEL = 'Resume the same approved paid batch';
export const PAID_RECOVERY_CLAIM = 'The failed attempt ended without a start acknowledgment or an irreversible paid claim. Recovery retains the same approved requests and budget; it does not approve a new batch.';
export const PAID_QUEUED_RECEIPT = 'The same approved paid batch was queued again with frozen inputs. No extra paid authority was created.';
export const PAID_LEASE_RETIREMENT_CLAIM = 'This expired prelaunch lease never completed its mandatory tool-contract issuance. Retire its authority and resume the same approved batch, preserving stored learning records. This does not prove that an unknown process died or approve extra spending.';
export const PAID_ISSUED_LEASE_RETIREMENT_CLAIM = 'This expired attempt received its tool contract but never acknowledged process start. Retire its authority and use one additional owner-approved recovery of the same batch. Its contract and history remain preserved. This does not prove that an unknown process died or approve extra spending.';
export const PAID_CLOSED_OWNER_RECOVERY_CLAIM = 'This attempt is already closed without a start acknowledgment or an irreversible paid claim. Use the one additional owner-approved recovery of the same batch, retaining its issued contract and original failure. The recorded failure cause is unknown. This does not prove process death or approve extra spending.';
export const PAID_CLOSED_CLASS_RECOVERY_CLAIM = 'This prelaunch attempt is closed. Owner-confirmed recovery keeps the same approved batch, budget and original failure history. The window allows five owner recoveries within 24 hours; any paid claim blocks this recovery. Other started or unknown attempts cannot be retried this way. This does not prove process death or approve extra spending.';
export const PAID_POSTSTART_UNCLAIMED_CLAIM = 'The worker started and its failed, empty result was settled. No managed paid execution claim was issued for this approved batch. One owner recovery uses the same frozen batch and budget, inside the existing deadline and count limit. The original unknown-runtime classification stays unchanged. This is not proof of no work or process death, and cannot retry submitted media.';
export const PAID_SETTLED_BATCH_RESUME_CLAIM = 'The worker failed after its managed paid claims were settled. Resume the same approved batch by reusing those settled clips and submitting only the remaining unclaimed items, within the original budget and deadline. The original failed runtime history stays unchanged. This is not proof of no work or process death and does not authorize another purchase of a settled clip.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Refusals where work or an external action MAY have occurred. These must never
// be accompanied by the no-work claim.
const WORK_MAY_HAVE_OCCURRED: Record<string, string> = {
  paid_prelaunch_recovery_unproven: 'This paid continuation lacks the closed-attempt and no-managed-submission evidence required for owner recovery with its original approval.',
  paid_poststart_recovery_unavailable: 'This closed worker cannot use the one-time unclaimed-paid recovery within its fixed window. Its history stays unchanged; no new paid batch is authorized.',
  paid_settled_resume_unavailable: 'This batch cannot resume within its existing owner recovery window. All managed claims must be settled before resuming; no extra paid authority was created.',
  consequential_work_recorded: 'A previous attempt recorded work with outside effects, so it cannot be replayed as if nothing happened.',
  external_action_recorded: 'A previous attempt recorded an external action, so a safe replay cannot be proven.',
  artifact_recorded: 'A previous attempt declared an artifact, so a safe replay cannot be proven.',
  review_mutation_recorded: 'The Review submission was already reported, so it cannot be replaced by a retry.',
  attempt_not_terminal: 'An earlier attempt never reported how it ended, so Implexa cannot prove that nothing happened.',
  attempt_runtime_unverified: 'An earlier attempt ran without verified runtime evidence, so Implexa cannot prove that nothing happened.',
  attempt_outcome_ambiguous: 'An earlier attempt ended in a state Implexa cannot classify as no-work.',
  attempt_authority_unknown: 'An earlier attempt carries evidence Implexa does not recognise, so a safe replay cannot be proven.',
  not_control_plane_attachment_failure: 'The most recent attempt did not end as a control-plane attachment failure with parent-proven no-action evidence.',
  surfaced_attempt_mismatch: 'The failure on file is not the most recent attempt of this request.',
};

// Refusals about the frozen definition or the action's own bounds. No work
// happened, but that is not what these say — they say why the promise cannot
// be kept.
const PROMISE_NOT_KEEPABLE: Record<string, string> = {
  workflow_version_unpinned: 'This request was created before agent versions were frozen, so the exact definition cannot be promised. Use Run again to create a new request.',
  workflow_version_unavailable: 'The exact agent version this request was frozen to is no longer available.',
  workflow_version_foreign: 'The frozen version does not belong to this agent.',
  workflow_version_not_applied: 'The frozen version is not an applied version of this agent.',
  input_contract_identity_mismatch: 'The frozen version no longer matches the input contract this request was created with.',
  continuation_parent_unavailable: 'The run this continuation belongs to is no longer available.',
  bootstrap_retry_cap_reached: 'This request has already been retried safely the maximum number of times. Use Run again to create a new request.',
  control_plane_retry_already_advanced: 'This request already moved on from the failed attempt.',
};

export function describeControlPlaneRetry(value: unknown): ControlPlaneRetryPresentation {
  const e = (value && typeof value === 'object' ? value : {}) as ControlPlaneRetryEligibility;
  const paid = e.failureCode === 'paid_prelaunch_recovery' || e.failureCode === 'paid_unacknowledged_lease_retirement'
    || e.failureCode === 'paid_owner_closed_prelaunch_recovery' || e.failureCode === 'paid_poststart_unclaimed'
    || e.failureCode === 'paid_settled_batch_resume';
  if (e.ok === true && e.eligible === true && e.alreadyQueued === true) return { state: 'queued', ...(paid ? { paidPrelaunch: true as const } : {}) };
  if (e.ok === true && e.eligible === true) {
    // The grant is the only authority we may act with; an eligibility without
    // one (or without the frozen version it promises) is not actionable.
    if (typeof e.grantId !== 'string' || !UUID.test(e.grantId)) return { state: 'hidden' };
    if (typeof e.workflowVersionId !== 'string' || !UUID.test(e.workflowVersionId)) return { state: 'hidden' };
    return {
      state: 'available', grantId: e.grantId, workflowVersionId: e.workflowVersionId,
      failureCode: typeof e.failureCode === 'string' && e.failureCode ? e.failureCode : 'attachment_unobserved',
      ...(paid ? { paidPrelaunch: true as const } : {}),
      ...(paid && e.leaseRetirementRequired === true ? { leaseRetirement: true as const } : {}),
      ...((e.failureCode === 'paid_owner_closed_prelaunch_recovery' || e.failureCode === 'paid_poststart_unclaimed'
        || e.failureCode === 'paid_settled_batch_resume')
        && Number.isInteger(e.noWorkEvidence?.ownerRecoveryIndex)
        && e.noWorkEvidence!.ownerRecoveryIndex! >= 1 && e.noWorkEvidence!.ownerRecoveryIndex! <= 5
        && e.noWorkEvidence?.ownerRecoveryLimit === 5
        ? { ownerRecoveryIndex: e.noWorkEvidence.ownerRecoveryIndex, ownerRecoveryLimit: 5 } : {}),
      ...(paid && e.noWorkEvidence?.priorWorkerStarted === true && e.noWorkEvidence?.globalNoActionProven === false
        ? { unknownRuntimeHistory: true as const } : {}),
    };
  }
  const reason = typeof e.reason === 'string' ? e.reason : '';
  if (reason && WORK_MAY_HAVE_OCCURRED[reason]) return { state: 'disabled', reason, explanation: WORK_MAY_HAVE_OCCURRED[reason], workMayHaveOccurred: true };
  if (reason && PROMISE_NOT_KEEPABLE[reason]) return { state: 'disabled', reason, explanation: PROMISE_NOT_KEEPABLE[reason], workMayHaveOccurred: false };
  return { state: 'hidden' };
}

// Whether the presentation may carry the no-work claim at all.
export function mayClaimNoWork(p: ControlPlaneRetryPresentation): boolean {
  return (p.state === 'available' || p.state === 'queued') && !p.paidPrelaunch;
}

// The POST result. Only a server-confirmed requeue counts; anything else is
// reported as not queued and the eligibility is re-read.
export function retryConfirmed(value: unknown): boolean {
  const r = (value && typeof value === 'object' ? value : {}) as { ok?: boolean; requeued?: boolean };
  return r.ok === true && r.requeued === true;
}
