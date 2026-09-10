/**
 * lib/training-review-actions.ts — the Training Review write-path allowlist.
 *
 * SPEC: §3.3 (Training Review is not Run Review), §3.4 (candidate compilation),
 * §5 F0 items 5 and 6.
 *
 * ── THE BACKEND OWNS THIS CONTRACT; THIS FILE CONFORMS TO IT ─────────────────────
 *
 * Every upstream path, method, body and header the Dashboard will ever send lives in
 * the `resolveTrainingReviewAction` switch below and NOWHERE else.
 * `lib/training-review-client.ts` is transport only; it never spells a backend path.
 *
 * The shapes here are not this repo's proposal. They are read off the Agent Coach F0
 * routes and their generated contract fixture (`test-fixtures/generated/agent-coach-f0.json`
 * in implexa-backend), and `lib/training-review-contract.test.ts` asserts the eight
 * emitted route strings are byte-identical to that fixture's `routes` map.
 *
 * ── THREE RULES THAT LOOK LIKE DETAILS AND ARE NOT ───────────────────────────────
 *
 * 1. DERIVED FIELDS ARE NEVER SENT. The backend REFUSES a body carrying one
 *    (`derived_field_supplied`) rather than ignoring it, because silently dropping
 *    `anchorDigest` or `influenceState` would let a client believe it had labelled the
 *    authority or the influence of a teaching. `DERIVED_FIELDS` below mirrors the
 *    server's list, and this resolver refuses such a body before it costs a round trip.
 *
 * 2. `training_create_review` CARRIES AN Idempotency-Key HEADER. Opening a review is
 *    the one operation a retry could duplicate, so the server requires a stable key of
 *    at least 8 characters and refuses `invalid_idempotency_key` without one.
 *
 * 3. THERE IS NO ACTIVATION EXPRESSION. `training_decide_proposal` pins the decision
 *    vocabulary to exactly `confirmed | discarded` — the server's own two values. F0
 *    activates nothing, and the guarantee is that no reachable expression here could
 *    ask it to.
 *
 * ── WHY A SECOND ALLOWLIST RATHER THAN MORE ACTIONS IN THE FIRST ─────────────────
 *
 * `lib/review-actions.ts` maps an action to exactly one RUN-review upstream. If the
 * training actions lived there, one mistyped case label or one shared helper would be
 * enough to write a `run_review_*` row for a demonstration — the conflation §3.3 and
 * §8 forbid. Here the two allowlists are disjoint by construction:
 *
 *   · every path this file can emit begins with `COACH_BASE`;
 *   · no action name is shared with `RUN_REVIEW_ACTIONS`;
 *   · this resolver refuses every run-review action name, and
 *     `resolveReviewAction` refuses every training action name.
 *
 * All four are asserted in `lib/training-review-actions.test.ts`, in both directions.
 *
 * PURE ON PURPOSE: no `next/server`, so every refusal branch is executable in a test.
 */

import {
  RUN_REVIEW_ACTIONS, TRAINING_REVIEW_ACTIONS,
  isTrainingReviewAction, type TrainingReviewAction,
} from './review-subject.ts';

export type TrainingUpstream = {
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
  /** Only ever `Idempotency-Key`, and only on review creation. */
  headers?: Readonly<Record<string, string>>;
};

/**
 * The single prefix. Asserted in tests: no emitted path may fall outside it, so a
 * future edit cannot quietly reach `/api/v2/review/...` from this resolver.
 */
export const COACH_BASE = '/api/v2/agent-coach';

/**
 * The projection version this repo parses. Sent on nothing — the backend reads no
 * version from a request body — and compared against what a read returns, so a
 * contract skew is loud rather than a silently half-rendered record.
 */
export const TRAINING_PROJECTION_VERSION = 'agent-training-review.v1';

/** The review contract version the backend stamps on every projection it returns. */
export const TRAINING_REVIEW_CONTRACT_VERSION = 'agent-training-review-session.v1';

