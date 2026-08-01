/**
 * lib/generation-proposal.ts — the PURE parser and view model for the
 * paid-generation proposal API. (The server-side fetch lives in
 * lib/generation-proposal-read.ts; this module is also consumed by client
 * components, which verify approve/cancel responses with the same parser.)
 *
 * CONTRACT: /api/v2/generation-proposals (backend `generation-quality.v1`,
 * contract_version 2026-08-01, post-review revision of backend PR #130 —
 * Professional compiles unavailable-with-graph, completed demands the full
 * evidence chain). TRANSPORT-BINDING STATUS: pinned to the exact compiled
 * fixtures of that revision; re-reconcile against #130's merged head before
 * declaring this surface live. See docs/generation-quality-ux.md.
 *
 * THE RULES, same as lib/review.ts and for the same reason — except here the
 * surface is authorizing PAID work, so a coerced parse doesn't just lie about
 * state, it mis-describes what the user is about to spend:
 *
 *   - A 200 is not a contract. Parsing is REJECTION, not coercion. Required
 *     arrays/objects are never defaulted to []/{} — a missing task list is a
 *     malformed proposal, not a free one.
 *   - Unknown ADDITIVE fields are allowed; unknown STATES are not. A progress
 *     state we don't recognize fails the parse rather than rendering as some
 *     state we guessed.
 *   - Identity must agree everywhere it is stated: the envelope, the identity
 *     block, the compiled proposal, the authorization, every task event and every
 *     receipt row. A digest that appears twice must be the same digest.
 *   - The dashboard never computes a charge. Credits are displayed exactly as
 *     compiled; there is no dollar figure anywhere in this contract, so none is
 *     ever rendered.
 *   - unavailable is NOT empty, and unknown is NOT failed.
 */

export type GenerationLifecycle =
  | 'awaiting_approval'
  | 'approved'
  | 'cancelled'
  | 'expired'
  | 'unavailable';

/**
 * The full progress vocabulary, verbatim from the backend's status projection.
 * `unknown` is a real, distinct disposition: the backend could not determine
 * whether paid work finished. It is NOT failed, and it must never invite a retry.
 */
export type GenerationProgress =
  | 'awaiting_approval'
  | 'pending'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'unknown'
  | 'expired'
  | 'cancelled'
  | 'unavailable';

export type AuthorizationStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'unknown' | 'expired';

export type GenerationTaskVM = {
  taskId: string;
  momentId: string;
  variant: string;
  window: { startSeconds: number; endSeconds: number };
  model: string;
  promptText: string;
  promptDigest: string;
  ratio: string;
  durationSeconds: number;
  credits: number;
};

/**
 * A durable task event. The contract admits exactly two event types, each with
 * its type-specific status — `task_created` carries `created`, `task_succeeded`
 * carries `succeeded` plus the produced artifact's digest — at most one of each
 * per task, and always a provider task id. Anything else is not a record the
 * backend's own projection can emit.
 */
export type GenerationTaskEventVM = {
  taskId: string;
  eventType: 'task_created' | 'task_succeeded';
  providerTaskId: string;
  status: 'created' | 'succeeded';
  /** Present exactly when eventType is task_succeeded. */
  artifactSha256: string | null;
  createdAt: string | null;
};

export type GenerationReceiptTaskVM = {
  taskId: string;
  providerTaskId: string;
  /** Always present and always equal to the proposal task's prompt digest. */
  promptDigest: string;
  status: 'succeeded' | 'failed' | 'unknown';
  artifactSha256: string | null;
};

export type GenerationReceiptVM = {
  /** The receipt is BOUND to its authorization; both ids must agree with it. */
  authorizationId: string;
  authorizationDigest: string;
  digest: string | null;
  tasks: GenerationReceiptTaskVM[];
};

export type GenerationAuthorizationVM = {
  id: string;
  digest: string;
  status: AuthorizationStatus;
  maxTasks: number;
  maxCredits: number;
  expiresAt: string;
  claimedAt: string | null;
  finalizedAt: string | null;
  errorCode: string | null;
};

/**
 * THE normalized view model. Components consume this and only this — no component
 * reads a raw transport field, so a contract change is absorbed in exactly one
 * place.
 */
