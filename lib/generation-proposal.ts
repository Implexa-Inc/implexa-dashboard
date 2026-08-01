/**
 * lib/generation-proposal.ts — the client for the paid-generation proposal API.
 *
 * CONTRACT: /api/v2/generation-proposals (backend `generation-quality.v1`,
 * contract_version 2026-08-01). Consumed shapes were read off the backend
 * quality-compiler and proposal service, not invented here. TRANSPORT-BINDING
 * STATUS: the backend PR carrying this contract is not merged at the time of
 * writing; the parser below is pinned to the exact compiled fixtures produced by
 * that compiler and must be re-reconciled against the merged PR's versioned
 * fixtures before this surface is declared live. See docs/generation-quality-ux.md.
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

export type GenerationTaskEventVM = {
  taskId: string;
  eventType: string;
  providerTaskId: string | null;
  status: 'created' | 'succeeded' | 'failed' | 'unknown' | null;
  artifactSha256: string | null;
  createdAt: string | null;
};

export type GenerationReceiptTaskVM = {
  taskId: string;
  providerTaskId: string | null;
  promptDigest: string | null;
  status: 'succeeded' | 'failed' | 'unknown';
  artifactSha256: string | null;
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
  /** Credits the backend recorded as actually consumed. 0 until completion is durable. */
  chargedCredits: number;
  /**
   * Always null under contract 2026-08-01: the backend supplies credits only.
   * A dollar figure may ONLY ever come from a backend field — never client math.
   */
  dollars: null;

  expiresAt: string;
  authorization: GenerationAuthorizationVM | null;
  events: GenerationTaskEventVM[];
  receipt: { digest: string | null; tasks: GenerationReceiptTaskVM[] } | null;
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
const EVENT_STATUSES = new Set(['created', 'succeeded', 'failed', 'unknown']);
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

type CompiledCore = Pick<GenerationProposalViewModel,
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
function parseCompiled(v: unknown): CompiledCore | null {
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

  let provider: string | null = null;
  let model: string | null = null;
  if (availability) {
    // A live proposal must say what it runs and where feedback goes.
    if (tasks.length === 0) return null;
    if (stageKinds.length === 0) return null;
    if (gpm === null || densityLabel === null) return null;
    if (!isObject(v.pins) || !isId(v.pins.provider) || !isId(v.pins.model)) return null;
    provider = v.pins.provider; model = v.pins.model;
  } else {
    // An unavailable proposal authorizes nothing, so it must propose nothing.
    if (tasks.length !== 0) return null;
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

  if (!Array.isArray(v.review_requirements) || !v.review_requirements.every((r) => isId(r))) return null;
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

function parseEvent(v: unknown, taskIds: ReadonlySet<string>): GenerationTaskEventVM | null {
  if (!isObject(v)) return null;
  // An event about a task this proposal does not contain describes someone else's
  // work. Rendering it would attribute foreign progress to this run's clips.
  if (!isId(v.task_id) || !taskIds.has(v.task_id)) return null;
  if (!isId(v.event_type)) return null;
  if (!(v.status === null || (typeof v.status === 'string' && EVENT_STATUSES.has(v.status)))) return null;
  const artifact = v.artifact;
  let artifactSha256: string | null = null;
  if (artifact !== null && artifact !== undefined) {
    if (!isObject(artifact)) return null;
    if (artifact.sha256 !== undefined) {
      if (!isDigest(artifact.sha256)) return null;
      artifactSha256 = artifact.sha256;
    }
  }
  if (!isNullableString(v.provider_task_id ?? null) || !isNullableString(v.created_at ?? null)) return null;
  return {
    taskId: v.task_id, eventType: v.event_type,
    providerTaskId: (v.provider_task_id as string | null) ?? null,
    status: (v.status as GenerationTaskEventVM['status']),
    artifactSha256,
    createdAt: (v.created_at as string | null) ?? null,
  };
}

function parseReceipt(
  v: unknown,
  tasksById: ReadonlyMap<string, GenerationTaskVM>,
): { digest: string | null; tasks: GenerationReceiptTaskVM[] } | null | false {
  if (v === null || v === undefined) return null;
  if (!isObject(v) || !Array.isArray(v.tasks)) return false;
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
    if (!(raw.prompt_digest === null || isDigest(raw.prompt_digest))) return false;
    // A receipt row carrying a DIFFERENT prompt digest than the task it names is a
    // receipt for work this proposal never authorized.
    if (raw.prompt_digest !== null && raw.prompt_digest !== tasksById.get(raw.task_id)!.promptDigest) return false;
    if (!isNullableString(raw.provider_task_id ?? null)) return false;
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
      providerTaskId: (raw.provider_task_id as string | null) ?? null,
      promptDigest: (raw.prompt_digest as string | null) ?? null,
      status: raw.status as GenerationReceiptTaskVM['status'],
      artifactSha256,
    });
  }
  return { digest: (v.receipt_digest as string | null) ?? null, tasks: out };
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

  const compiled = parseCompiled(body.proposal);
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

  // cost is display-only and must restate the compiled maximum, not offer a rival.
  if (!isObject(body.cost)) return null;
  if (body.cost.maximum_credits !== compiled.maximumCredits) return null;
  if (!isNonNegInt(body.cost.total_credits) || body.cost.total_credits > compiled.maximumCredits) return null;

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
  for (const raw of body.task_progress) {
    const event = parseEvent(raw, taskIds);
    if (!event) return null;
    events.push(event);
  }
  // Events can only exist under an authorization that could have produced them.
  if (events.length > 0 && !authorization) return null;

  const tasksById = new Map(compiled.tasks.map((t) => [t.taskId, t]));
  const receipt = parseReceipt(body.receipt, tasksById);
  if (receipt === false) return null;
  if (receipt !== null && !authorization) return null;

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
    chargedCredits: body.cost.total_credits as number,
    dollars: null,
    expiresAt: body.expires_at,
    authorization, events, receipt,
  };
}

// ── read status wrapper ─────────────────────────────────────────────────────

/**
 * Three-valued read, following lib/attention.ts / lib/review.ts. `not_found` is a
 * real answer (the backend affirmatively said this proposal does not exist for
 * this user); `unavailable` is the absence of an answer. Rendering them the same
 * would tell a user their pending charge vanished when we merely couldn't read it.
 */
export type GenerationProposalRead =
  | { state: 'ready'; vm: GenerationProposalViewModel }
  | { state: 'not_found' }
  | { state: 'unavailable' };

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

async function sessionToken(): Promise<string | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function getGenerationProposal(proposalId: string): Promise<GenerationProposalRead> {
  const jwt = await sessionToken();
  if (!jwt) return { state: 'unavailable' };
  try {
    const res = await fetch(`${BACKEND}/api/v2/generation-proposals/${encodeURIComponent(proposalId)}`, {
      headers: { authorization: `Bearer ${jwt}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) {
      const body = await res.json().catch(() => null);
      // Only the backend's own affirmative answer counts as not-found. A bare 404
      // (wrong deploy, missing route) is a read we could not make.
      if (body && (body as { error?: unknown }).error === 'proposal_not_found') return { state: 'not_found' };
      return { state: 'unavailable' };
    }
    if (!res.ok) return { state: 'unavailable' };
    const body = await res.json();
    const vm = parseGenerationProposalResponse(body, proposalId);
    // Reject, do not coerce. A malformed 200 is a read we could not make.
    return vm ? { state: 'ready', vm } : { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}