/** The generated backend fixture this repo vendors and checks itself against. */
export const TRAINING_FIXTURE_SCHEMA = 'implexa.agent-coach-f0.fixture.v1';

/** The header name, spelled once. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const IDEMPOTENCY_KEY_MIN = 8;

/** Backend bounds, mirrored so the browser refuses what the server would refuse. */
export const COACH_TEXT_MAX = 4000;
/** `MAX_PROPOSALS` in the backend service: ordinals are 0..7. */
export const MAX_PROPOSAL_ORDINAL = 7;
/** A recording longer than this is out of contract for F0's supplied-recording slice. */
export const MAX_RANGE_MS = 24 * 60 * 60 * 1000;

/** The only capture mode this contract enables. Anything else is `capture_mode_not_enabled`. */
export const ENABLED_CAPTURE_MODES = ['supplied'] as const;
/** Backend `EVIDENCE_KINDS`. Note `transcript_span`, not `transcript`. */
export const EVIDENCE_KINDS = ['clip', 'frame', 'transcript_span'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** Backend `PROPOSAL_KINDS`. */
export const PROPOSAL_KINDS = ['decision', 'insufficient_evidence'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
/** Backend `PROPOSED_SCOPES`. */
export const PROPOSED_SCOPES = ['run_local_revision', 'agent_version_candidate', 'both'] as const;
export type ProposedScope = (typeof PROPOSED_SCOPES)[number];
/** Backend SQL `p_confidence IN ('low','medium','high')`. */
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
/**
 * The server's decision vocabulary, complete. There is no third value, and in
 * particular no activation — see rule 3 in the header.
 */
export const PROPOSAL_DECISIONS = ['confirmed', 'discarded'] as const;
export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number];

/**
 * Fields the SERVER derives, mirrored from the backend route's own `DERIVED_FIELDS`.
 * A body carrying one is refused with `derived_field_supplied` rather than ignored.
 */
export const DERIVED_FIELDS: readonly string[] = [
  'sourceKind', 'sourceRole', 'evidenceAuthority', 'sourceDigest', 'sourceReferenceDigest',
  'runReceiptDigest', 'taskSignatureDigest', 'baseVersionId', 'agentFamilyId',
  'ownerId', 'organizationId', 'anchorDigest', 'submissionDigest', 'proposalDigest',
  'canonicalCandidateId', 'canonicalCandidateKey', 'canonicalLinkState',
  'influenceState', 'custodyState', 'status',
];

/** An ANNOTATION's ordinal is server-assigned; a PROPOSAL's is the compiler's own. */
export const ANNOTATION_DERIVED_FIELDS: readonly string[] = ['ordinal'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim() : null);
const SHA256_RE = /^[0-9a-f]{64}$/i;
const digest = (v: unknown): string | null => (typeof v === 'string' && SHA256_RE.test(v.trim()) ? v.trim().toLowerCase() : null);

function uuidList(value: unknown, min: number): string[] | null {
  if (!Array.isArray(value) || value.length < min) return null;
  const values = value.map(id);
  if (values.some((entry) => !entry)) return null;
  const out = values as string[];
  return new Set(out.map((entry) => entry.toLowerCase())).size === out.length ? out : null;
}

/**
 * A bounded moment inside the supplied recording.
 *
 * The backend's annotation and evidence ranges are BOTH-ENDED and non-empty
 * (`endsAtMs > startsAtMs`, refused as `invalid_annotation_range` /
 * `invalid_evidence_range`), so this type carries no point form: a `null` end would be
 * a shape the server has no way to store. A range whose end is at or before its start
 * is refused rather than normalised — silently swapping them changes what the Coach
 * marked.
 */
export type TemporalRange = { startMs: number; endMs: number };

export function parseTemporalRange(raw: unknown): TemporalRange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).sort().join('|') !== 'endMs|startMs') return null;
  const start = value.startMs; const end = value.endMs;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start > MAX_RANGE_MS) return null;
  if (typeof end !== 'number' || !Number.isInteger(end) || end <= start || end > MAX_RANGE_MS) return null;
  return { startMs: start, endMs: end };
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length && trimmed.length <= COACH_TEXT_MAX ? trimmed : null;
};