export type GenerationProposalViewModel = {
  proposalId: string;
  contractVersion: string;
  compilerVersion: string;
  capabilityKey: string;
  qualityMode: 'fast' | 'professional' | 'production';
  availability: boolean;
  unavailableReason: string | null;
  requiredMissingCapabilities: string[];

  agentSubject: string;
  sourceRunId: string | null;
  sourceRequestId: string | null;

  /** The exact pair an approval must echo. Never mutated client-side. */
  proposalVersion: string;
  proposalDigest: string;

  lifecycle: GenerationLifecycle;
  progress: GenerationProgress;

  provider: string | null;
  model: string | null;
  stageKinds: string[];
  densityLabel: string | null;
  generationsPerMoment: number | null;
  reviewRequirements: string[];

  tasks: GenerationTaskVM[];
  taskCount: number;
  maximumCredits: number;
  /**
   * Credits incurred so far: the backend computes this as the sum of credits of
   * tasks whose `task_created` event is on record — spend attaches to a clip
   * STARTING, not to approval and not to completion. The parser re-derives the
   * same sum from the events and refuses a response where the two disagree.
   */
  incurredCredits: number;
  /**
   * Always null under contract 2026-08-01: the backend supplies credits only.
   * A dollar figure may ONLY ever come from a backend field — never client math.
   */
  dollars: null;

  expiresAt: string;
  authorization: GenerationAuthorizationVM | null;
  events: GenerationTaskEventVM[];
  receipt: GenerationReceiptVM | null;
};

// ── validators ──────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const SHA256_RE = /^[a-f0-9]{64}$/i;
const isDigest = (v: unknown): v is string => typeof v === 'string' && SHA256_RE.test(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNullableString = (v: unknown) => v === null || typeof v === 'string';
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

const LIFECYCLES = new Set<GenerationLifecycle>(['awaiting_approval', 'approved', 'cancelled', 'expired', 'unavailable']);
const PROGRESS_STATES = new Set<GenerationProgress>(['awaiting_approval', 'pending', 'generating', 'completed', 'failed', 'unknown', 'expired', 'cancelled', 'unavailable']);
const AUTH_STATUSES = new Set<AuthorizationStatus>(['pending', 'claimed', 'completed', 'failed', 'unknown', 'expired']);
const RECEIPT_STATUSES = new Set(['succeeded', 'failed', 'unknown']);
const QUALITY_MODES = new Set(['fast', 'professional', 'production']);

/**
 * The lifecycle each progress state may accompany. `unknown` progress appears both
 * under an approved authorization (the projection could not classify it) and with
 * lifecycle null in the backend — but the backend only emits lifecycle null on its
 * own malformed-read paths, which arrive with ok:false and never reach here. So a
 * parsed OK response must carry a real lifecycle, and the pair must agree.
 */
const PROGRESS_BY_LIFECYCLE: Record<GenerationLifecycle, ReadonlySet<GenerationProgress>> = {
  awaiting_approval: new Set<GenerationProgress>(['awaiting_approval']),
  approved: new Set<GenerationProgress>(['pending', 'generating', 'completed', 'failed', 'unknown', 'expired']),
  cancelled: new Set<GenerationProgress>(['cancelled']),
  expired: new Set<GenerationProgress>(['expired']),
  unavailable: new Set<GenerationProgress>(['unavailable']),
};

/** Authorization status → the progress the projection derives from it. */
const PROGRESS_BY_AUTH: Record<AuthorizationStatus, GenerationProgress> = {
  pending: 'pending', claimed: 'generating', completed: 'completed',
  failed: 'failed', unknown: 'unknown', expired: 'expired',
};

function parseTask(v: unknown): GenerationTaskVM | null {
  if (!isObject(v)) return null;
  if (!isId(v.task_id) || !isId(v.moment_id) || !isId(v.variant)) return null;
  const ts = v.timestamp;
  if (!isObject(ts)) return null;
  const start = ts.start_seconds; const end = ts.end_seconds;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start) return null;
  if (!isId(v.model) || !isId(v.prompt_text) || !isDigest(v.prompt_digest) || !isId(v.ratio)) return null;
  if (!(typeof v.duration_seconds === 'number' && Number.isFinite(v.duration_seconds) && v.duration_seconds > 0)) return null;
  if (!isNonNegInt(v.credits)) return null;
  return {
    taskId: v.task_id, momentId: v.moment_id, variant: v.variant,
    window: { startSeconds: start, endSeconds: end },
    model: v.model, promptText: v.prompt_text, promptDigest: v.prompt_digest,
    ratio: v.ratio, durationSeconds: v.duration_seconds, credits: v.credits,
  };
}

