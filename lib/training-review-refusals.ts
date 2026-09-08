/**
 * lib/training-review-refusals.ts — the Agent Coach refusal vocabulary, adopted wholesale.
 *
 * ── THE BACKEND IS THE ONLY AUTHOR OF THIS LIST ──────────────────────────────────
 *
 * These 66 strings are copied from the backend's generated contract fixture
 * (`test-fixtures/generated/agent-coach-f0.json` → `refusalReasons`), which is itself
 * produced by running the real routes and service over synthetic rows. The Dashboard
 * does not add to it, does not rename anything in it, and does not keep a "friendlier"
 * parallel list.
 *
 * WHY THAT MATTERS MORE THAN IT LOOKS. Every refusal on this surface crosses HTTP as
 * `{ ok:false, reason, error }`. If this repo held its own vocabulary, the two would
 * agree right up until the backend added a reason — and the first symptom would be a
 * Coach seeing a generic "that was refused" for a refusal the server explained
 * precisely. `training-review-contract.test.ts` asserts this set is byte-identical to
 * the backend fixture's, so a divergence fails here rather than in production.
 *
 * A reason this repo does not recognise is still RENDERED — see `refusalSentence` — as
 * the server's own `error` text. An unknown reason means the backend is ahead of us,
 * which is not the Coach's problem to decode.
 */

/**
 * VERBATIM, and in the backend's order. The order is part of the byte-for-byte
 * agreement: re-sorting would make a genuine drift invisible to a set comparison that
 * someone later relaxes into a list comparison.
 */
export const TRAINING_REVIEW_REFUSAL_REASONS = [
  'coaching_disabled',
  'coaching_not_migrated',
  'coaching_unavailable',
  'invalid_request',
  'invalid_idempotency_key',
  'idempotency_key_conflict',
  'invalid_source_mode',
  'source_mode_not_enabled',
  'invalid_privacy_scope',
  'organization_membership_required',
  'agent_not_owned',
  'version_not_of_agent',
  'custody_binding_required',
  'invalid_media_digest',
  'invalid_media_size',
  'invalid_media_type',
  'invalid_media_duration',
  'invalid_capture_mode',
  'capture_mode_not_enabled',
  'captured_at_not_observed',
  'session_not_found',
  'session_terminal',
  'session_mode_mismatch',
  'divergence_run_not_owned',
  'divergence_run_scope_mismatch',
  'source_not_of_session',
  'source_not_a_demonstration',
  'review_already_open',
  'review_not_found',
  'review_closed',
  'submission_frozen',
  'coach_text_required',
  'invalid_annotation_range',
  'annotation_outside_recording',
  'invalid_transcript_span',
  'transcript_outside_annotation',
  'superseded_annotation_not_found',
  'annotation_already_superseded',
  'annotation_budget_exhausted',
  'invalid_evidence_kind',
  'consent_receipt_required',
  'invalid_evidence_range',
  'evidence_not_contained',
  'invalid_frame_instant',
  'frame_instant_not_applicable',
  'transcript_text_required',
  'transcript_text_not_applicable',
  'annotation_not_found',
  'annotation_superseded',
  'no_annotations',
  'recording_changed',
  'submission_not_found',
  'invalid_proposal_kind',
  'invalid_proposal_ordinal',
  'annotations_required',
  'invalid_candidate_classification',
  'invalid_proposed_scope',
  'invalid_confidence',
  'incomplete_decision_card',
  'unsafe_or_invalid_rule',
  'insufficient_evidence_reason_required',
  'proposal_not_found',
  'invalid_decision',
  'stale_proposal_confirmation',
  'insufficient_evidence_not_confirmable',
  'derived_field_supplied',
] as const;

export type TrainingReviewRefusalReason = (typeof TRAINING_REVIEW_REFUSAL_REASONS)[number];

const REASONS: ReadonlySet<string> = new Set(TRAINING_REVIEW_REFUSAL_REASONS);

