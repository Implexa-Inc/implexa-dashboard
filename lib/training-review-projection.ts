/**
 * lib/training-review-projection.ts — the read-only training record (F0 item 8).
 *
 * SPEC §5 F0 item 8: "A read-only projection showing source, evidence, decisions, and
 * current authority state."
 *
 * ── THE BACKEND'S SHAPE, NOT OURS ────────────────────────────────────────────────
 *
 * `GET /api/v2/agent-coach/reviews/:reviewSessionId` answers `{ ok, review }` where
 * `review` is exactly what `projectTrainingReview` returns:
 *
 *   { projectionVersion, contractVersion, reviewSessionId, trainingSessionId, agent,
 *     subject, status, statusReason, terminal, source, annotations[],
 *     liveAnnotationCount, submission, proposals[], learning, createdAt, updatedAt,
 *     terminalAt, permittedActions[] }
 *
 * The Dashboard DERIVES NOTHING the server states: not which moments are live, not
 * whether a recording is still the one that was reviewed, not which actions are
 * permitted, and above all not whether anything here has taught the Agent anything.
 * Recomputing any of those would make this file a second authority that drifts.
 *
 * ── THE ONE RULE INHERITED FROM `lib/review.ts` ──────────────────────────────────
 *
 * UNAVAILABLE IS NOT EMPTY. A failed read returns `live: false` with a reason, never
 * an empty projection that renders as a calm "nothing here yet". The backend goes to
 * real trouble to keep facts three-valued, and all of it is undone by a client that
 * degrades to silence.
 *
 * ── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────────────
 *
 * No local filesystem path, in any field, ever (§4.2: "Raw local paths never enter
 * Dashboard or backend records"; §6.1 pass condition: "no path exposed to the
 * browser"). The backend refuses to emit one; `dropIfPathLike` here refuses to render
 * one, so a backend that starts leaking one does not leak it through this surface.
 */

import { parseDecisionCards, type CoachDecisionCard } from './coach-decision-cards.ts';
import {
  deriveAuthorityState, type AuthorityState,
} from './training-review-lifecycle.ts';

/** Backend `REVIEW_STATUSES`. */
export type ReviewStatus = 'open' | 'submitted' | 'abandoned';
/** Backend `SOURCE_INTEGRITY`. */
export type SourceIntegrity = 'verified' | 'stale';
/** Backend `ANNOTATION_STATUSES`. */
export type AnnotationStatus = 'active' | 'superseded' | 'withdrawn';
/** Backend `EVIDENCE_KINDS`. */
export type EvidenceKind = 'clip' | 'frame' | 'transcript_span';

/**
 * The actions the SERVER says are available, verbatim.
 *
 * Rendered as the gate on every control. A client that computed its own list would
 * eventually offer a button the server refuses — and a control that fails when pressed
 * is worse than one that was never shown.
 */
export type PermittedAction =
  | 'add_moment' | 'supersede_moment' | 'attach_evidence'
  | 'freeze_submission' | 'confirm_decisions' | 'abandon_review';

const PERMITTED: ReadonlySet<string> = new Set<PermittedAction>([
  'add_moment', 'supersede_moment', 'attach_evidence',
  'freeze_submission', 'confirm_decisions', 'abandon_review',
]);

/** §3.2 typed source envelope, demonstration arm — the fields a browser may see. */
export type TrainingSourceSummary = {
  readonly sourceId: string;
  readonly kind: string;
  readonly role: string;
  readonly evidenceAuthority: string | null;
  readonly captureMode: string | null;
  readonly mediaType: string | null;
  readonly sizeBytes: number | null;
  readonly recordingDigest: string;
  readonly recordingDurationMs: number | null;
  readonly divergenceRunId: string | null;
  readonly integrity: SourceIntegrity;
  /** The server's own words when the recording changed under the review. */
  readonly integrityNote: string | null;
  readonly custodyNote: string | null;
  readonly suppliedAt: string | null;
};

export type TrainingEvidenceSummary = {
  readonly evidenceId: string;
  readonly annotationId: string;
  readonly kind: EvidenceKind;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly frameAtMs: number | null;
  readonly mediaType: string | null;
  readonly sizeBytes: number | null;
  readonly transcriptText: string | null;
  /** Only ever `local_only` in this contract. Read, never assumed. */
  readonly custodyState: string;
  readonly custodyNote: string | null;
  readonly consentReceiptDigest: string;
  readonly revocationState: string;
  readonly revokedAt: string | null;
  readonly evidenceDigest: string | null;
};