export type CompiledGenerationProposal = Pick<GenerationProposalViewModel,
  | 'contractVersion' | 'compilerVersion' | 'capabilityKey' | 'qualityMode'
  | 'availability' | 'unavailableReason' | 'requiredMissingCapabilities'
  | 'provider' | 'model' | 'stageKinds' | 'densityLabel' | 'generationsPerMoment'
  | 'reviewRequirements' | 'tasks' | 'taskCount' | 'maximumCredits'
> & { proposalDigest: string };

/**
 * Parse the compiled proposal document. Null on ANY shape violation — including
 * internal disagreements (task_count vs tasks, maximum_credits vs the task sum,
 * per_task_credits vs tasks). The backend computed all of these from the same
 * tasks; if they disagree, we are not looking at what the backend compiled.
 */
export function parseCompiledGenerationProposal(v: unknown): CompiledGenerationProposal | null {
  if (!isObject(v)) return null;
  if (!isId(v.contract_version) || !isId(v.compiler_version) || !isId(v.capability_key)) return null;
  if (typeof v.quality_mode !== 'string' || !QUALITY_MODES.has(v.quality_mode)) return null;
  if (typeof v.availability !== 'boolean') return null;
  const availability = v.availability;

  // The reason must exist exactly when the proposal is unavailable. availability
  // true with a reason — or false without one — is a self-contradiction.
  if (availability) {
    if (v.unavailable_reason !== null && v.unavailable_reason !== undefined) return null;
  } else if (!isId(v.unavailable_reason)) return null;

  if (!Array.isArray(v.required_missing_capabilities)
    || !v.required_missing_capabilities.every((c) => isId(c))) return null;

  if (!Array.isArray(v.stages)) return null;
  const stageKinds: string[] = [];
  for (const stage of v.stages) {
    if (!isObject(stage) || !isId(stage.id) || !isId(stage.kind)) return null;
    stageKinds.push(stage.kind);
  }

  if (!isObject(v.density_policy)) return null;
  const gpm = v.density_policy.generations_per_moment;
  const densityLabel = v.density_policy.label;
  if (!(gpm === null || (typeof gpm === 'number' && Number.isInteger(gpm) && gpm > 0))) return null;
  if (!(densityLabel === null || isId(densityLabel))) return null;

  // REQUIRED array — never defaulted. `tasks: undefined` is a malformed proposal.
  if (!Array.isArray(v.tasks)) return null;
  const tasks: GenerationTaskVM[] = [];
  const taskIds = new Set<string>();
  for (const raw of v.tasks) {
    const task = parseTask(raw);
    if (!task) return null;
    // A duplicated task id would double-count credits and make every event and
    // receipt row ambiguous about which clip it describes. DEFENSE IN DEPTH, not
    // the only line: any duplicate also collapses the credits map below and fails
    // the per_task_credits agreement — mutating THIS check alone does not fail a
    // test (verified by mutation), and that is reported honestly rather than
    // dressed up. It stays because it states the intent where the ids are read,
    // and keeps the parser safe if the credits agreement is ever loosened.
    if (taskIds.has(task.taskId)) return null;
    taskIds.add(task.taskId);
    tasks.push(task);
  }

  // An APPROVABLE proposal must propose something; an unavailable one may still
  // CARRY a task graph as a preview (Professional does, until per-asset judging
  // and segmented assembly are genuinely enforced) or carry nothing (Production).
  // What is not negotiable: the graph travels whole. Tasks without pins, density,
  // stages, or review requirements would show clips with no statement of what
  // runs them — and pins without tasks would name a provider for no work.
  if (availability && tasks.length === 0) return null;
  let provider: string | null = null;
  let model: string | null = null;
  if (tasks.length > 0) {
    if (stageKinds.length === 0) return null;
    if (gpm === null || densityLabel === null) return null;
    if (!isObject(v.pins) || !isId(v.pins.provider) || !isId(v.pins.model)) return null;
    provider = v.pins.provider; model = v.pins.model;
  } else {
    if (stageKinds.length !== 0) return null;
    if (gpm !== null || densityLabel !== null) return null;
    if (v.pins !== null && v.pins !== undefined) return null;
  }

  if (v.task_count !== tasks.length) return null;

  // per_task_credits must be the SAME statement as tasks, not a second opinion.
  if (!Array.isArray(v.per_task_credits) || v.per_task_credits.length !== tasks.length) return null;
  const creditsByTask = new Map(tasks.map((t) => [t.taskId, t.credits]));
  for (const row of v.per_task_credits) {
    if (!isObject(row) || !isId(row.task_id)) return null;
    if (creditsByTask.get(row.task_id) !== row.credits) return null;
    creditsByTask.delete(row.task_id);
  }
  if (creditsByTask.size !== 0) return null;

  // The headline number the user approves. It must BE the sum of what is listed —
  // `maximum_credits: null` or a mismatched total is a proposal we refuse to show.
  const sum = tasks.reduce((acc, t) => acc + t.credits, 0);
  if (v.maximum_credits !== sum) return null;
  // The contract's hard bounds (generation-proposal-v1.schema.json): at most 10
  // tasks, at most 1200 credits. The compiler cannot emit more; a response that
  // does is not the compiler's.
  if (tasks.length > 10 || sum > 1200) return null;

  if (!Array.isArray(v.review_requirements) || !v.review_requirements.every((r) => isId(r))) return null;
  // Review requirements describe the graph, so they exist exactly when it does.
  if ((tasks.length > 0) !== (v.review_requirements.length > 0)) return null;

  // MODE GATES FOR THIS CONTRACT VERSION. Professional is deliberately a rich
  // preview: its distinct tasks, pins, stages and costs remain visible, but the
  // mode cannot become approvable until Judge + segmented assembly are real.
  // Production is the separate static zero-task gate; it must never borrow the
  // Professional graph under a stronger label.
  if (v.quality_mode === 'professional') {
    if (availability !== false
      || v.unavailable_reason !== 'missing_required_professional_execution_capabilities'
      || tasks.length === 0) return null;
  }
  if (v.quality_mode === 'production') {
    if (availability !== false
      || v.unavailable_reason !== 'missing_required_production_capabilities'
      || tasks.length !== 0 || stageKinds.length !== 0
      || provider !== null || model !== null || sum !== 0
      || v.review_requirements.length !== 0) return null;
  }
  if (!isDigest(v.proposal_digest)) return null;

  return {
    contractVersion: v.contract_version, compilerVersion: v.compiler_version,
    capabilityKey: v.capability_key,
    qualityMode: v.quality_mode as 'fast' | 'professional' | 'production',
    availability, unavailableReason: availability ? null : (v.unavailable_reason as string),
    requiredMissingCapabilities: v.required_missing_capabilities as string[],
    provider, model, stageKinds,
    densityLabel: densityLabel as string | null, generationsPerMoment: gpm as number | null,
    reviewRequirements: v.review_requirements as string[],
    tasks, taskCount: tasks.length, maximumCredits: sum,
    proposalDigest: v.proposal_digest,
  };
}