export function isTrainingReviewRefusalReason(value: unknown): value is TrainingReviewRefusalReason {
  return typeof value === 'string' && REASONS.has(value);
}

/**
 * The refusals that mean THE SURFACE COULD NOT ANSWER, as opposed to "you asked for
 * something we will not do".
 *
 * The backend answers these with 503 and a typed reason precisely so an unmigrated or
 * disabled server never looks like an empty record (`lib/review.ts`'s rule, again). A
 * Coach seeing "you have coached nothing" when coaching is switched off would be the
 * exact product lie the three-valued discipline exists to prevent.
 */
export const UNAVAILABLE_REASONS: readonly TrainingReviewRefusalReason[] = [
  'coaching_disabled', 'coaching_not_migrated', 'coaching_unavailable',
];

const UNAVAILABLE: ReadonlySet<string> = new Set(UNAVAILABLE_REASONS);

export function isUnavailableReason(value: unknown): boolean {
  return typeof value === 'string' && UNAVAILABLE.has(value);
}

/**
 * Coach-facing sentences for the refusals the Coach can actually do something about.
 *
 * DELIBERATELY PARTIAL. A reason absent here falls back to the server's own `error`
 * string, which is written for a person and is always more specific than a sentence
 * this repo could invent for a state it has never seen. Inventing copy for all 66
 * would be 66 chances to describe a server behaviour incorrectly.
 */
const SENTENCES: Partial<Record<TrainingReviewRefusalReason, string>> = {
  coaching_disabled: 'Coaching is not switched on for this server. Nothing was changed.',
  coaching_not_migrated: 'This server cannot store coaching yet. Nothing was changed.',
  coaching_unavailable: 'Implexa could not reach the coaching record just now. Nothing was changed.',
  invalid_idempotency_key: 'Implexa could not open this review safely. Nothing was changed.',
  idempotency_key_conflict: 'A different review was already opened with that key.',
  review_already_open: 'A review of this recording is already open.',
  review_closed: 'This review is closed. Nothing more can be added to it.',
  submission_frozen: 'This submission is frozen. Moments can no longer be added or replaced.',
  recording_changed: 'The recording changed after this review began. Re-register it before relying on anything marked in it.',
  annotation_superseded: 'That moment has already been replaced by a later one.',
  annotation_already_superseded: 'That moment has already been replaced by a later one.',
  annotation_outside_recording: 'That moment reaches past the end of this recording.',
  no_annotations: 'Mark at least one moment before freezing a submission.',
  consent_receipt_required: 'Implexa keeps an excerpt only with your recorded consent for that exact excerpt.',
  // The rule the card surface mirrors client-side. Stated in the same words in both
  // places so the pre-flight block and the server's refusal cannot describe different
  // rules to the same Coach.
  insufficient_evidence_not_confirmable:
    'The recording does not justify this, so it cannot be confirmed. Discard it instead.',
  stale_proposal_confirmation: 'This decision card changed since you were shown it. Read it again before confirming.',
  derived_field_supplied: 'Implexa tried to set something only the server may set. Nothing was changed.',
  capture_mode_not_enabled: 'Screen capture is not available here. Supply a recording you already have.',
  custody_binding_required: 'A demonstration must name the Mac and the local capability holding it.',
};

/**
 * What to show the Coach for one refusal.
 *
 * The server's `error` wins over a generic fallback but LOSES to a sentence pinned
 * above, because those few are the ones whose wording is a product promise rather than
 * a diagnostic.
 */
export function refusalSentence(reason: unknown, serverError?: string | null): string {
  if (isTrainingReviewRefusalReason(reason)) {
    const pinned = SENTENCES[reason];
    if (pinned) return pinned;
  }
  const fromServer = typeof serverError === 'string' ? serverError.trim() : '';
  if (fromServer) return fromServer;
  return 'The coaching service refused that. Nothing was changed.';
}
