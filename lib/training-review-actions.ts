/**
 * lib/training-review-actions.ts — the Training Review write-path allowlist.
 *
 * SPEC: §3.3 (Training Review is not Run Review), §3.4 (candidate compilation),
 * §5 F0 items 5 and 6.
 *
 * ── THIS FILE IS THE BACKEND SEAM ────────────────────────────────────────────────
 *
 * The backend F0 is being built in parallel and owns the real routes, payloads and
 * fixtures. Every upstream path and body shape the Dashboard will ever send lives in
 * the `resolveTrainingReviewAction` switch below and NOWHERE else, so re-pointing at
 * the final contract is an edit to this one file. `lib/training-review-client.ts` is
 * transport only; it never spells a backend path.
 *
 * Until the backend lands, `TRAINING_CONTRACT_VERSION` below is what this repo parses
 * against, and `test-fixtures/training-review-f0.v1.json` is the assumed wire text.
 * `npm run fixtures:training-review:check` FAILS LOUDLY rather than printing
 * "unverified" and exiting zero — an unverified provenance claim is worse than none.
 *
 * ── WHY A SECOND ALLOWLIST RATHER THAN MORE ACTIONS IN THE FIRST ─────────────────
 *
 * `lib/review-actions.ts` maps an action to exactly one RUN-review upstream. If the
 * training actions lived there, one mistyped case label or one shared helper would be
 * enough to write a `run_review_*` row for a demonstration — the conflation §3.3 and
 * §8 forbid. Here the two allowlists are disjoint by construction:
 *
 *   · every path this file can emit begins with `TRAINING_BASE`;
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

export type TrainingUpstream = { path: string; method: 'GET' | 'POST'; body?: unknown };

/**
 * The single prefix. Asserted in tests: no emitted path may fall outside it, so a
 * future edit cannot quietly reach `/api/v2/review/...` from this resolver.
 */
export const TRAINING_BASE = '/api/v2/agents/training';

/** What this repo parses against. Sent on every write so a contract skew is loud. */
export const TRAINING_CONTRACT_VERSION = 'agent-training-review.v1';

/** Backend bounds, mirrored so the browser refuses what the server would refuse. */
export const COACH_TEXT_MAX = 4000;
export const ANNOTATION_BATCH_MAX = 200;
/** A recording longer than this is out of contract for F0's supplied-recording slice. */
export const MAX_RANGE_MS = 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim() : null);
const SHA256_RE = /^[0-9a-f]{64}$/i;
const digest = (v: unknown): string | null => (typeof v === 'string' && SHA256_RE.test(v.trim()) ? v.trim().toLowerCase() : null);

function uuidList(value: unknown, min: number, max: number): string[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const values = value.map(id);
  if (values.some((entry) => !entry)) return null;
  const out = values as string[];
  return new Set(out.map((entry) => entry.toLowerCase())).size === out.length ? out : null;
}

/**
 * A bounded moment inside the supplied recording.
 *
 * `endMs === null` is a POINT, not a zero-length range — the same two-valued shape
 * `lib/review-anchor.ts` already uses for media feedback, so the Coach's marks read
 * the same way in both rooms. A range whose end is at or before its start is refused
 * rather than normalised: silently swapping them changes what the Coach marked.
 */
export type TemporalRange = { startMs: number; endMs: number | null };