function parseAuthorization(v: unknown): GenerationAuthorizationVM | null {
  if (!isObject(v)) return null;
  if (!isId(v.authorization_id) || !isDigest(v.authorization_digest)) return null;
  if (typeof v.status !== 'string' || !AUTH_STATUSES.has(v.status as AuthorizationStatus)) return null;
  if (!isNonNegInt(v.max_tasks) || !isNonNegInt(v.max_credits)) return null;
  if (!isId(v.expires_at)) return null;
  if (!isNullableString(v.claimed_at ?? null) || !isNullableString(v.finalized_at ?? null)) return null;
  if (!isNullableString(v.error_code ?? null)) return null;
  return {
    id: v.authorization_id, digest: v.authorization_digest,
    status: v.status as AuthorizationStatus,
    maxTasks: v.max_tasks, maxCredits: v.max_credits, expiresAt: v.expires_at,
    claimedAt: (v.claimed_at as string | null) ?? null,
    finalizedAt: (v.finalized_at as string | null) ?? null,
    errorCode: (v.error_code as string | null) ?? null,
  };
}

/**
 * Parse ONE task event against the contract's closed vocabulary: two event
 * types, each with its type-specific status, always a provider task id. An
 * event about a task this proposal does not contain describes someone else's
 * work — rendering it would attribute foreign progress to this run's clips.
 */
