/**
 * lib/generation-proposal-state.ts — what the proposal surface may offer and say.
 *
 * Pure, like lib/review-room-state.ts, and for the same reason: the rules are
 * executable rather than asserted by reading JSX. The stakes are higher here —
 * these guards decide when a button that spends money is live, and what the page
 * claims about money after it was pressed.
 *
 * THE THREE HONESTY RULES OF THIS SURFACE:
 *
 *   1. Approval is authorization, not payment. Clicking Approve never renders
 *      "paid" or "charged" — it renders what was authorized.
 *   2. `unknown` is not `failed`, and it never offers a retry. Retrying work whose
 *      outcome we cannot see is how one clip gets paid for twice.
 *   3. Progress is counted only from durable task events and receipts. Nothing is
 *      interpolated between them.
 */

import type {
  GenerationProposalViewModel, GenerationProgress, GenerationTaskVM,
  GenerationTaskEventVM, GenerationReceiptTaskVM,
} from './generation-proposal';

// ── approval actions ────────────────────────────────────────────────────────

export type ProposalActions = {
  /** May Approve be offered live? */
  canApprove: boolean;
  /** May Cancel be offered? Only a proposal still awaiting approval is cancellable. */
  canCancel: boolean;
  /** May Edit be offered? Editing discards this proposal's identity — see editReset. */
  canEdit: boolean;
  /** The explicit approval label, e.g. "Generate 3 B-rolls — up to 180 credits". */
  approveLabel: string;
  /** One status sentence when approval is not offered, or null. */
  blockedReason: string | null;
};

/** What the compiled tasks are called for humans. Keyed by capability, not guessed. */
export function taskNoun(capabilityKey: string, count: number): string {
  if (capabilityKey === 'video.generate_broll') return count === 1 ? 'B-roll' : 'B-rolls';
  return count === 1 ? 'clip' : 'clips';
}

export function proposalActions(
  vm: Pick<GenerationProposalViewModel,
    'lifecycle' | 'availability' | 'taskCount' | 'maximumCredits' | 'capabilityKey' | 'expiresAt'>,
  now: number,
): ProposalActions {
  const approveLabel = `Generate ${vm.taskCount} ${taskNoun(vm.capabilityKey, vm.taskCount)} — up to ${vm.maximumCredits} credits`;
  const expired = Date.parse(vm.expiresAt) <= now;

  if (vm.lifecycle !== 'awaiting_approval') {
    return {
      canApprove: false, canCancel: false, canEdit: false, approveLabel,
      blockedReason: null, // the progress surface speaks for non-pending lifecycles
    };
  }
  if (vm.availability !== true) {
    // Belt to the parser's braces: an unavailable proposal cannot be approvable.
    return {
      canApprove: false, canCancel: false, canEdit: false, approveLabel,
      blockedReason: 'This proposal is not available to approve.',
    };
  }
  if (expired) {
    // The server is the authority on expiry, but between reads the clock has moved.
    // Offering a button we know will be refused is a worse experience than saying so.
    return {
      canApprove: false, canCancel: false, canEdit: true, approveLabel,
      blockedReason: 'This proposal has expired. Edit it to get a fresh one.',
    };
  }
  return { canApprove: true, canCancel: true, canEdit: true, approveLabel, blockedReason: null };
}

/**
 * The exact approval request. The identity fields are taken from the rendered view
 * model VERBATIM — the client never recomputes, edits, or substitutes them, so the
 * backend's stale-digest check is comparing against what the user actually saw.
 */
export function buildApprovalRequest(
  vm: Pick<GenerationProposalViewModel, 'proposalId' | 'proposalVersion' | 'proposalDigest'>,
  idempotencyKey: string,
): { path: string; body: { proposalVersion: string; proposalDigest: string }; idempotencyKey: string } {
  return {
    path: `/api/v2/generation-proposals/${encodeURIComponent(vm.proposalId)}/approve`,
    body: { proposalVersion: vm.proposalVersion, proposalDigest: vm.proposalDigest },
    idempotencyKey,
  };
}

// ── approval submission single-flight ───────────────────────────────────────
//
// A double-click must send EXACTLY ONE request. The idempotency key makes a
// duplicate harmless server-side; this makes it not happen client-side. Modeled as
// a reducer so the guarantee is testable without a DOM.

export type ApprovalFlight =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'settled' };

export function beginApproval(state: ApprovalFlight): { next: ApprovalFlight; shouldSend: boolean } {
  if (state.phase !== 'idle') return { next: state, shouldSend: false };
  return { next: { phase: 'submitting' }, shouldSend: true };
}