const optionalText = (v: unknown): string | null => (v === undefined || v === null ? null : text(v));

const intOrNull = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);

/**
 * The 0..1 normalised sub-rectangle the Coach drew, or null.
 *
 * Forwarded verbatim under the server's own key (`region`), and refused here when it
 * is not the shape the server stores — a malformed region rendered as "no region" would
 * quietly move a mark off the thing it pointed at.
 */
export function parseRegion(raw: unknown): { x: number; y: number; w: number; h: number } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).sort().join('|') !== 'h|w|x|y') return null;
  const nums = ['x', 'y', 'w', 'h'].map((key) => value[key]);
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) return null;
  const [x, y, w, h] = nums as number[];
  if (w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return null;
  return { x, y, w, h };
}

/** A body carrying a server-derived field is refused before it is sent. */
function derivedFieldRefusal(b: Record<string, unknown>, extra: readonly string[] = []): string | null {
  for (const field of [...DERIVED_FIELDS, ...extra]) {
    if (Object.prototype.hasOwnProperty.call(b, field)) {
      return `${field} is derived by the server and may not be supplied.`;
    }
  }
  return null;
}

/**
 * Map a training action to its single upstream call. Returns a string on refusal so
 * the Coach gets a real reason rather than a generic 400.
 */
export function resolveTrainingReviewAction(
  action: string, b: Record<string, unknown>,
): TrainingUpstream | string {
  // Named refusal FIRST. A run-review action arriving here is not an unknown string —
  // it is an authority confusion, and saying so is how the bug gets found instead of
  // being read as a typo.
  if ((RUN_REVIEW_ACTIONS as readonly string[]).includes(action)) {
    return 'That is a run-review action. Training review never writes run-review records.';
  }
  if (!isTrainingReviewAction(action)) return 'Unknown training review action.';

  const known: TrainingReviewAction = action;
  switch (known) {
    case 'training_attach_demonstration': {
      const derived = derivedFieldRefusal(b);
      if (derived) return derived;
      const trainingSessionId = id(b.trainingSessionId);
      if (!trainingSessionId) return 'A valid trainingSessionId is required.';
      // §2.4 / §4.2: a DESCRIPTOR travels, never the recording and never a path.
      const localCapabilityId = id(b.localCapabilityId);
      const machineId = id(b.machineId);
      if (!localCapabilityId || !machineId) {
        return 'A demonstration must name the local custody capability and the machine holding it.';
      }
      const mediaSha256 = digest(b.mediaSha256);
      if (!mediaSha256) return 'A demonstration must carry the SHA-256 of the local recording.';
      const sizeBytes = intOrNull(b.sizeBytes);
      if (sizeBytes === null || sizeBytes <= 0) return 'A demonstration must carry a positive recording size.';
      const durationMs = intOrNull(b.durationMs);
      if (durationMs === null || durationMs <= 0) return 'A demonstration must carry a positive recording duration.';
      const captureMode = b.captureMode === undefined ? 'supplied' : b.captureMode;
      if (!(ENABLED_CAPTURE_MODES as readonly unknown[]).includes(captureMode)) {
        return 'Screen capture is not available here. Supply a recording you already have.';
      }
      const divergenceRunId = b.divergenceRunId === undefined || b.divergenceRunId === null
        ? null : id(b.divergenceRunId);
      if (b.divergenceRunId !== undefined && b.divergenceRunId !== null && !divergenceRunId) {
        return 'A divergence run reference must be a UUID.';
      }
      return {
        path: `${COACH_BASE}/sessions/${trainingSessionId}/demonstrations`, method: 'POST',
        body: {
          localCapabilityId, machineId, mediaSha256, sizeBytes,
          mediaType: optionalText(b.mediaType), durationMs,
          captureMode, divergenceRunId,
        },
      };
    }

    case 'training_create_review': {
      const derived = derivedFieldRefusal(b);
      if (derived) return derived;
      // The server's own body key is `sessionId`; the sealed envelope carries the
      // training identity as `trainingSessionId`. The rename happens HERE, once, rather
      // than being spelled differently at each call site.
      const sessionId = id(b.trainingSessionId);
      const sourceId = id(b.sourceId);
      if (!sessionId) return 'A valid trainingSessionId is required.';
      if (!sourceId) return 'A valid sourceId is required.';
      const key = typeof b.idempotencyKey === 'string' ? b.idempotencyKey.trim() : '';
      if (key.length < IDEMPOTENCY_KEY_MIN) {
        return `Opening a review needs a stable idempotency key of at least ${IDEMPOTENCY_KEY_MIN} characters.`;
      }
      return {
        path: `${COACH_BASE}/reviews`, method: 'POST',
        body: { sessionId, sourceId },
        headers: { [IDEMPOTENCY_HEADER]: key },
      };
    }

    case 'training_read_review': {
      const reviewSessionId = id(b.reviewSessionId);
      if (!reviewSessionId) return 'A valid reviewSessionId is required.';
      return { path: `${COACH_BASE}/reviews/${reviewSessionId}`, method: 'GET' };
    }

    case 'training_add_annotation': {
      const derived = derivedFieldRefusal(b, ANNOTATION_DERIVED_FIELDS);
      if (derived) return derived;
      const reviewSessionId = id(b.reviewSessionId);
      if (!reviewSessionId) return 'A valid reviewSessionId is required.';
      const range = parseTemporalRange(b.temporalRange);
      if (!range) return 'A moment needs a start and an end after its start.';
      const coachText = text(b.coachText);
      if (!coachText) return `Say what happened here, in 1–${COACH_TEXT_MAX} characters.`;
      const region = parseRegion(b.region);
      if (b.region !== undefined && b.region !== null && !region) {
        return 'A marked area must be a bounded rectangle inside the frame.';
      }
      // APPEND-ONLY (§3.3). A correction is a NEW moment naming what it supersedes;
      // there is no edit and no delete on the wire, so the frozen submission and any
      // card derived from it keep naming a moment whose words never changed under them.
      const supersedes = b.supersedesAnnotationId === undefined || b.supersedesAnnotationId === null
        ? null : id(b.supersedesAnnotationId);
      if (b.supersedesAnnotationId !== undefined && b.supersedesAnnotationId !== null && !supersedes) {
        return 'A superseded moment reference must be a UUID.';
      }
      const transcriptStartMs = intOrNull(b.transcriptStartMs);
      const transcriptEndMs = intOrNull(b.transcriptEndMs);
      if ((transcriptStartMs === null) !== (transcriptEndMs === null)) {
        return 'A transcript span needs both a start and an end.';
      }
      if (transcriptStartMs !== null && transcriptEndMs !== null && transcriptEndMs <= transcriptStartMs) {
        return 'A transcript span needs an end after its start.';
      }
      return {
        path: `${COACH_BASE}/reviews/${reviewSessionId}/annotations`, method: 'POST',
        body: {
          startsAtMs: range.startMs,
          endsAtMs: range.endMs,
          coachText,
          rationale: optionalText(b.rationale),
          region,
          transcriptStartMs,
          transcriptEndMs,
          transcriptText: optionalText(b.transcriptText),
          supersedesAnnotationId: supersedes,
        },
      };
    }

    case 'training_attach_evidence': {
      const derived = derivedFieldRefusal(b);
      if (derived) return derived;
      const annotationId = id(b.annotationId);
      if (!annotationId) return 'A valid annotationId is required.';
      const evidenceKind = b.evidenceKind;
      if (!(EVIDENCE_KINDS as readonly unknown[]).includes(evidenceKind)) {
        return 'Evidence must be a clip, a frame, or a transcript span.';
      }
      const range = parseTemporalRange(b.temporalRange);
      if (!range) return 'Selected evidence must name the bounded moment it contains.';
      // CONSENT IS NOT A BOOLEAN. The receipt is a digest over the exact excerpt the
      // Coach was shown, so "they agreed" stays checkable rather than asserted.
      const consentReceiptDigest = digest(b.consentReceiptDigest);
      if (!consentReceiptDigest) return 'Keeping an excerpt needs your recorded consent for that exact excerpt.';
      const frameAtMs = intOrNull(b.frameAtMs);
      if (evidenceKind === 'frame' && frameAtMs === null) return 'A kept frame must name the instant it came from.';
      if (evidenceKind !== 'frame' && frameAtMs !== null) return 'Only a frame names a single instant.';
      const transcriptText = optionalText(b.transcriptText);
      if (evidenceKind === 'transcript_span' && !transcriptText) {
        return 'A kept transcript span must carry the words it contains.';
      }
      if (evidenceKind !== 'transcript_span' && transcriptText) {
        return 'Only a transcript span carries transcript text.';
      }
      return {
        path: `${COACH_BASE}/annotations/${annotationId}/evidence`, method: 'POST',
        body: {
          evidenceKind,
          startsAtMs: range.startMs,
          endsAtMs: range.endMs,
          consentReceiptDigest,
          frameAtMs,
          mediaSha256: digest(b.mediaSha256),
          sizeBytes: intOrNull(b.sizeBytes),
          mediaType: optionalText(b.mediaType),
          transcriptText,
        },
      };
    }

    case 'training_freeze_submission': {
      const reviewSessionId = id(b.reviewSessionId);
      if (!reviewSessionId) return 'A valid reviewSessionId is required.';
      // NO BODY. The server freezes exactly the live moments it holds; a client-supplied
      // id list would be a second opinion about what is in the submission, and the two
      // would disagree the moment a moment was superseded between reads.
      return { path: `${COACH_BASE}/reviews/${reviewSessionId}/submission`, method: 'POST' };
    }

    case 'training_record_proposal': {
      const derived = derivedFieldRefusal(b);
      if (derived) return derived;
      const submissionId = id(b.submissionId);
      if (!submissionId) return 'A valid submissionId is required.';
      const kind = b.kind;
      if (!(PROPOSAL_KINDS as readonly unknown[]).includes(kind)) {
        return 'A proposal is a decision or an explicit insufficient_evidence.';
      }
      const ordinal = intOrNull(b.ordinal);
      if (ordinal === null || ordinal < 0 || ordinal > MAX_PROPOSAL_ORDINAL) {
        return `A submission yields at most ${MAX_PROPOSAL_ORDINAL + 1} cards.`;
      }
      const sourceAnnotationIds = b.sourceAnnotationIds === undefined ? [] : uuidList(b.sourceAnnotationIds, 0);
      if (!sourceAnnotationIds) return 'Cited moments must be distinct UUIDs.';
      // §3.4: a card that cannot be justified says so EXPLICITLY, as its own kind. It is
      // not an error and it is not an omission — emitting fewer cards instead would read
      // as a recording that simply taught less.
      if (kind === 'insufficient_evidence' && !text(b.insufficientEvidenceReason)) {
        return 'An insufficient-evidence card must say what the recording could not justify.';
      }
      if (kind === 'decision' && !sourceAnnotationIds.length) {
        return 'A decision card must cite the moments it came from.';
      }
      const proposedScope = b.proposedScope === undefined || b.proposedScope === null ? null : b.proposedScope;
      if (proposedScope !== null && !(PROPOSED_SCOPES as readonly unknown[]).includes(proposedScope)) {
        return 'A decision card must name where it would apply.';
      }
      const confidence = b.confidence === undefined || b.confidence === null ? null : b.confidence;
      if (confidence !== null && !(CONFIDENCE_LEVELS as readonly unknown[]).includes(confidence)) {
        return 'Confidence is low, medium, or high.';
      }
      return {
        path: `${COACH_BASE}/submissions/${submissionId}/proposals`, method: 'POST',
        body: {
          ordinal, kind, sourceAnnotationIds,
          triggerText: optionalText(b.triggerText),
          rejectedTreatment: optionalText(b.rejectedTreatment),
          selectedTreatment: optionalText(b.selectedTreatment),
          rationale: optionalText(b.rationale),
          invariantText: optionalText(b.invariantText),
          exceptionText: optionalText(b.exceptionText),
          proposedScope: proposedScope as ProposedScope | null,
          confidence: confidence as ConfidenceLevel | null,
          affectedStepIndex: intOrNull(b.affectedStepIndex),
          affectedCapabilityIdentity: optionalText(b.affectedCapabilityIdentity),
          insufficientEvidenceReason: optionalText(b.insufficientEvidenceReason),
        },
      };
    }

    case 'training_decide_proposal': {
      const proposalId = id(b.proposalId);
      if (!proposalId) return 'A valid proposalId is required.';
      const decision = b.decision;
      // NOTHING HERE ACTIVATES (§5 F0 must-nots). The vocabulary is the server's two
      // values, pinned. Confirming links or DEFERS a canonical learning candidate; the
      // promotion authority is a separate, later, explicit act, and this resolver has
      // no path that could request it.
      if (!(PROPOSAL_DECISIONS as readonly unknown[]).includes(decision)) {
        return 'A card is confirmed or discarded.';
      }
      // The digest the Coach must echo back. Without it a confirmation could land on a
      // card the Coach was never shown, which is why the server treats a missing one as
      // `stale_proposal_confirmation` rather than a generic bad request.
      const expectedProposalDigest = digest(b.expectedProposalDigest);
      if (!expectedProposalDigest) return 'Confirm the card you were shown: its digest is required.';
      return {
        path: `${COACH_BASE}/proposals/${proposalId}/decision`, method: 'POST',
        body: { decision: decision as ProposalDecision, expectedProposalDigest },
      };
    }

    default:
      // Unreachable: `known` is exhausted above, so this arm makes a new action name
      // a COMPILE error rather than a silent fall-through to an unguarded proxy.
      return ((value: never) => `Unhandled training review action ${String(value)}.`)(known);
  }
}