function parseEvent(v: unknown, taskIds: ReadonlySet<string>): GenerationTaskEventVM | null {
  if (!isObject(v)) return null;
  if (!isId(v.task_id) || !taskIds.has(v.task_id)) return null;
  if (v.event_type !== 'task_created' && v.event_type !== 'task_succeeded') return null;
  if (!isId(v.provider_task_id)) return null;
  if (!isNullableString(v.created_at ?? null)) return null;

  const artifact = v.artifact;
  let artifactSha256: string | null = null;
  if (artifact !== null && artifact !== undefined) {
    if (!isObject(artifact)) return null;
    if (artifact.sha256 !== undefined) {
      if (!isDigest(artifact.sha256)) return null;
      artifactSha256 = artifact.sha256;
    }
  }

  // TYPE-SPECIFIC STATUS. A `task_created` claiming `succeeded` (or vice versa)
  // is not a record the backend projection can emit; treating it as either one
  // would count progress that was never durably stated.
  //
  // Backend 19fc508 accepts a succeeded record only with artifact_sha256 and
  // projects it as artifact.sha256. Therefore a projected success without that
  // digest is malformed even mid-flight; accepting it would invent evidence the
  // record-time contract cannot contain.
  if (v.event_type === 'task_created') {
    if (v.status !== 'created') return null;
  } else if (v.status !== 'succeeded' || artifactSha256 === null) return null;

  return {
    taskId: v.task_id, eventType: v.event_type,
    providerTaskId: v.provider_task_id,
    status: v.status,
    artifactSha256,
    createdAt: (v.created_at as string | null) ?? null,
  };
}

function parseReceipt(
  v: unknown,
  tasksById: ReadonlyMap<string, GenerationTaskVM>,
): GenerationReceiptVM | null | false {
  if (v === null || v === undefined) return null;
  if (!isObject(v) || !Array.isArray(v.tasks)) return false;
  // A receipt is BOUND to its authorization or it is nobody's receipt.
  if (!isId(v.authorization_id) || !isDigest(v.authorization_digest)) return false;
  if (!(v.receipt_digest === null || isDigest(v.receipt_digest))) return false;
  const out: GenerationReceiptTaskVM[] = [];
  const seen = new Set<string>();
  for (const raw of v.tasks) {
    if (!isObject(raw)) return false;
    if (!isId(raw.task_id) || !tasksById.has(raw.task_id)) return false;
    // Two receipt rows claiming the same task would let one clip's outcome mask
    // another's.
    if (seen.has(raw.task_id)) return false;
    seen.add(raw.task_id);
    if (typeof raw.status !== 'string' || !RECEIPT_STATUSES.has(raw.status)) return false;
    if (!isId(raw.provider_task_id)) return false;
    // Every row must carry ITS TASK'S prompt digest. A missing digest — or a
    // different one — is a receipt for work this proposal never authorized.
    if (!isDigest(raw.prompt_digest)) return false;
    if (raw.prompt_digest !== tasksById.get(raw.task_id)!.promptDigest) return false;
    const artifact = raw.artifact;
    let artifactSha256: string | null = null;
    if (artifact !== null && artifact !== undefined) {
      if (!isObject(artifact)) return false;
      if (artifact.sha256 !== undefined) {
        if (!isDigest(artifact.sha256)) return false;
        artifactSha256 = artifact.sha256;
      }
    }
    out.push({
      taskId: raw.task_id,
      providerTaskId: raw.provider_task_id,
      promptDigest: raw.prompt_digest,
      status: raw.status as GenerationReceiptTaskVM['status'],
      artifactSha256,
    });
  }
  return {
    authorizationId: v.authorization_id,
    authorizationDigest: v.authorization_digest,
    digest: (v.receipt_digest as string | null) ?? null,
    tasks: out,
  };
}

/**
 * Parse GET /api/v2/generation-proposals/:id (also the response of approve and
 * cancel, which return the same read). Null on any violation, so the caller can
 * report unavailable rather than render a guess.
 */