export type TrainingAnnotationSummary = {
  readonly annotationId: string;
  readonly ordinal: number;
  readonly status: AnnotationStatus;
  /** SERVER-STATED. A superseded moment is still returned, and still readable. */
  readonly live: boolean;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly region: { x: number; y: number; w: number; h: number } | null;
  readonly transcriptStartMs: number | null;
  readonly transcriptEndMs: number | null;
  readonly transcriptText: string | null;
  readonly coachText: string;
  readonly rationale: string | null;
  readonly anchorDigest: string | null;
  readonly supersedesAnnotationId: string | null;
  readonly evidence: readonly TrainingEvidenceSummary[];
  readonly createdAt: string | null;
};

export type TrainingSubmissionSummary = {
  readonly submissionId: string;
  readonly submissionDigest: string;
  readonly annotationCount: number | null;
  readonly recordingDigest: string | null;
  readonly frozen: boolean;
  readonly createdAt: string | null;
};

/**
 * The learning count, STATED by the server, never inferred here.
 *
 * In F0 this is always zero and says so in words. It is parsed rather than assumed
 * because a surface that hard-coded "0" would keep saying zero on the day the number
 * stops being zero.
 */
export type TrainingLearningSummary = {
  readonly activatedCount: number;
  readonly versionsCreated: number;
  readonly note: string | null;
};

export type TrainingReview = {
  readonly projectionVersion: string | null;
  readonly contractVersion: string | null;
  readonly reviewSessionId: string;
  readonly trainingSessionId: string;
  readonly subject: { readonly kind: 'training_source'; readonly trainingSessionId: string; readonly sourceId: string } | null;
  readonly status: ReviewStatus;
  readonly statusReason: string | null;
  readonly terminal: boolean;
  readonly source: TrainingSourceSummary | null;
  readonly annotations: readonly TrainingAnnotationSummary[];
  readonly liveAnnotationCount: number | null;
  readonly submission: TrainingSubmissionSummary | null;
  readonly decisions: readonly CoachDecisionCard[];
  readonly learning: TrainingLearningSummary | null;
  readonly permittedActions: readonly PermittedAction[];
  readonly authorityState: AuthorityState;
  /** True when the payload named a version this repo does not parse. */
  readonly contractSkew: string | null;
};

export type TrainingReviewStatus =
  | { readonly live: true; readonly review: TrainingReview }
  | { readonly live: false; readonly reason: string; readonly unavailable: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim() : null);
const sha = (v: unknown): string | null => (typeof v === 'string' && SHA256_RE.test(v.trim()) ? v.trim().toLowerCase() : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);

/**
 * Anything that looks like a filesystem path is refused, not rendered.
 *
 * The check is deliberately blunt — a leading `/`, a Windows drive letter, a `~/`,
 * or a `file:` URL. A label the customer typed can contain a slash; a label that
 * STARTS like a path is far more likely to be a leak than a name, and dropping it
 * costs a label while rendering it costs the §6.1 guarantee.
 */
export function looksLikePath(value: string): boolean {
  return /^(?:\/|~\/|[A-Za-z]:[\\/]|file:)/.test(value.trim());
}

const dropIfPathLike = (v: unknown): string | null => {
  const value = str(v);
  return value && !looksLikePath(value) ? value : null;
};

function parseRegion(raw: unknown): { x: number; y: number; w: number; h: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const nums = ['x', 'y', 'w', 'h'].map((key) => value[key]);
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const [x, y, w, h] = nums as number[];
  return { x, y, w, h };
}

const EVIDENCE_KINDS: ReadonlySet<string> = new Set<EvidenceKind>(['clip', 'frame', 'transcript_span']);