/** Every action this resolver will accept, for the disjointness tests. */
export const TRAINING_ACTION_NAMES: readonly string[] = TRAINING_REVIEW_ACTIONS;

/**
 * The route TEMPLATES, in the backend fixture's own spelling.
 *
 * These strings exist to be compared byte-for-byte against
 * `agent-coach-f0.json → routes` in `lib/training-review-contract.test.ts`. They are
 * documentation only in the sense that nothing reads them at runtime — and they are
 * the whole point in the sense that a resolver whose emitted path stops matching its
 * template is exactly the drift the contract test is there to catch.
 */
export const TRAINING_ROUTE_TEMPLATES: Readonly<Record<TrainingReviewAction, string>> = Object.freeze({
  training_attach_demonstration: 'POST /api/v2/agent-coach/sessions/:trainingSessionId/demonstrations',
  training_create_review: 'POST /api/v2/agent-coach/reviews',
  training_read_review: 'GET /api/v2/agent-coach/reviews/:reviewSessionId',
  training_add_annotation: 'POST /api/v2/agent-coach/reviews/:reviewSessionId/annotations',
  training_attach_evidence: 'POST /api/v2/agent-coach/annotations/:annotationId/evidence',
  training_freeze_submission: 'POST /api/v2/agent-coach/reviews/:reviewSessionId/submission',
  training_record_proposal: 'POST /api/v2/agent-coach/submissions/:submissionId/proposals',
  training_decide_proposal: 'POST /api/v2/agent-coach/proposals/:proposalId/decision',
});

/** The backend fixture's `routes` keys, in its order, for the 1:1 correspondence test. */
export const TRAINING_ROUTE_KEYS: Readonly<Record<TrainingReviewAction, string>> = Object.freeze({
  training_attach_demonstration: 'attachDemonstration',
  training_create_review: 'createReview',
  training_read_review: 'readReview',
  training_add_annotation: 'addAnnotation',
  training_attach_evidence: 'attachEvidence',
  training_freeze_submission: 'freezeSubmission',
  training_record_proposal: 'recordProposal',
  training_decide_proposal: 'decideProposal',
});