export function parseGenerationProposalResponse(
  body: unknown,
  expectedProposalId?: string,
): GenerationProposalViewModel | null {
  if (!isObject(body) || body.ok !== true) return null;
  if (!isId(body.proposal_id)) return null;
  // IDENTITY. A valid-looking proposal for a DIFFERENT id must never render under
  // this URL — every action taken from it would target the wrong money.
  if (expectedProposalId && body.proposal_id !== expectedProposalId) return null;
  const proposalId = body.proposal_id;

  const compiled = parseCompiledGenerationProposal(body.proposal);
  if (!compiled) return null;

  // The identity block must agree with itself and with the compiled document.
  const identity = body.identity;
  if (!isObject(identity)) return null;
  if (identity.proposal_id !== proposalId) return null;
  if (!isId(identity.agent_subject) || !isId(identity.proposal_version)) return null;
  if (!isDigest(identity.proposal_digest) || identity.proposal_digest !== compiled.proposalDigest) return null;
  if (identity.capability_key !== compiled.capabilityKey) return null;
  if (!isNullableString(identity.source_run_id ?? null) || !isNullableString(identity.source_request_id ?? null)) return null;

  if (typeof body.lifecycle_state !== 'string' || !LIFECYCLES.has(body.lifecycle_state as GenerationLifecycle)) return null;
  const lifecycle = body.lifecycle_state as GenerationLifecycle;
  if (typeof body.progress_state !== 'string' || !PROGRESS_STATES.has(body.progress_state as GenerationProgress)) return null;
  const progress = body.progress_state as GenerationProgress;
  // The pair must be one the backend's own projection can produce.
  if (!PROGRESS_BY_LIFECYCLE[lifecycle].has(progress)) return null;

  // The envelope repeats availability; it must not contradict the document.
  if (body.availability !== compiled.availability) return null;
  if ((body.unavailable_reason ?? null) !== compiled.unavailableReason) return null;
  // Unavailability is a lifecycle fact, stated twice. Both statements must match.
  if ((lifecycle === 'unavailable') !== (compiled.availability === false)) return null;

  if (!isId(body.expires_at) || Number.isNaN(Date.parse(body.expires_at))) return null;

  // cost must restate the compiled maximum, not offer a rival. total_credits is
  // checked against the events below, once they are parsed.
  if (!isObject(body.cost)) return null;
  if (body.cost.maximum_credits !== compiled.maximumCredits) return null;
  if (!isNonNegInt(body.cost.total_credits)) return null;

  const authorization = body.authorization === null || body.authorization === undefined
    ? null
    : parseAuthorization(body.authorization);
  if (body.authorization !== null && body.authorization !== undefined && authorization === null) return null;

  if (lifecycle === 'approved') {
    // An approval without its authorization — or one whose numbers or identity
    // drifted from the proposal — is a partial read, not a smaller answer.
    if (!authorization) return null;
    if (identity.authorization_id !== authorization.id) return null;
    if (identity.authorization_digest !== authorization.digest) return null;
    if (authorization.maxTasks !== compiled.taskCount) return null;
    if (authorization.maxCredits !== compiled.maximumCredits) return null;
    if (PROGRESS_BY_AUTH[authorization.status] !== progress) return null;
  } else {
    if (authorization !== null) return null;
    if ((identity.authorization_id ?? null) !== null || (identity.authorization_digest ?? null) !== null) return null;
  }

  // REQUIRED array. `task_progress: null` is a progress read we could not make —
  // parsing it as "no events yet" would fabricate a calm zero.
  if (!Array.isArray(body.task_progress)) return null;
  const taskIds = new Set(compiled.tasks.map((t) => t.taskId));
  const events: GenerationTaskEventVM[] = [];
  const eventKeys = new Set<string>();
  const createdByTask = new Map<string, GenerationTaskEventVM>();
  const succeededByTask = new Map<string, GenerationTaskEventVM>();
  for (const raw of body.task_progress) {
    const event = parseEvent(raw, taskIds);
    if (!event) return null;
    // At most ONE event of each type per task. A second `task_succeeded` for the
    // same clip is either a replay or someone else's — both are refused.
    const key = `${event.taskId}:${event.eventType}`;
    if (eventKeys.has(key)) return null;
    eventKeys.add(key);
    (event.eventType === 'task_created' ? createdByTask : succeededByTask).set(event.taskId, event);
    events.push(event);
  }
  // A success must PAIR with its start: same task, same provider task id. An
  // unpaired success is an outcome for work nothing on record ever began.
  for (const [taskId, succeeded] of succeededByTask) {
    const created = createdByTask.get(taskId);
    if (!created || created.providerTaskId !== succeeded.providerTaskId) return null;
  }
  // Events can only exist under an authorization that could have produced them.
  if (events.length > 0 && !authorization) return null;

  // MONEY AGREES WITH EVENTS. The backend computes total_credits as the credits
  // of every task whose start is on record; re-derive and refuse a rival figure —
  // in either direction, spend understated is as false as spend invented.
  const incurred = compiled.tasks.reduce((sum, t) => sum + (createdByTask.has(t.taskId) ? t.credits : 0), 0);
  if (body.cost.total_credits !== incurred) return null;

  const tasksById = new Map(compiled.tasks.map((t) => [t.taskId, t]));
  const receipt = parseReceipt(body.receipt, tasksById);
  if (receipt === false) return null;
  if (receipt !== null) {
    if (!authorization) return null;
    // The receipt names the authorization it settles. A receipt bound to a
    // different authorization settles different work.
    if (receipt.authorizationId !== authorization.id) return null;
    if (receipt.authorizationDigest !== authorization.digest) return null;
  }

  // COMPLETED IS AN EVIDENCE CLAIM, NOT A STATUS FLAG. Before this surface says
  // "finished", every piece of the chain must be on record: a digested receipt
  // covering EVERY task, every row succeeded with its artifact, and each row's
  // provider id agreeing with both of that task's events, whose artifact digest
  // must match the receipt's. A bare `status: 'completed'` proves nothing.
  if (progress === 'completed') {
    if (!receipt || receipt.digest === null) return null;
    // Coverage is re-stated as a count and then PROVEN per task by the loop's
    // find(): rows are ⊆ tasks and deduped, so mutating this line alone does not
    // fail a test (verified by mutation) — kept, like the backend's own copy of
    // it, as an explicit statement and a guard against the loop ever loosening.
    if (receipt.tasks.length !== compiled.taskCount) return null;
    for (const task of compiled.tasks) {
      const row = receipt.tasks.find((r) => r.taskId === task.taskId);
      if (!row || row.status !== 'succeeded' || row.artifactSha256 === null) return null;
      const created = createdByTask.get(task.taskId);
      const succeeded = succeededByTask.get(task.taskId);
      if (!created || !succeeded) return null;
      // The created-side agreement is implied by the succeeded-side check plus
      // the event pairing above (created.provider === succeeded.provider), so it
      // too survives mutation untested — stated anyway, as the backend states it.
      if (row.providerTaskId !== created.providerTaskId) return null;
      if (row.providerTaskId !== succeeded.providerTaskId) return null;
      if (row.artifactSha256 !== succeeded.artifactSha256) return null;
    }
  }

  return {
    proposalId,
    contractVersion: compiled.contractVersion,
    compilerVersion: compiled.compilerVersion,
    capabilityKey: compiled.capabilityKey,
    qualityMode: compiled.qualityMode,
    availability: compiled.availability,
    unavailableReason: compiled.unavailableReason,
    requiredMissingCapabilities: compiled.requiredMissingCapabilities,
    agentSubject: identity.agent_subject as string,
    sourceRunId: (identity.source_run_id as string | null) ?? null,
    sourceRequestId: (identity.source_request_id as string | null) ?? null,
    proposalVersion: identity.proposal_version as string,
    proposalDigest: compiled.proposalDigest,
    lifecycle, progress,
    provider: compiled.provider, model: compiled.model,
    stageKinds: compiled.stageKinds,
    densityLabel: compiled.densityLabel,
    generationsPerMoment: compiled.generationsPerMoment,
    reviewRequirements: compiled.reviewRequirements,
    tasks: compiled.tasks, taskCount: compiled.taskCount,
    maximumCredits: compiled.maximumCredits,
    incurredCredits: body.cost.total_credits as number,
    dollars: null,
    expiresAt: body.expires_at,
    authorization, events, receipt,
  };
}
