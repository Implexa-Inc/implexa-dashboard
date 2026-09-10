/**
 * lib/training-review-client.ts — the ONLY module in the browser that talks to the
 * Agent Coach API.
 *
 * SPEC §5 F0 items 5, 6, 8. The wire contract is the backend's, not this repo's.
 *
 * ── WHY EVERYTHING FUNNELS THROUGH ONE MODULE ────────────────────────────────────
 *
 * Two files carry the upstream contract, and no others:
 *
 *   · UPSTREAM PATHS + BODIES + HEADERS  `lib/training-review-actions.ts`
 *   · BROWSER TRANSPORT                  this file
 *
 * No component may call `fetch` for training review. Every write goes through
 * `sealWrite`, so every request carries its authority and its training identity, and
 * a component holding a `TrainingReviewWritePath` has no expression available to it
 * that would produce a run-review write (see `lib/review-subject.ts`).
 *
 * ── REFUSALS ARE TYPED, NOT STRINGIFIED ──────────────────────────────────────────
 *
 * The backend answers every refusal `{ ok:false, reason, error }`, and the `reason` is
 * the only part a caller can branch on. This module keeps it — see
 * `lib/training-review-refusals.ts` — because flattening a refusal to its sentence is
 * how "coaching is switched off here" and "you have coached nothing" end up looking
 * the same on screen.
 *
 * ── INJECTABLE TRANSPORT ─────────────────────────────────────────────────────────
 *
 * The caller may supply the transport, so every branch here — including every refusal
 * and every unreadable response — is executable in a test against local fixtures with
 * no network and no server.
 */

import {
  sealWrite,
  type TrainingReviewAction, type TrainingReviewWrite, type TrainingReviewWritePath,
} from './review-subject.ts';
import {
  CONFIDENCE_LEVELS, IDEMPOTENCY_KEY_MIN,
  TRAINING_PROJECTION_VERSION, TRAINING_REVIEW_CONTRACT_VERSION,
  type ConfidenceLevel, type EvidenceKind, type ProposalDecision, type ProposalKind,
  type ProposedScope, type TemporalRange,
} from './training-review-actions.ts';
import {
  isUnavailableReason, refusalSentence,
  type TrainingReviewRefusalReason, isTrainingReviewRefusalReason,
} from './training-review-refusals.ts';
import {
  parseTrainingReview, type TrainingReviewStatus,
} from './training-review-projection.ts';

/** The dashboard route. The backend paths live in `training-review-actions.ts`. */
export const TRAINING_REVIEW_ROUTE = '/api/training-review';

export type TrainingTransport = (
  route: string, body: Record<string, unknown>,
) => Promise<{ status: number; body: Record<string, unknown> }>;

/**
 * The default transport. Mirrors `reviewAction` in `review-room.tsx`: an unreadable
 * body becomes a refusal object rather than a thrown parse error, so the caller
 * always has something to show.
 */
export const fetchTransport: TrainingTransport = async (route, body) => {
  const res = await fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({ ok: false, error: 'Unreadable response.' }));
  return { status: res.status, body: parsed as Record<string, unknown> };
};

export type TrainingResult<T> =
  | { readonly ok: true; readonly value: T }
  /**
   * A refusal the Coach can read. `unavailable` distinguishes "we could not reach the
   * service" from "the service said no" — the same three-valued discipline
   * `lib/review.ts` keeps for reads, because they need different words and different
   * buttons. `reason` is the server's typed reason when it sent one this repo knows.
   */
  | {
    readonly ok: false;
    readonly error: string;
    readonly unavailable: boolean;
    readonly reason: TrainingReviewRefusalReason | null;
  };

const refusal = (
  error: string, unavailable = false, reason: TrainingReviewRefusalReason | null = null,
): TrainingResult<never> => ({ ok: false, error, unavailable, reason });

async function send(
  path: TrainingReviewWritePath,
  action: TrainingReviewAction,
  fields: Record<string, unknown>,
  transport: TrainingTransport,
): Promise<TrainingResult<Record<string, unknown>>> {
  const envelope: TrainingReviewWrite = sealWrite(path, action, fields);
  let response: { status: number; body: Record<string, unknown> };
  try {
    response = await transport(envelope.route, { action: envelope.action, ...envelope.payload });
  } catch {
    return refusal('Could not reach the coaching service. Nothing was changed.', true, 'coaching_unavailable');
  }
  const body = response.body ?? {};
  if (response.status >= 200 && response.status < 300 && body.ok === true) {
    return { ok: true, value: body };
  }
  const reason = isTrainingReviewRefusalReason(body.reason) ? body.reason : null;
  const error = refusalSentence(body.reason, typeof body.error === 'string' ? body.error : null);
  // 5xx and the three typed unavailable reasons both mean "the surface could not
  // answer". `body.unavailable` is the backend's own flag on a projection it refused
  // to build, and it is honoured rather than re-derived from the status code alone.
  const unavailable = response.status >= 500 || body.unavailable === true || isUnavailableReason(body.reason);
  return refusal(error, unavailable, reason);
}

// ── Writes ────────────────────────────────────────────────────────────────────────

