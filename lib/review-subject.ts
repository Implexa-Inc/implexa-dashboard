/**
 * lib/review-subject.ts — the typed Review subject, and the write path it selects.
 *
 * SPEC: UNIVERSAL_AGENT_COACH_RECORD_REVIEW_SPEC_2026-09-07 §3.3.
 *
 * ── THE FAILURE THIS FILE IS DESIGNED AGAINST ────────────────────────────────────
 *
 * `<ReviewRoom />` is deeply run-bound: `runId` is a required prop, it flows straight
 * into `reviewAction({ action: 'ensure_session', runId, artifactId })`, into
 * `create_issue`, `amend_*`, `continue_*`, into `requestPreview(runId, artifactId)`
 * and into `href={`/runs/${runId}`}`. The obvious way to make it "also do training"
 * is to add `trainingSessionId?: string` and make `runId` optional. That change type-
 * checks. It also still writes `run_review_*` rows for a demonstration — which §3.3
 * and §8 forbid outright ("No synthetic run created solely to make run-bound Review
 * tables accept training").
 *
 * So the discriminant does not select a PROP. It selects a WRITE PATH, and the two
 * write paths are disjoint all the way down to the server:
 *
 *   { kind: 'run_artifact' }     -> POST /api/review          -> resolveReviewAction
 *                                   -> /api/v2/review/runs|sessions/...
 *   { kind: 'training_source' }  -> POST /api/training-review -> resolveTrainingReviewAction
 *                                   -> /api/v2/agents/training/...
 *
 * There is no function anywhere that turns a `training_source` subject into a run id
 * or an artifact id, because the training arm never carries those fields. There is no
 * action name shared between the two allowlists. And each server allowlist REFUSES
 * the other's action names by name (see `lib/training-review-actions.ts` and the
 * cross-refusal tests). A training subject is therefore structurally incapable of
 * producing a run-review write: not merely "not wired to", but with no reachable
 * expression that would produce one.
 *
 * PURE ON PURPOSE, like the rest of `lib/review-*`: no `fetch`, no `next/*`, so every
 * branch below is executable in a test rather than asserted by reading JSX.
 */

export type UUID = string;

/** §3.3, verbatim. */
export type RunArtifactSubject = {
  readonly kind: 'run_artifact';
  readonly runId: UUID;
  readonly artifactId: UUID;
};

export type TrainingSourceSubject = {
  readonly kind: 'training_source';
  readonly trainingSessionId: UUID;
  readonly sourceId: UUID;
};

export type ReviewSubject = RunArtifactSubject | TrainingSourceSubject;
export type ReviewSubjectKind = ReviewSubject['kind'];

/**
 * The authority a write belongs to. Run Review writes only run-review records;
 * Training Review writes only training-review records (§3.3). These strings are
 * carried on every sealed envelope so a mis-routed write is refused at runtime as
 * well as rejected at compile time.
 */
export type ReviewWriteAuthority = 'run_review' | 'training_review';

/**
 * Exhaustiveness sentinel.
 *
 * A new `ReviewSubject` arm makes every `switch` that omits it fail to compile here,
 * because `value` is no longer assignable to `never`. That is the compile-time half
 * of the guarantee; the throw is the runtime half, for data that reached us from the
 * network and lied about its shape.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: unhandled review subject ${JSON.stringify(value)}`);
}

// ── Write paths ───────────────────────────────────────────────────────────────────

export type RunReviewWritePath = {
  readonly authority: 'run_review';
  readonly route: '/api/review';
  readonly subject: RunArtifactSubject;
};

export type TrainingReviewWritePath = {
  readonly authority: 'training_review';
  readonly route: '/api/training-review';
  readonly subject: TrainingSourceSubject;
};

export type ReviewWritePath = RunReviewWritePath | TrainingReviewWritePath;

/**
 * The mapped return type is what makes the adapter safe at the CALL SITE, not only
 * inside the switch: `writePathFor(trainingSubject)` is statically a
 * `TrainingReviewWritePath`, whose `.subject` has no `runId` field to read.
 */
export type WritePathFor<K extends ReviewSubjectKind> =
  K extends 'run_artifact' ? RunReviewWritePath
  : K extends 'training_source' ? TrainingReviewWritePath
  : never;

export function writePathFor<S extends ReviewSubject>(subject: S): WritePathFor<S['kind']> {
  switch (subject.kind) {
    case 'run_artifact':
      return { authority: 'run_review', route: '/api/review', subject } as WritePathFor<S['kind']>;
    case 'training_source':
      return { authority: 'training_review', route: '/api/training-review', subject } as WritePathFor<S['kind']>;
    default:
      return assertNever(subject, 'writePathFor');
  }
}

// ── Action namespaces ─────────────────────────────────────────────────────────────

/**
 * The run-review action names, as the dashboard route already accepts them
 * (`lib/review-actions.ts`). Listed here ONLY so the training allowlist can refuse
 * them by name and prove the two namespaces are disjoint. Nothing in this file calls
 * them.
 */
export const RUN_REVIEW_ACTIONS = [
  'ensure_session', 'create_issue', 'dismiss_issue', 'resolve_issues', 'accept',
  'submit', 'request_evidence', 'evidence_status', 'continuation_status',
  'amend_failed_revision', 'apply_pattern', 'synthesize_pattern',
] as const;
export type RunReviewAction = (typeof RUN_REVIEW_ACTIONS)[number];