function parseEvidence(annotationId: string, raw: unknown): readonly TrainingEvidenceSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: TrainingEvidenceSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    const evidenceId = uuid(value.evidenceId);
    const kind = value.kind;
    const startsAtMs = int(value.startsAtMs); const endsAtMs = int(value.endsAtMs);
    const consentReceiptDigest = sha(value.consentReceiptDigest);
    if (!evidenceId || typeof kind !== 'string' || !EVIDENCE_KINDS.has(kind)) continue;
    if (startsAtMs === null || endsAtMs === null) continue;
    // CONSENT IS NOT OPTIONAL. An excerpt whose receipt we cannot read is DROPPED
    // rather than rendered as kept — showing it would present an unconsented excerpt
    // with the same standing as a consented one.
    if (!consentReceiptDigest) continue;
    out.push({
      evidenceId,
      annotationId,
      kind: kind as EvidenceKind,
      startsAtMs,
      endsAtMs,
      frameAtMs: int(value.frameAtMs),
      mediaType: str(value.mediaType),
      sizeBytes: int(value.sizeBytes),
      transcriptText: dropIfPathLike(value.transcriptText),
      // Default to the STRONGER claim about the customer's data being local, and
      // upgrade only when the server names another custody. Defaulting the other way
      // would show "uploaded" for a record we simply could not read.
      custodyState: str(value.custodyState) ?? 'local_only',
      custodyNote: str(value.custodyNote),
      consentReceiptDigest,
      revocationState: str(value.revocationState) ?? 'active',
      revokedAt: str(value.revokedAt),
      evidenceDigest: sha(value.evidenceDigest),
    });
  }
  return out;
}

const ANNOTATION_STATUSES: ReadonlySet<string> = new Set<AnnotationStatus>([
  'active', 'superseded', 'withdrawn',
]);

function parseAnnotations(raw: unknown): readonly TrainingAnnotationSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: TrainingAnnotationSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    const annotationId = uuid(value.annotationId);
    const ordinal = int(value.ordinal);
    const startsAtMs = int(value.startsAtMs); const endsAtMs = int(value.endsAtMs);
    const coachText = dropIfPathLike(value.coachText);
    const status = value.status;
    if (!annotationId || ordinal === null || startsAtMs === null || endsAtMs === null) continue;
    if (typeof status !== 'string' || !ANNOTATION_STATUSES.has(status)) continue;
    // THE COACH'S OWN WORDS ARE THE AUTHORITY. A moment without them would render as a
    // marked range with a transcript beside it, and the transcript would read as the
    // teaching. It is evidence, not authority.
    if (!coachText) continue;
    out.push({
      annotationId,
      ordinal,
      status: status as AnnotationStatus,
      // SERVER-STATED, not derived from `status`. The two agree today; deriving one
      // from the other is how they stop agreeing silently.
      live: value.live === true,
      startsAtMs,
      endsAtMs,
      region: parseRegion(value.region),
      transcriptStartMs: int(value.transcriptStartMs),
      transcriptEndMs: int(value.transcriptEndMs),
      transcriptText: dropIfPathLike(value.transcriptText),
      coachText,
      rationale: dropIfPathLike(value.rationale),
      anchorDigest: sha(value.anchorDigest),
      supersedesAnnotationId: uuid(value.supersedesAnnotationId),
      evidence: parseEvidence(annotationId, value.evidence),
      createdAt: str(value.createdAt),
    });
  }
  return out;
}

function parseSource(raw: unknown): TrainingSourceSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const sourceId = uuid(value.sourceId);
  const recordingDigest = sha(value.recordingDigest);
  const integrity = value.integrity;
  if (!sourceId || !recordingDigest) return null;
  if (integrity !== 'verified' && integrity !== 'stale') return null;
  const kind = str(value.kind); const role = str(value.role);
  if (!kind || !role) return null;
  return {
    sourceId,
    kind,
    role,
    evidenceAuthority: str(value.evidenceAuthority),
    captureMode: str(value.captureMode),
    mediaType: str(value.mediaType),
    sizeBytes: int(value.sizeBytes),
    recordingDigest,
    recordingDurationMs: int(value.recordingDurationMs),
    divergenceRunId: uuid(value.divergenceRunId),
    integrity,
    integrityNote: dropIfPathLike(value.integrityNote),
    custodyNote: dropIfPathLike(value.custodyNote),
    suppliedAt: str(value.suppliedAt),
  };
}

function parseSubmission(raw: unknown): TrainingSubmissionSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const submissionId = uuid(value.submissionId);
  const submissionDigest = sha(value.submissionDigest);
  if (!submissionId || !submissionDigest) return null;
  return {
    submissionId,
    submissionDigest,
    annotationCount: int(value.annotationCount),
    recordingDigest: sha(value.recordingDigest),
    // A submission this contract returns IS frozen. Read rather than assumed, so a
    // later contract that can return an unfrozen one does not render it as final.
    frozen: value.frozen === true,
    createdAt: str(value.createdAt),
  };
}

/**
 * The learning claim.
 *
 * Returns null when the payload does not state one, which propagates to an UNKNOWN
 * activation fact. A default of "zero activated" here would render a confident
 * "nothing changed" for a record whose learning we never read — the §1.3 collapse
 * arriving through a default.
 */