export type AttachedDemonstration = {
  sourceId: string;
  created: boolean;
};

/**
 * Register a recording the Coach already has. NOTHING IS UPLOADED: what travels is a
 * descriptor — a digest, a size, a duration and the local custody binding.
 */
export async function attachTrainingDemonstration(
  path: TrainingReviewWritePath,
  input: {
    localCapabilityId: string;
    machineId: string;
    mediaSha256: string;
    sizeBytes: number;
    durationMs: number;
    mediaType?: string | null;
    divergenceRunId?: string | null;
  },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<AttachedDemonstration>> {
  const result = await send(path, 'training_attach_demonstration', { ...input }, transport);
  if (!result.ok) return result;
  const sourceId = typeof result.value.sourceId === 'string' ? result.value.sourceId : null;
  return sourceId
    ? { ok: true, value: { sourceId, created: result.value.created === true } }
    : refusal('The coaching service did not name the demonstration it registered.');
}

export type OpenedTrainingReview = {
  reviewSessionId: string;
  status: string | null;
  recordingDurationMs: number | null;
  created: boolean;
};

/**
 * Open the review of one demonstration.
 *
 * The idempotency key is REQUIRED and is the caller's, not this module's: a key minted
 * here per call would make every retry a new review, which is the exact duplication the
 * header exists to prevent. `stableIdempotencyKey` below derives one from the subject
 * for callers that have nothing better.
 */
export async function createTrainingReview(
  path: TrainingReviewWritePath,
  input: { idempotencyKey: string },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<OpenedTrainingReview>> {
  const result = await send(path, 'training_create_review', { idempotencyKey: input.idempotencyKey }, transport);
  if (!result.ok) return result;
  const reviewSessionId = typeof result.value.reviewSessionId === 'string' ? result.value.reviewSessionId : null;
  if (!reviewSessionId) return refusal('The coaching service did not name a review session.');
  return {
    ok: true,
    value: {
      reviewSessionId,
      status: typeof result.value.status === 'string' ? result.value.status : null,
      recordingDurationMs: Number.isInteger(result.value.recordingDurationMs)
        ? (result.value.recordingDurationMs as number) : null,
      created: result.value.created === true,
    },
  };
}

/**
 * A key that is stable for one (session, source) pair.
 *
 * Deliberately DERIVED rather than random: a reload must produce the same key, or the
 * retry it triggers opens a second review of the same recording. Callers with a durable
 * per-attempt identity of their own should pass that instead.
 */
export function stableIdempotencyKey(subject: { trainingSessionId: string; sourceId: string }): string {
  const key = `coach-${subject.trainingSessionId}-${subject.sourceId}`;
  return key.length >= IDEMPOTENCY_KEY_MIN ? key : `${key}-review`;
}

export async function addTrainingAnnotation(
  path: TrainingReviewWritePath,
  input: {
    reviewSessionId: string;
    temporalRange: TemporalRange;
    coachText: string;
    rationale?: string | null;
    region?: { x: number; y: number; w: number; h: number } | null;
    transcriptStartMs?: number | null;
    transcriptEndMs?: number | null;
    transcriptText?: string | null;
    /** APPEND-ONLY: a correction names the moment it replaces; it never rewrites it. */
    supersedesAnnotationId?: string | null;
  },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<{ annotationId: string; ordinal: number | null; anchorDigest: string | null }>> {
  const result = await send(path, 'training_add_annotation', { ...input }, transport);
  if (!result.ok) return result;
  // The server mints the id, the ordinal AND the anchor digest. A client that supplied
  // any of them would be refused (`derived_field_supplied`); a client that INVENTED one
  // for display would be showing an anchor nothing was actually anchored to.
  const annotationId = typeof result.value.annotationId === 'string' ? result.value.annotationId : null;
  if (!annotationId) return refusal('The coaching service did not name the moment it saved.');
  return {
    ok: true,
    value: {
      annotationId,
      ordinal: Number.isInteger(result.value.ordinal) ? (result.value.ordinal as number) : null,
      anchorDigest: typeof result.value.anchorDigest === 'string' ? result.value.anchorDigest : null,
    },
  };
}

export async function attachTrainingEvidence(
  path: TrainingReviewWritePath,
  input: {
    annotationId: string;
    evidenceKind: EvidenceKind;
    temporalRange: TemporalRange;
    consentReceiptDigest: string;
    frameAtMs?: number | null;
    mediaSha256?: string | null;
    sizeBytes?: number | null;
    mediaType?: string | null;
    transcriptText?: string | null;
  },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<{ evidenceId: string }>> {
  const result = await send(path, 'training_attach_evidence', { ...input }, transport);
  if (!result.ok) return result;
  const evidenceId = typeof result.value.evidenceId === 'string' ? result.value.evidenceId : null;
  return evidenceId
    ? { ok: true, value: { evidenceId } }
    : refusal('The coaching service did not name the evidence it recorded.');
}

export type TrainingSubmissionResult = {
  submissionId: string;
  submissionDigest: string | null;
  annotationCount: number | null;
  created: boolean;
};

export async function freezeTrainingSubmission(
  path: TrainingReviewWritePath,
  input: { reviewSessionId: string },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<TrainingSubmissionResult>> {
  const result = await send(path, 'training_freeze_submission', { ...input }, transport);
  if (!result.ok) return result;
  const submissionId = typeof result.value.submissionId === 'string' ? result.value.submissionId : null;
  if (!submissionId) return refusal('The coaching service did not name the submission it froze.');
  return {
    ok: true,
    value: {
      submissionId,
      submissionDigest: typeof result.value.submissionDigest === 'string' ? result.value.submissionDigest : null,
      annotationCount: Number.isInteger(result.value.annotationCount)
        ? (result.value.annotationCount as number) : null,
      created: result.value.created === true,
    },
  };
}

export async function recordTrainingProposal(
  path: TrainingReviewWritePath,
  input: {
    submissionId: string;
    ordinal: number;
    kind: ProposalKind;
    sourceAnnotationIds?: readonly string[];
    triggerText?: string | null;
    rejectedTreatment?: string | null;
    selectedTreatment?: string | null;
    rationale?: string | null;
    invariantText?: string | null;
    exceptionText?: string | null;
    proposedScope?: ProposedScope | null;
    confidence?: ConfidenceLevel | null;
    affectedStepIndex?: number | null;
    affectedCapabilityIdentity?: string | null;
    insufficientEvidenceReason?: string | null;
  },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<{ proposalId: string; canonicalLinkState: string | null }>> {
  const result = await send(path, 'training_record_proposal', {
    ...input,
    sourceAnnotationIds: input.sourceAnnotationIds ? [...input.sourceAnnotationIds] : [],
  }, transport);
  if (!result.ok) return result;
  const proposalId = typeof result.value.proposalId === 'string' ? result.value.proposalId : null;
  if (!proposalId) return refusal('The coaching service did not name the decision card it recorded.');
  return {
    ok: true,
    value: {
      proposalId,
      canonicalLinkState: typeof result.value.canonicalLinkState === 'string'
        ? result.value.canonicalLinkState : null,
    },
  };
}

export type TrainingDecisionResult = {
  proposalId: string;
  status: string | null;
  /** `unlinked` | `linked_existing` | `mint_deferred`, as the server reported it. */
  canonicalLinkState: string | null;
  canonicalCandidateId: string | null;
  /** Always `inert` in this contract. Read, never assumed. */
  influenceState: string | null;
  idempotent: boolean;
};

/**
 * Decide one proposed card.
 *
 * `activate` is NOT a parameter, here or on the wire — the server has no such field.
 * The decision vocabulary is exactly `confirmed | discarded`, pinned in the resolver,
 * so there is no expression in this module that could request an activation.
 *
 * `expectedProposalDigest` is required and is the digest of the card the Coach was
 * SHOWN. Without it a confirmation could land on a card that changed underneath them,
 * which the server refuses as `stale_proposal_confirmation`.
 */
export async function decideTrainingProposal(
  path: TrainingReviewWritePath,
  input: {
    proposalId: string;
    decision: ProposalDecision;
    expectedProposalDigest: string;
  },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingResult<TrainingDecisionResult>> {
  const result = await send(path, 'training_decide_proposal', { ...input }, transport);
  if (!result.ok) return result;
  const proposalId = typeof result.value.proposalId === 'string' ? result.value.proposalId : input.proposalId;
  return {
    ok: true,
    value: {
      proposalId,
      status: typeof result.value.status === 'string' ? result.value.status : null,
      // MINT DEFERRED IS NOT A FAILURE AND NOT A LEARNING. It is read and reported
      // verbatim; see `training-review-projection.ts` for what the surface may say
      // about it.
      canonicalLinkState: typeof result.value.canonicalLinkState === 'string'
        ? result.value.canonicalLinkState : null,
      canonicalCandidateId: typeof result.value.canonicalCandidateId === 'string'
        ? result.value.canonicalCandidateId : null,
      influenceState: typeof result.value.influenceState === 'string'
        ? result.value.influenceState : null,
      idempotent: result.value.idempotent === true,
    },
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────────

/**
 * The read-only projection (F0 item 8).
 *
 * Returns a STATUS, never null: an unreachable service is `live: false` with a
 * reason, so the surface can say it could not read the record instead of rendering an
 * empty one.
 */
export async function readTrainingReview(
  path: TrainingReviewWritePath,
  input: { reviewSessionId: string },
  transport: TrainingTransport = fetchTransport,
): Promise<TrainingReviewStatus> {
  const envelope = sealWrite(path, 'training_read_review', { reviewSessionId: input.reviewSessionId });
  try {
    const response = await transport(envelope.route, { action: envelope.action, ...envelope.payload });
    return parseTrainingReview(response.body, {
      projectionVersion: TRAINING_PROJECTION_VERSION,
      contractVersion: TRAINING_REVIEW_CONTRACT_VERSION,
    });
  } catch {
    return { live: false, reason: 'unreachable', unavailable: true };
  }
}

/** Re-exported so callers type a confidence without importing the actions module. */
export { CONFIDENCE_LEVELS };