export function settleApproval(state: ApprovalFlight, outcome: 'success' | 'retryable_error'): ApprovalFlight {
  if (state.phase !== 'submitting') return state;
  // A retryable error returns to idle so the user may deliberately try again —
  // with the SAME idempotency key, so even that can never double-authorize.
  return outcome === 'success' ? { phase: 'settled' } : { phase: 'idle' };
}

/**
 * What Edit does to local state: it FORGETS the proposal's approval identity.
 * There is deliberately no field left to approve with — an edited proposal can
 * only be approved after the backend issues a new id, version, and digest.
 */
export type EditableProposalRef = { proposalId: string | null; proposalVersion: string | null; proposalDigest: string | null };

export function editReset(_current: EditableProposalRef): EditableProposalRef {
  return { proposalId: null, proposalVersion: null, proposalDigest: null };
}

/** Honest copy for approval refusals, keyed by the backend's machine-readable code. */
export function approvalErrorCopy(code: string): string {
  switch (code) {
    case 'stale_proposal':
      return 'This proposal changed since you loaded it. Review the current version before approving — nothing was authorized.';
    case 'proposal_expired':
      return 'This proposal expired before it was approved. Nothing was authorized.';
    case 'proposal_already_approved':
      return 'This proposal was already approved — it was not approved twice.';
    case 'proposal_unavailable':
      return 'This proposal is not available to approve.';
    case 'proposal_not_found':
      return 'We could not find this proposal. Nothing was authorized.';
    case 'proposal_not_cancellable':
      return 'This proposal can no longer be cancelled.';
    case 'authorization_mismatch':
      return "The approval did not match this proposal, so it was refused. Nothing was authorized.";
    default:
      return `The approval was refused (${code}). Nothing was authorized.`;
  }
}

// ── progress ────────────────────────────────────────────────────────────────

export type ClipProgress = {
  /** Total clips this proposal compiled. */
  total: number;
  /** Clips with a durable success (receipt row or succeeded event). */
  succeeded: number;
  /** Clips with a durable failure. */
  failed: number;
  /** Clips whose durable outcome is `unknown`. */
  unknown: number;
  /** Clips a durable event says started but nothing durable has finished. */
  started: number;
  /** True when zero task events (and no receipt rows) have been recorded. */
  noEventsYet: boolean;
};

/**
 * Per-clip outcomes derived ONLY from durable records — receipt rows first (they
 * are the finalized statement), then the latest status-bearing task event. Nothing
 * is inferred from wall-clock time or from the run merely being in `generating`.
 */
export function deriveClipProgress(vm: Pick<GenerationProposalViewModel, 'tasks' | 'events' | 'receipt'>): ClipProgress {
  const byTask = new Map<string, 'succeeded' | 'failed' | 'unknown' | 'started' | 'none'>();
  for (const task of vm.tasks) byTask.set(task.taskId, 'none');

  for (const event of vm.events) {
    const prior = byTask.get(event.taskId);
    if (prior === undefined) continue; // parser guarantees membership; stay safe anyway
    if (event.status === 'succeeded' || event.status === 'failed' || event.status === 'unknown') {
      byTask.set(event.taskId, event.status);
    } else if (event.status === 'created' && prior === 'none') {
      byTask.set(event.taskId, 'started');
    }
  }
  // Receipt rows are the finalized outcome and override event-derived state.
  for (const row of vm.receipt?.tasks ?? []) {
    byTask.set(row.taskId, row.status);
  }

  let succeeded = 0; let failed = 0; let unknown = 0; let started = 0;
  for (const state of byTask.values()) {
    if (state === 'succeeded') succeeded += 1;
    else if (state === 'failed') failed += 1;
    else if (state === 'unknown') unknown += 1;
    else if (state === 'started') started += 1;
  }
  return {
    total: vm.tasks.length,
    succeeded, failed, unknown, started,
    noEventsYet: vm.events.length === 0 && (vm.receipt?.tasks.length ?? 0) === 0,
  };
}

export type ProgressPresentation = {
  /** Short badge text. */
  label: string;
  /** One or two honest sentences. */
  description: string;
  /** 'ok' | 'active' | 'attention' | 'bad' | 'muted' — visual tone only. */
  tone: 'ok' | 'active' | 'attention' | 'bad' | 'muted';
  /** True ONLY for `unknown`: the user must not retry automatically. */
  doNotRetry: boolean;
};

/**
 * One presentation per progress state. Every state has its own words — none of
 * them borrow a neighbor's. `unknown` explicitly instructs against retrying.
 */