function parseLearning(raw: unknown): TrainingLearningSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const activatedCount = int(value.activatedCount);
  const versionsCreated = int(value.versionsCreated);
  if (activatedCount === null || versionsCreated === null) return null;
  return { activatedCount, versionsCreated, note: dropIfPathLike(value.note) };
}

function parsePermittedActions(raw: unknown): readonly PermittedAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PermittedAction[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && PERMITTED.has(entry) && !out.includes(entry as PermittedAction)) {
      out.push(entry as PermittedAction);
    }
  }
  return out;
}

function parseSubject(raw: unknown, trainingSessionId: string): TrainingReview['subject'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.kind !== 'training_source') return null;
  const session = uuid(value.trainingSessionId); const sourceId = uuid(value.sourceId);
  if (!session || !sourceId) return null;
  // A subject naming a different session than the review it arrived on is a conflation,
  // not a detail. It is refused rather than resolved by precedence (§3.2).
  if (session !== trainingSessionId) return null;
  return { kind: 'training_source', trainingSessionId: session, sourceId };
}

const REVIEW_STATUSES: ReadonlySet<string> = new Set<ReviewStatus>(['open', 'submitted', 'abandoned']);

export type ExpectedVersions = {
  readonly projectionVersion: string;
  readonly contractVersion: string;
};

/**
 * Parse a `GET /api/v2/agent-coach/reviews/:id` response.
 *
 * The expected versions are compared but do NOT refuse the payload: a skew is reported
 * so the surface can say the record may be incomplete, which is more useful than a
 * blank screen the moment the backend ships v2.
 */
export function parseTrainingReview(raw: unknown, expected: ExpectedVersions): TrainingReviewStatus {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { live: false, reason: 'unreadable', unavailable: true };
  }
  const body = raw as Record<string, unknown>;
  if (body.ok !== true) {
    const reason = str(body.reason) ?? str(body.error) ?? 'refused';
    // The backend flags a projection it refused to BUILD as `unavailable`. That is a
    // different state from "you asked for a review that does not exist", and the two
    // must not render the same way.
    return { live: false, reason, unavailable: body.unavailable === true };
  }
  const rawReview = body.review;
  if (!rawReview || typeof rawReview !== 'object' || Array.isArray(rawReview)) {
    return { live: false, reason: 'unreadable', unavailable: true };
  }
  const review = rawReview as Record<string, unknown>;
  const reviewSessionId = uuid(review.reviewSessionId);
  const trainingSessionId = uuid(review.trainingSessionId);
  const status = review.status;
  if (!reviewSessionId || !trainingSessionId) {
    return { live: false, reason: 'unreadable', unavailable: true };
  }
  if (typeof status !== 'string' || !REVIEW_STATUSES.has(status)) {
    return { live: false, reason: 'unreadable', unavailable: true };
  }

  const projectionVersion = str(review.projectionVersion);
  const contractVersion = str(review.contractVersion);
  const skew = [
    projectionVersion && projectionVersion !== expected.projectionVersion ? projectionVersion : null,
    contractVersion && contractVersion !== expected.contractVersion ? contractVersion : null,
  ].filter(Boolean).join(', ');

  const source = parseSource(review.source);
  const learning = parseLearning(review.learning);
  const decisions = parseDecisionCards(review.proposals);

  return {
    live: true,
    review: {
      projectionVersion,
      contractVersion,
      reviewSessionId,
      trainingSessionId,
      subject: parseSubject(review.subject, trainingSessionId),
      status: status as ReviewStatus,
      statusReason: dropIfPathLike(review.statusReason),
      // SERVER-STATED. Deriving terminality from `status` here would be a second
      // opinion about whether this review is closed.
      terminal: review.terminal === true,
      source,
      annotations: parseAnnotations(review.annotations),
      liveAnnotationCount: int(review.liveAnnotationCount),
      submission: parseSubmission(review.submission),
      decisions,
      learning,
      permittedActions: parsePermittedActions(review.permittedActions),
      authorityState: deriveAuthorityState({ source, learning, decisions }),
      contractSkew: skew || null,
    },
  };
}

/** Every kept excerpt on this review, flattened, each still naming its moment. */
export function keptEvidence(review: TrainingReview): readonly TrainingEvidenceSummary[] {
  return review.annotations.flatMap((annotation) => annotation.evidence)
    .filter((entry) => entry.revocationState !== 'revoked');
}

/** Bytes, in the register the rest of the app uses. */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