/**
 * Training-review actions. DELIBERATELY DISJOINT from the run-review names above —
 * not `ensure_session` but `ensure_training_session` — so that a copy-pasted action
 * string cannot silently land in the other authority, and so that a grep for a run
 * action never matches a training call site.
 */
export const TRAINING_REVIEW_ACTIONS = [
  'ensure_training_session',
  'create_training_annotation',
  'amend_training_annotation',
  'discard_training_annotation',
  'attach_training_evidence',
  'submit_training_annotations',
  'confirm_training_decision',
  'read_training_projection',
] as const;
export type TrainingReviewAction = (typeof TRAINING_REVIEW_ACTIONS)[number];

const RUN_SET: ReadonlySet<string> = new Set(RUN_REVIEW_ACTIONS);
const TRAINING_SET: ReadonlySet<string> = new Set(TRAINING_REVIEW_ACTIONS);

export const isRunReviewAction = (action: string): action is RunReviewAction => RUN_SET.has(action);
export const isTrainingReviewAction = (action: string): action is TrainingReviewAction => TRAINING_SET.has(action);

// ── Sealed envelopes ──────────────────────────────────────────────────────────────

export type ReviewWriteEnvelope<A extends ReviewWriteAuthority> = {
  readonly authority: A;
  readonly route: string;
  readonly action: A extends 'run_review' ? RunReviewAction : TrainingReviewAction;
  readonly payload: Readonly<Record<string, unknown>>;
};

export type TrainingReviewWrite = ReviewWriteEnvelope<'training_review'>;
export type RunReviewWrite = ReviewWriteEnvelope<'run_review'>;

/**
 * Seal a write against its path.
 *
 * The overloads mean a `TrainingReviewWritePath` accepts only training action names
 * at compile time. The runtime check exists for the same reason `parseReviewSubject`
 * exists: an action name can arrive as a `string` from data, and a cast (`as any`) is
 * the exact move a future bug will make. Sealing throws rather than returning a
 * refusal because there is no honest UI for "we tried to write the wrong authority" —
 * it is a programming error, not a user-visible state.
 */
export function sealWrite(
  path: TrainingReviewWritePath, action: TrainingReviewAction, payload?: Record<string, unknown>,
): TrainingReviewWrite;
export function sealWrite(
  path: RunReviewWritePath, action: RunReviewAction, payload?: Record<string, unknown>,
): RunReviewWrite;
export function sealWrite(
  path: ReviewWritePath, action: string, payload: Record<string, unknown> = {},
): ReviewWriteEnvelope<ReviewWriteAuthority> {
  switch (path.authority) {
    case 'run_review': {
      if (!isRunReviewAction(action)) {
        throw new Error(`sealWrite: ${JSON.stringify(action)} is not a run-review action.`);
      }
      return Object.freeze({
        authority: 'run_review' as const, route: path.route, action,
        payload: Object.freeze({ ...payload, runId: path.subject.runId }),
      });
    }
    case 'training_review': {
      if (!isTrainingReviewAction(action)) {
        throw new Error(`sealWrite: ${JSON.stringify(action)} is not a training-review action.`);
      }
      // The training envelope carries the TRAINING identity and nothing else. There
      // is no `runId` to put here — the subject does not have one — which is why a
      // demonstration cannot address a run-review row even by forgery from this side.
      return Object.freeze({
        authority: 'training_review' as const, route: path.route, action,
        payload: Object.freeze({
          ...payload,
          trainingSessionId: path.subject.trainingSessionId,
          sourceId: path.subject.sourceId,
        }),
      });
    }
    default:
      return assertNever(path, 'sealWrite');
  }
}

// ── Parsing untrusted subjects ────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim() : null);

/**
 * Parse a subject that came from a URL, a link, or a server payload.
 *
 * A HALF-FORMED SUBJECT IS REFUSED, NOT REPAIRED (§3.2: "A malformed half-run/half-
 * demonstration source must be impossible"). An object carrying both a `runId` and a
 * `trainingSessionId` is exactly the shape a conflation bug produces, so it is
 * rejected rather than resolved by precedence.
 */
export function parseReviewSubject(raw: unknown): ReviewSubject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort().join('|');
  switch (value.kind) {
    case 'run_artifact': {
      if (keys !== 'artifactId|kind|runId') return null;
      const runId = uuid(value.runId); const artifactId = uuid(value.artifactId);
      return runId && artifactId ? { kind: 'run_artifact', runId, artifactId } : null;
    }
    case 'training_source': {
      if (keys !== 'kind|sourceId|trainingSessionId') return null;
      const trainingSessionId = uuid(value.trainingSessionId); const sourceId = uuid(value.sourceId);
      return trainingSessionId && sourceId ? { kind: 'training_source', trainingSessionId, sourceId } : null;
    }
    default:
      return null;
  }
}

/**
 * What the surface is reviewing, in the Coach's words. Two different sentences,
 * because a demonstration is not a run and the header must not say it is.
 */
export function reviewSubjectLabel(subject: ReviewSubject): string {
  switch (subject.kind) {
    case 'run_artifact': return 'Reviewing a result this agent produced';
    case 'training_source': return 'Reviewing work you demonstrated';
    default: return assertNever(subject, 'reviewSubjectLabel');
  }
}