export function progressPresentation(
  progress: GenerationProgress,
  clips: ClipProgress,
): ProgressPresentation {
  switch (progress) {
    case 'awaiting_approval':
      return {
        label: 'Awaiting your approval', tone: 'attention', doNotRetry: false,
        description: 'Nothing runs and nothing is spent until you approve this proposal.',
      };
    case 'pending':
      return {
        label: 'Approved — waiting for your Desktop', tone: 'active', doNotRetry: false,
        description: 'The authorization is ready. Generation starts when your Implexa Desktop picks it up. Nothing has been generated yet.',
      };
    case 'generating': {
      const finished = clips.succeeded + clips.failed;
      return {
        label: 'Generating', tone: 'active', doNotRetry: false,
        // Counted from durable events only. With none recorded we say exactly that
        // rather than inventing a number.
        description: clips.noEventsYet
          ? 'Generation is claimed by your Desktop, but no clip events have been recorded yet.'
          : `${finished} of ${clips.total} clips finished${clips.failed ? ` (${clips.failed} failed)` : ''}${clips.unknown ? `, ${clips.unknown} unknown` : ''}.`,
      };
    }
    case 'completed':
      return {
        label: 'Completed', tone: 'ok', doNotRetry: false,
        description: clips.failed || clips.unknown
          ? `Finished: ${clips.succeeded} of ${clips.total} clips succeeded, ${clips.failed} failed${clips.unknown ? `, ${clips.unknown} unknown` : ''}.`
          : `All ${clips.total} clips finished.`,
      };
    case 'failed':
      return {
        label: 'Failed', tone: 'bad', doNotRetry: false,
        description: 'This generation failed. Credits for clips that did not run are not consumed.',
      };
    case 'unknown':
      return {
        label: 'Outcome unknown', tone: 'attention', doNotRetry: true,
        description: 'We could not determine whether this generation finished. Do not retry it — a retry could pay for the same clips twice. Check your Desktop, or wait for the record to settle.',
      };
    case 'expired':
      return {
        label: 'Expired', tone: 'muted', doNotRetry: false,
        description: 'This authorization expired before the work completed. Start a new proposal if you still want these clips.',
      };
    case 'cancelled':
      return {
        label: 'Cancelled', tone: 'muted', doNotRetry: false,
        description: 'You cancelled this proposal. Nothing was authorized.',
      };
    case 'unavailable':
      return {
        label: 'Unavailable', tone: 'attention', doNotRetry: false,
        description: 'This proposal cannot run — see the reason above. Nothing was authorized.',
      };
  }
}

/**
 * The credit line. NEVER a dollar line: this contract supplies credits only, and a
 * charge figure the backend did not state is not ours to invent. `chargedCredits`
 * is rendered only once the backend has durably recorded it.
 */
export function creditsLine(vm: Pick<GenerationProposalViewModel, 'maximumCredits' | 'chargedCredits' | 'progress' | 'dollars'>): string {
  // vm.dollars is typed null under contract 2026-08-01; if a future contract adds
  // a backend-supplied figure it must be threaded here — never computed.
  if (vm.progress === 'completed') {
    return `${vm.chargedCredits} credits recorded for this generation (authorized up to ${vm.maximumCredits}).`;
  }
  return `Up to ${vm.maximumCredits} credits authorized. No final charge is recorded yet.`;
}

/**
 * The one sentence shown immediately after a successful approval. States what was
 * authorized; never claims payment happened.
 */
export function approvalConfirmationCopy(vm: Pick<GenerationProposalViewModel, 'taskCount' | 'maximumCredits' | 'capabilityKey'>): string {
  return `Approved. Your Desktop will generate ${vm.taskCount} ${taskNoun(vm.capabilityKey, vm.taskCount)} using up to ${vm.maximumCredits} credits. This authorized the work — it is not a payment record.`;
}

/** Agent/run identity in non-technical words. */
export function requestedByLine(vm: Pick<GenerationProposalViewModel, 'agentSubject'>, agentName: string | null): string {
  return `Requested by your agent “${agentName || vm.agentSubject}”`;
}

// ── timestamp formatting ────────────────────────────────────────────────────

export function formatWindow(window: GenerationTaskVM['window']): string {
  const fmt = (s: number) => {
    const whole = Math.floor(s);
    const m = Math.floor(whole / 60); const sec = whole % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  return `${fmt(window.startSeconds)}–${fmt(window.endSeconds)}`;
}

export type { GenerationTaskEventVM, GenerationReceiptTaskVM };