export function parseTemporalRange(raw: unknown): TemporalRange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).sort().join('|') !== 'endMs|startMs') return null;
  const start = value.startMs;
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start > MAX_RANGE_MS) return null;
  if (value.endMs === null) return { startMs: Math.round(start), endMs: null };
  const end = value.endMs;
  if (typeof end !== 'number' || !Number.isFinite(end) || end <= start || end > MAX_RANGE_MS) return null;
  return { startMs: Math.round(start), endMs: Math.round(end) };
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length && trimmed.length <= COACH_TEXT_MAX ? trimmed : null;
};

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
    case 'ensure_training_session': {
      const trainingSessionId = id(b.trainingSessionId);
      const sourceId = id(b.sourceId);
      if (!trainingSessionId) return 'A valid trainingSessionId is required.';
      if (!sourceId) return 'A valid sourceId is required.';
      return {
        path: `${TRAINING_BASE}/sessions/${trainingSessionId}/review-sessions`, method: 'POST',
        body: { sourceId, contractVersion: TRAINING_CONTRACT_VERSION },
      };
    }
    case 'create_training_annotation': {
      const reviewSessionId = id(b.reviewSessionId);
      if (!reviewSessionId) return 'A valid reviewSessionId is required.';
      const sourceId = id(b.sourceId);
      if (!sourceId) return 'A valid sourceId is required.';
      const range = parseTemporalRange(b.temporalRange);
      if (!range) return 'A moment needs a start, and a range needs an end after its start.';
      const coachText = text(b.coachText);
      if (!coachText) return `Say what happened here, in 1–${COACH_TEXT_MAX} characters.`;
      const anchorDigest = digest(b.anchorDigest);
      if (!anchorDigest) return 'This moment is missing the recording digest it was marked against.';
      return {
        path: `${TRAINING_BASE}/review-sessions/${reviewSessionId}/annotations`, method: 'POST',
        body: {
          sourceId, temporalRange: range, coachText, anchorDigest,
          // Forwarded verbatim to the backend's typed validators. There is
          // deliberately no "any JSON is fine" shortcut on either side.
          spatialRegion: b.spatialRegion ?? null,
          transcriptSpan: b.transcriptSpan ?? null,
          contractVersion: TRAINING_CONTRACT_VERSION,
        },
      };
    }
    case 'amend_training_annotation': {
      const annotationId = id(b.annotationId);
      if (!annotationId) return 'A valid annotationId is required.';
      const coachText = text(b.coachText);
      if (!coachText) return `Say what happened here, in 1–${COACH_TEXT_MAX} characters.`;
      // APPEND-ONLY (§3.3). An amend does not rewrite the row; it asks the server to
      // write a successor that names what it supersedes. The client never claims the
      // new id — the server mints and freezes it.
      return {
        path: `${TRAINING_BASE}/review-annotations/${annotationId}/amend`, method: 'POST',
        body: {
          coachText,
          temporalRange: b.temporalRange === undefined ? null : parseTemporalRange(b.temporalRange),
          spatialRegion: b.spatialRegion ?? null,
          transcriptSpan: b.transcriptSpan ?? null,
          contractVersion: TRAINING_CONTRACT_VERSION,
        },
      };
    }
    case 'discard_training_annotation': {
      const annotationId = id(b.annotationId);
      if (!annotationId) return 'A valid annotationId is required.';
      return {
        path: `${TRAINING_BASE}/review-annotations/${annotationId}/discard`, method: 'POST',
        body: { contractVersion: TRAINING_CONTRACT_VERSION },
      };
    }
    case 'attach_training_evidence': {
      const annotationId = id(b.annotationId);
      if (!annotationId) return 'A valid annotationId is required.';
      const mediaDigest = digest(b.mediaSha256);
      if (!mediaDigest) return 'Selected evidence must name the recording digest it came from.';
      const range = parseTemporalRange(b.temporalRange);
      if (!range) return 'Selected evidence must name the bounded moment it contains.';
      const kind = b.kind;
      if (kind !== 'clip' && kind !== 'frame' && kind !== 'transcript') {
        return 'Evidence must be a clip, a frame, or a transcript span.';
      }
      // §2.4 / §4.2: a DESCRIPTOR travels, never the recording and never a path.
      // `localOnly` is the honest default — F0 uploads nothing.
      return {
        path: `${TRAINING_BASE}/review-annotations/${annotationId}/evidence`, method: 'POST',
        body: {
          kind, mediaSha256: mediaDigest, temporalRange: range,
          custody: 'local_only', contractVersion: TRAINING_CONTRACT_VERSION,
        },
      };
    }
    case 'submit_training_annotations': {
      const reviewSessionId = id(b.reviewSessionId);
      if (!reviewSessionId) return 'A valid reviewSessionId is required.';
      const annotationIds = uuidList(b.annotationIds, 1, ANNOTATION_BATCH_MAX);
      if (!annotationIds) return `Submit between 1 and ${ANNOTATION_BATCH_MAX} distinct moments.`;
      const recordingDigest = digest(b.recordingDigest);
      if (!recordingDigest) return 'The submission must name the recording digest it froze.';
      return {
        path: `${TRAINING_BASE}/review-sessions/${reviewSessionId}/submissions`, method: 'POST',
        body: { annotationIds, recordingDigest, contractVersion: TRAINING_CONTRACT_VERSION },
      };
    }
    case 'confirm_training_decision': {
      const submissionId = id(b.submissionId);
      const decisionId = id(b.decisionId);
      if (!submissionId) return 'A valid submissionId is required.';
      if (!decisionId) return 'A valid decisionId is required.';
      const disposition = b.disposition;
      if (disposition !== 'accepted' && disposition !== 'edited'
          && disposition !== 'merged' && disposition !== 'discarded') {
        return 'A decision is accepted, edited, merged, or discarded.';
      }
      const mergedInto = disposition === 'merged' ? id(b.mergedIntoDecisionId) : null;
      if (disposition === 'merged' && !mergedInto) return 'A merge must name the decision it merges into.';
      // NOTHING HERE ACTIVATES (§5 F0 must-nots). Confirming mints or links an INERT
      // canonical learning candidate; the promotion authority is a separate, later,
      // explicit act, and this resolver has no path that could request it.
      return {
        path: `${TRAINING_BASE}/submissions/${submissionId}/decisions/${decisionId}/confirm`, method: 'POST',
        body: {
          disposition,
          mergedIntoDecisionId: mergedInto,
          edits: disposition === 'edited' ? (b.edits ?? null) : null,
          activate: false,
          contractVersion: TRAINING_CONTRACT_VERSION,
        },
      };
    }
    case 'read_training_projection': {
      const trainingSessionId = id(b.trainingSessionId);
      const sourceId = id(b.sourceId);
      if (!trainingSessionId) return 'A valid trainingSessionId is required.';
      if (!sourceId) return 'A valid sourceId is required.';
      return {
        path: `${TRAINING_BASE}/sessions/${trainingSessionId}/projection?sourceId=${sourceId}`,
        method: 'GET',
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
