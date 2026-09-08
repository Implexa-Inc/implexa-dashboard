/**
 * lib/training-review-projection.ts — the read-only training record (F0 item 8).
 *
 * SPEC §5 F0 item 8: "A read-only projection showing source, evidence, decisions, and
 * current authority state."
 *
 * ── THE ONE RULE INHERITED FROM `lib/review.ts` ──────────────────────────────────
 *
 * UNAVAILABLE IS NOT EMPTY. A failed read returns `live: false` with a reason, never
 * an empty projection that renders as a calm "nothing here yet". The backend goes to
 * real trouble to keep facts three-valued (see `training-review-lifecycle.ts`), and
 * all of it is undone by a client that degrades to silence.
 *
 * ── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────────────
 *
 * No local filesystem path, in any field, ever (§4.2: "Raw local paths never enter
 * Dashboard or backend records"; §6.1 pass condition: "no path exposed to the
 * browser"). The source is identified by digest, size, duration and a machine LABEL —
 * and `parseSource` drops anything path-shaped rather than rendering it, so a backend
 * that starts leaking one does not leak it through this surface.
 */

import { parseDecisionCards, type CoachDecisionCard } from './coach-decision-cards.ts';
import {
  parseAuthorityState, unknownAuthorityState, type AuthorityState,
} from './training-review-lifecycle.ts';
import { parseTemporalRange, type TemporalRange } from './training-review-actions.ts';

/** §3.2 typed source envelope, demonstration arm — the fields a browser may see. */
export type TrainingSourceSummary = {
  readonly id: string;
  readonly sourceKind: 'owner_demonstration' | 'prior_run';
  readonly mediaSha256: string;
  readonly sizeBytes: number | null;
  readonly mediaType: string | null;
  readonly durationMs: number | null;
  readonly suppliedAt: string | null;
  readonly captureMode: 'supplied' | 'native_capture' | null;
  /** A human label for the Mac, never a machine id that identifies a person. */
  readonly machineLabel: string | null;
  readonly baseVersionId: string | null;
  readonly custody: 'local_only' | 'evidence_selected';
};

export type TrainingEvidenceSummary = {
  readonly id: string;
  readonly annotationId: string;
  readonly kind: 'clip' | 'frame' | 'transcript';
  readonly temporalRange: TemporalRange | null;
  readonly mediaSha256: string;
  readonly custody: 'local_only' | 'uploaded';
  readonly revoked: boolean;
};

export type TrainingSubmissionSummary = {
  readonly id: string;
  readonly digest: string;
  readonly createdAt: string | null;
  readonly annotationCount: number | null;
};

export type TrainingProjection = {
  readonly source: TrainingSourceSummary | null;
  readonly evidence: readonly TrainingEvidenceSummary[];
  readonly decisions: readonly CoachDecisionCard[];
  readonly authorityState: AuthorityState;
  readonly submission: TrainingSubmissionSummary | null;
  /** True when the payload named a contract version this repo does not parse. */
  readonly contractSkew: string | null;
};

export type TrainingProjectionStatus =
  | { readonly live: true; readonly projection: TrainingProjection }
  | { readonly live: false; readonly reason: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim() : null);
const sha = (v: unknown): string | null => (typeof v === 'string' && SHA256_RE.test(v.trim()) ? v.trim().toLowerCase() : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

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

const safeLabel = (v: unknown): string | null => {
  const value = str(v);
  return value && !looksLikePath(value) ? value : null;
};

function parseSource(raw: unknown): TrainingSourceSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = uuid(value.id);
  const mediaSha256 = sha(value.mediaSha256);
  const kind = value.sourceKind;
  if (!id || !mediaSha256) return null;
  if (kind !== 'owner_demonstration' && kind !== 'prior_run') return null;
  const captureMode = value.captureMode === 'supplied' || value.captureMode === 'native_capture'
    ? value.captureMode : null;
  return {
    id,
    sourceKind: kind,
    mediaSha256,
    sizeBytes: num(value.sizeBytes),
    mediaType: str(value.mediaType),
    durationMs: num(value.durationMs),
    suppliedAt: str(value.suppliedAt),
    captureMode,
    machineLabel: safeLabel(value.machineLabel),
    baseVersionId: uuid(value.baseVersionId),
    // Default to the STRONGER claim about the customer's data being local, and
    // upgrade only when the server says evidence was selected. Defaulting the other
    // way would show "evidence selected" for a record we simply could not read.
    custody: value.custody === 'evidence_selected' ? 'evidence_selected' : 'local_only',
  };
}

function parseEvidence(raw: unknown): readonly TrainingEvidenceSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: TrainingEvidenceSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    const id = uuid(value.id); const annotationId = uuid(value.annotationId);
    const mediaSha256 = sha(value.mediaSha256);
    const kind = value.kind;
    if (!id || !annotationId || !mediaSha256) continue;
    if (kind !== 'clip' && kind !== 'frame' && kind !== 'transcript') continue;
    out.push({
      id, annotationId, kind, mediaSha256,
      temporalRange: parseTemporalRange(value.temporalRange),
      custody: value.custody === 'uploaded' ? 'uploaded' : 'local_only',
      revoked: value.revoked === true,
    });
  }
  return out;
}

function parseSubmission(raw: unknown): TrainingSubmissionSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = uuid(value.id); const digest = sha(value.digest);
  if (!id || !digest) return null;
  return { id, digest, createdAt: str(value.createdAt), annotationCount: num(value.annotationCount) };
}

/**
 * Parse a `/api/training-review` projection response.
 *
 * `expectedContractVersion` is compared but does NOT refuse the payload: a skew is
 * reported so the surface can say the record may be incomplete, which is more useful
 * than a blank screen the moment the backend ships v2.
 */
export function parseTrainingProjection(
  raw: unknown, expectedContractVersion: string,
): TrainingProjectionStatus {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { live: false, reason: 'unreadable' };
  }
  const body = raw as Record<string, unknown>;
  if (body.ok !== true) {
    return { live: false, reason: typeof body.error === 'string' && body.error.trim() ? body.error.trim() : 'refused' };
  }
  const raw_projection = body.projection;
  if (!raw_projection || typeof raw_projection !== 'object' || Array.isArray(raw_projection)) {
    return { live: false, reason: 'unreadable' };
  }
  const projection = raw_projection as Record<string, unknown>;
  const named = str(body.contractVersion);
  return {
    live: true,
    projection: {
      source: parseSource(projection.source),
      evidence: parseEvidence(projection.evidence),
      decisions: parseDecisionCards(projection.decisions),
      // A projection with no `authorityState` is all-UNKNOWN, not all-no. A default
      // of `no` here would render a confident "Not activated" for a record whose
      // activation we never read — the §1.3 collapse arriving through a default.
      authorityState: projection.authorityState === undefined
        ? unknownAuthorityState() : parseAuthorityState(projection.authorityState),
      submission: parseSubmission(projection.submission),
      contractSkew: named && named !== expectedContractVersion ? named : null,
    },
  };
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
