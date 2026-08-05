/**
 * lib/generation-proposal-v2.ts — the STRICT parser for
 * `professional-generation-control.v2` proposal documents.
 *
 * Same posture as lib/generation-proposal.ts, and the same reason: this surface
 * authorizes paid work, so a coerced parse does not merely mis-render state, it
 * mis-describes what the user is about to spend. A 200 is not a contract.
 *
 * WHAT IS CHECKED, AND WHY EACH ONE
 *
 *   * REJECTION, NEVER COERCION. Required arrays and objects are never defaulted.
 *     A missing task graph is a malformed proposal, not a free one.
 *   * INTERNAL AGREEMENT. Every figure this document states about itself is
 *     re-derived from the moments and refused if it disagrees: duration from the
 *     window, per-task credits against the moment's rate, task counts against
 *     `variants_requested` and `max_repairs`, the cost decomposition against the
 *     tasks, the envelope's totals against the graph's. The backend computed all
 *     of these from the same graph; if they disagree, we are not looking at what
 *     the backend compiled.
 *   * THE POLICY RULES, RESTATED. Ascending non-overlapping moments (abutting
 *     allowed), a repair reserve only under a Judge, a terminal state that
 *     matches the Judge mode. A response violating one is not something the
 *     compiler can emit, so rendering it would show a plan the executor cannot run.
 *   * NO CLIENT ARITHMETIC IS AUTHORITATIVE. The parser re-derives figures only
 *     to REFUSE a disagreeing document. Everything displayed is the backend's own
 *     number, verbatim.
 *
 * Digest verification is deliberately NOT attempted here. `graph_digest` and
 * `proposal_digest` are checked for SHAPE and for IDENTITY agreement across the
 * envelope; proving them is the backend's job at approval, and a browser that
 * recomputed them would be claiming an assurance it cannot give.
 */

import {
  CONTROL_V2, V2_CAPABILITY_KEY, V2_COMPILER_VERSION, V2_CONTRACT_VERSION,
  V2_DESKTOP_CAPABILITY_VERSION, durationSecondsFor,
  type JudgeMode,
} from './professional-v2-contract.ts';

export type ProfessionalV2TaskVM = {
  taskId: string;
  momentId: string;
  kind: 'candidate' | 'repair';
  /** candidate_ordinal for a candidate, repair_ordinal for a repair. */
  ordinal: number;
  provider: string;
  model: string;
  providerVersion: string;
  pricingVersion: string;
  promptText: string;
  promptDigest: string;
  ratio: string;
  durationSeconds: number;
  credits: number;
  /** Candidates run; repair reserves are contingent and start inactive. */
  activeByDefault: boolean;
};

export type ProfessionalV2ProviderIdentityVM = {
  provider: string;
  model: string;
  implementationId: string;
  adapterVersion: string;
  providerVersion: string;
  pricingVersion: string;
  /** How the machine authenticates to the provider. Never a credential. */
  authKind: string;
  authBinding: string;
};

export type ProfessionalV2MomentVM = {
  momentId: string;
  ordinal: number;
  startMs: number;
  endMs: number;
  durationSeconds: number;
  ratio: string;
  prompt: string;
  promptDigest: string;
  variantsRequested: number;
  judgeMode: JudgeMode;
  maxRepairs: number;
  creditsPerTask: number;
  providerIdentity: ProfessionalV2ProviderIdentityVM;
  candidateTaskIds: string[];
  repairTaskIds: string[];
  terminalState: 'variants_ready' | 'segment_ready';
  /** This moment's share of the decomposition, so the UI never has to add up. */
  expectedCredits: number;
  repairReserveCredits: number;
  maximumCredits: number;
};

/**
 * The EXACT validated source the plan was compiled against, as the backend
 * signed it. Parsed strictly: a partial binding is a ceiling nothing stands
 * behind, and the browser must refuse rather than render a plan whose bound it
 * cannot state.
 */
export type CompiledSourceBinding = {
  sourceRunId: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  mediaDurationMs: number;
  windows: ReadonlyArray<{ momentId: string; startMs: number; endMs: number }>;
};

export type CompiledProfessionalV2Proposal = {
  contractVersion: string;
  compilerVersion: string;
  capabilityKey: string;
  qualityMode: 'professional';
  controlContractVersion: string;
  executionMode: string;
  availability: boolean;
  unavailableReason: string | null;
  requiredMissingCapabilities: string[];
  graphDigest: string;
  proposalDigest: string;
  moments: ProfessionalV2MomentVM[];
  tasks: ProfessionalV2TaskVM[];
  /** Timeline COVERAGE — finished B-roll moments. Never the take count. */
  momentCount: number;
  /** Everything the authorization covers: takes plus repair reserves. */
  taskCount: number;
  /** Paid generations that run up front. NOT additional coverage. */
  candidateTaskCount: number;
  repairTaskCount: number;
  initialCredits: number;
  repairReserveCredits: number;
  maximumCredits: number;
  /** The graph states these; both are load-bearing product claims. */
  projectionOnly: boolean;
  finalRenderAuthorized: boolean;
  /** The bound source. Always present — an unbound v2 plan does not parse. */
  sourceBinding: CompiledSourceBinding;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const SHA256_RE = /^[a-f0-9]{64}$/;
const isDigest = (v: unknown): v is string => typeof v === 'string' && SHA256_RE.test(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

const JUDGE_MODE_SET = new Set<JudgeMode>(['off', 'ranked']);

function parseProviderIdentity(v: unknown): ProfessionalV2ProviderIdentityVM | null {
  if (!isObject(v)) return null;
  const provider = v.provider;
  const model = v.model;
  const implementationId = v.implementation_id;
  const adapterVersion = v.adapter_version;
  const providerVersion = v.provider_version;
  const pricingVersion = v.pricing_version;
  if (!isText(provider) || !isText(model) || !isText(implementationId)
    || !isText(adapterVersion) || !isText(providerVersion) || !isText(pricingVersion)) return null;
  const auth = v.auth_identity;
  if (!isObject(auth) || !isText(auth.kind) || !isText(auth.binding)) return null;
  // The auth identity names the machine binding, never a credential. A provider
  // key or token appearing here is a producer bug, and rendering it would put a
  // secret on screen — so the parser reads only the two fields that are safe.
  if (auth.provider !== provider) return null;
  return {
    provider, model, implementationId, adapterVersion, providerVersion, pricingVersion,
    authKind: auth.kind, authBinding: auth.binding,
  };
}

function parseTask(v: unknown): ProfessionalV2TaskVM | null {
  if (!isObject(v)) return null;
  if (!isText(v.task_id) || !isText(v.moment_id)) return null;
  if (v.task_kind !== 'candidate' && v.task_kind !== 'repair') return null;
  const kind = v.task_kind;
  const provider = v.provider;
  const model = v.model;
  const providerVersion = v.provider_version;
  const pricingVersion = v.pricing_version;
  const ratio = v.ratio;
  if (!isText(provider) || !isText(model) || !isText(providerVersion)
    || !isText(pricingVersion) || !isText(ratio)) return null;
  if (!isText(v.prompt_text) || !isDigest(v.prompt_digest)) return null;
  if (!isPosInt(v.duration_seconds) || !isPosInt(v.credits)) return null;
  // Contingent work must SAY it is contingent, and running work must say it runs.
  // A repair that arrived marked active is an extra take the user did not think
  // they were authorizing.
  if (v.active_by_default !== (kind === 'candidate')) return null;
  // Each arm carries ITS ordinal and not the other's. A task claiming both
  // identities is not something the compiler emits.
  if (kind === 'candidate') {
    if (!isPosInt(v.candidate_ordinal) || v.repair_ordinal !== undefined) return null;
  } else if (!isPosInt(v.repair_ordinal) || v.candidate_ordinal !== undefined) return null;
  return {
    taskId: v.task_id, momentId: v.moment_id, kind,
    ordinal: (kind === 'candidate' ? v.candidate_ordinal : v.repair_ordinal) as number,
    provider, model, providerVersion, pricingVersion,
    promptText: v.prompt_text, promptDigest: v.prompt_digest,
    ratio, durationSeconds: v.duration_seconds, credits: v.credits,
    activeByDefault: kind === 'candidate',
  };
}

type ParsedGraph = {
  graphDigest: string;
  sourceBinding: CompiledSourceBinding;
  moments: ProfessionalV2MomentVM[];
  tasks: ProfessionalV2TaskVM[];
  initialCredits: number;
  repairReserveCredits: number;
  maximumCredits: number;
  projectionOnly: boolean;
  finalRenderAuthorized: boolean;
  executionMode: string;
};

function parseControlGraph(v: unknown): ParsedGraph | null {
  if (!isObject(v)) return null;
  if (v.contract_version !== CONTROL_V2) return null;
  if (v.desktop_capability_version !== V2_DESKTOP_CAPABILITY_VERSION) return null;
  if (!isDigest(v.graph_digest)) return null;
  if (!isText(v.execution_mode)) return null;

  // ASSEMBLY IS A PRODUCT CLAIM. v2 authorizes per-moment generation and a
  // projection, not a final render. A graph asserting otherwise is promising
  // work no part of this pipeline performs.
  if (!isObject(v.assembly) || v.assembly.projection_only !== true || v.assembly.final_render_authorized !== false) return null;

  if (!Array.isArray(v.authorization_tasks) || !Array.isArray(v.moments) || v.moments.length < 1) return null;

  const tasks: ProfessionalV2TaskVM[] = [];
  const tasksById = new Map<string, ProfessionalV2TaskVM>();
  for (const raw of v.authorization_tasks) {
    const task = parseTask(raw);
    if (!task) return null;
    // A duplicated task id would double-count credits and leave every event and
    // receipt row ambiguous about which take it describes.
    if (tasksById.has(task.taskId)) return null;
    tasksById.set(task.taskId, task);
    tasks.push(task);
  }

  const moments: ProfessionalV2MomentVM[] = [];
  const momentIds = new Set<string>();
  const claimedTaskIds = new Set<string>();

  for (let index = 0; index < v.moments.length; index += 1) {
    const raw = v.moments[index];
    if (!isObject(raw)) return null;
    if (!isText(raw.moment_id) || momentIds.has(raw.moment_id)) return null;
    if (raw.ordinal !== index) return null;
    momentIds.add(raw.moment_id);

    const providerIdentity = parseProviderIdentity(raw.provider_identity);
    if (!providerIdentity) return null;

    if (!isText(raw.ratio) || !isText(raw.prompt) || raw.prompt.trim().length === 0) return null;
    if (!isDigest(raw.prompt_digest)) return null;

    const timestamp = raw.timestamp;
    if (!isObject(timestamp) || !isNonNegInt(timestamp.start_ms) || !isPosInt(timestamp.end_ms)) return null;
    const startMs = timestamp.start_ms;
    const endMs = timestamp.end_ms;
    if (endMs <= startMs) return null;
    // The moment's stated duration must be the one its own window implies.
    if (raw.duration_seconds !== durationSecondsFor(startMs, endMs)) return null;

    // ASCENDING AND NON-OVERLAPPING; abutting allowed. Two moments covering the
    // same instant have no defined meaning without a track contract — nothing
    // says which is on top or what the user paid twice for.
    const previous = index === 0 ? null : moments[index - 1];
    if (previous && startMs < previous.endMs) return null;

    if (!isPosInt(raw.variants_requested)) return null;
    if (typeof raw.judge_mode !== 'string' || !JUDGE_MODE_SET.has(raw.judge_mode as JudgeMode)) return null;
    const judgeMode = raw.judge_mode as JudgeMode;
    if (!isObject(raw.repair_policy) || !isNonNegInt(raw.repair_policy.max_repairs)) return null;
    const maxRepairs = raw.repair_policy.max_repairs;
    // Contingent credits no verdict could release are money authorized for work
    // nothing can legitimately spend.
    if (maxRepairs > 0 && judgeMode === 'off') return null;

    const expectedTerminal = judgeMode === 'off' ? 'variants_ready' : 'segment_ready';
    if (raw.terminal_state !== expectedTerminal) return null;

    if (!isPosInt(raw.credits_per_task)) return null;
    if (!Array.isArray(raw.reference_artifact_ids) || raw.reference_artifact_ids.some((id) => !isText(id))) return null;

    const candidateTaskIds = raw.candidate_task_ids;
    const repairTaskIds = raw.repair_task_ids;
    if (!Array.isArray(candidateTaskIds) || !Array.isArray(repairTaskIds)) return null;
    if (candidateTaskIds.length !== raw.variants_requested || repairTaskIds.length !== maxRepairs) return null;
    if (new Set(candidateTaskIds).size !== candidateTaskIds.length
      || new Set(repairTaskIds).size !== repairTaskIds.length) return null;

    const ordinalsSeen = new Set<number>();
    for (const [ids, kind] of [[candidateTaskIds, 'candidate'], [repairTaskIds, 'repair']] as const) {
      ordinalsSeen.clear();
      for (const id of ids) {
        if (!isText(id)) return null;
        const task = tasksById.get(id);
        // BIJECTION. Every id the moment names must exist, be of the right kind,
        // belong to THIS moment, and be claimed by exactly one moment.
        if (!task || task.kind !== kind || task.momentId !== raw.moment_id) return null;
        if (claimedTaskIds.has(id)) return null;
        claimedTaskIds.add(id);
        if (ordinalsSeen.has(task.ordinal)) return null;
        ordinalsSeen.add(task.ordinal);
        if (task.ordinal > ids.length) return null;
        // EVERY APPROVED EXECUTION PARAMETER, bound to the moment that declared
        // it. A task free to disagree with its moment is a task free to run
        // longer, differently-shaped or differently-priced paid work than the
        // one the user approved.
        if (task.provider !== providerIdentity.provider
          || task.model !== providerIdentity.model
          || task.providerVersion !== providerIdentity.providerVersion
          || task.pricingVersion !== providerIdentity.pricingVersion) return null;
        if (task.ratio !== raw.ratio) return null;
        if (task.durationSeconds !== raw.duration_seconds) return null;
        if (task.credits !== raw.credits_per_task) return null;
      }
    }

    moments.push({
      momentId: raw.moment_id, ordinal: index,
      startMs, endMs, durationSeconds: raw.duration_seconds,
      ratio: raw.ratio, prompt: raw.prompt, promptDigest: raw.prompt_digest,
      variantsRequested: raw.variants_requested, judgeMode, maxRepairs,
      creditsPerTask: raw.credits_per_task,
      providerIdentity,
      candidateTaskIds: [...candidateTaskIds] as string[],
      repairTaskIds: [...repairTaskIds] as string[],
      terminalState: expectedTerminal,
      expectedCredits: raw.credits_per_task * raw.variants_requested,
      repairReserveCredits: raw.credits_per_task * maxRepairs,
      maximumCredits: raw.credits_per_task * (raw.variants_requested + maxRepairs),
    });
  }

  // No orphan tasks: a task no moment claims is authorized paid work that
  // nothing on the timeline asked for.
  if (claimedTaskIds.size !== tasks.length) return null;

  const initialCredits = tasks.filter((t) => t.kind === 'candidate').reduce((sum, t) => sum + t.credits, 0);
  const repairReserveCredits = tasks.filter((t) => t.kind === 'repair').reduce((sum, t) => sum + t.credits, 0);
  const cost = v.cost;
  if (!isObject(cost)
    || cost.initial_credits !== initialCredits
    || cost.repair_reserve_credits !== repairReserveCredits
    || cost.maximum_credits !== initialCredits + repairReserveCredits) return null;

  // ── THE BOUND SOURCE ──────────────────────────────────────────────────────
  // A v2 graph with no binding does not parse at all. That is deliberate: those
  // are the pre-0158 documents, they were priced with no ceiling, and the
  // backend will refuse to approve them — so rendering one as an approvable plan
  // would offer the user a button that cannot work.
  const sourceBinding = parseSourceBinding(v.source_binding, moments);
  if (!sourceBinding) return null;

  return {
    graphDigest: v.graph_digest, moments, tasks, sourceBinding,
    initialCredits, repairReserveCredits, maximumCredits: initialCredits + repairReserveCredits,
    projectionOnly: true, finalRenderAuthorized: false,
    executionMode: v.execution_mode,
  };
}

const SOURCE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_SHA256 = /^[a-f0-9]{64}$/;

/**
 * The signed binding, checked against the graph it claims to bound.
 *
 * Two things beyond shape, and both matter:
 *   - every window must fit inside the binding's OWN declared duration, because
 *     a document that contradicts itself must never be rendered as a plan;
 *   - the window set must be EXACTLY the graph's moments, because a binding
 *     free to omit one could omit precisely the moment that breaks the ceiling.
 */
function parseSourceBinding(
  value: unknown, moments: ReadonlyArray<{ momentId: string; startMs: number; endMs: number }>,
): CompiledSourceBinding | null {
  if (!isObject(value)) return null;
  const runId = value.source_run_id;
  const artifactId = value.source_artifact_id;
  const sha256 = value.source_artifact_sha256;
  const durationMs = value.media_duration_ms;
  if (typeof runId !== 'string' || !SOURCE_UUID.test(runId)) return null;
  if (typeof artifactId !== 'string' || !SOURCE_UUID.test(artifactId)) return null;
  if (typeof sha256 !== 'string' || !SOURCE_SHA256.test(sha256)) return null;
  if (typeof durationMs !== 'number' || !Number.isSafeInteger(durationMs)
    || durationMs < 1 || durationMs > 24 * 60 * 60 * 1000) return null;
  if (!Array.isArray(value.windows) || value.windows.length !== moments.length) return null;

  const byMoment = new Map<string, { momentId: string; startMs: number; endMs: number }>();
  for (const raw of value.windows) {
    if (!isObject(raw)) return null;
    const momentId = raw.moment_id;
    const startMs = raw.start_ms;
    const endMs = raw.end_ms;
    if (typeof momentId !== 'string' || byMoment.has(momentId)) return null;
    if (typeof startMs !== 'number' || !Number.isSafeInteger(startMs)) return null;
    if (typeof endMs !== 'number' || !Number.isSafeInteger(endMs)) return null;
    if (startMs < 0 || endMs <= startMs) return null;
    if (startMs >= durationMs || endMs > durationMs) return null;
    byMoment.set(momentId, { momentId, startMs, endMs });
  }
  // Exactly the graph's moments, with exactly the graph's windows.
  for (const moment of moments) {
    const window = byMoment.get(moment.momentId);
    if (!window || window.startMs !== moment.startMs || window.endMs !== moment.endMs) return null;
  }
  return {
    sourceRunId: runId,
    sourceArtifactId: artifactId,
    sourceArtifactSha256: sha256,
    mediaDurationMs: durationMs,
    windows: moments.map((moment) => byMoment.get(moment.momentId)!),
  };
}

/**
 * Parse a v2 compiled proposal document. Null on ANY violation.
 *
 * The caller must already have routed here through the explicit discriminator
 * (see routeProposalDocument) — this function re-checks the field so it can
 * never be reached with a v1 document, but it is not where routing is decided.
 */
export function parseCompiledProfessionalV2Proposal(v: unknown): CompiledProfessionalV2Proposal | null {
  if (!isObject(v)) return null;
  if (v.control_contract_version !== CONTROL_V2) return null;
  if (v.contract_version !== V2_CONTRACT_VERSION) return null;
  if (v.compiler_version !== V2_COMPILER_VERSION) return null;
  if (v.capability_key !== V2_CAPABILITY_KEY) return null;
  // v2 IS the Professional contract. A v2 document under any other quality mode
  // describes two things at once, exactly as the backend's request-side
  // consistency check refuses.
  if (v.quality_mode !== 'professional') return null;
  if (!isText(v.execution_mode)) return null;
  if (typeof v.availability !== 'boolean') return null;
  if (!isDigest(v.proposal_digest)) return null;

  // The reason exists exactly when the proposal is unavailable. Available with a
  // reason — or unavailable without one — is a self-contradiction, and an
  // unavailable proposal that names NO missing capability tells a user their
  // plan is blocked while refusing to say by what.
  if (!Array.isArray(v.required_missing_capabilities)
    || !v.required_missing_capabilities.every((c) => isText(c))) return null;
  if (v.availability) {
    if (v.unavailable_reason !== null && v.unavailable_reason !== undefined) return null;
    if (v.required_missing_capabilities.length !== 0) return null;
  } else {
    if (!isText(v.unavailable_reason)) return null;
    if (v.required_missing_capabilities.length === 0) return null;
  }

  const graph = parseControlGraph(v.professional_control);
  if (!graph) return null;
  // The envelope and the graph must name the SAME execution mode. A graph
  // compiled for one mode under an envelope advertising another is mixed identity.
  if (graph.executionMode !== v.execution_mode) return null;

  // The envelope restates the graph's totals. They must not be a second opinion.
  if (v.task_count !== graph.tasks.length) return null;
  if (v.maximum_credits !== graph.maximumCredits) return null;
  if (v.initial_credits !== graph.initialCredits) return null;
  if (v.repair_reserve_credits !== graph.repairReserveCredits) return null;

  // An APPROVABLE proposal must propose something. An unavailable one still
  // carries its graph, as a preview — that is how a user sees the plan the
  // capabilities are blocking.
  if (v.availability && graph.tasks.length === 0) return null;

  return {
    contractVersion: v.contract_version as string,
    compilerVersion: v.compiler_version as string,
    capabilityKey: v.capability_key as string,
    qualityMode: 'professional',
    controlContractVersion: CONTROL_V2,
    executionMode: v.execution_mode,
    availability: v.availability,
    unavailableReason: v.availability ? null : (v.unavailable_reason as string),
    requiredMissingCapabilities: v.required_missing_capabilities as string[],
    graphDigest: graph.graphDigest,
    proposalDigest: v.proposal_digest,
    moments: graph.moments,
    tasks: graph.tasks,
    momentCount: graph.moments.length,
    taskCount: graph.tasks.length,
    candidateTaskCount: graph.tasks.filter((t) => t.kind === 'candidate').length,
    repairTaskCount: graph.tasks.filter((t) => t.kind === 'repair').length,
    initialCredits: graph.initialCredits,
    repairReserveCredits: graph.repairReserveCredits,
    maximumCredits: graph.maximumCredits,
    projectionOnly: graph.projectionOnly,
    finalRenderAuthorized: graph.finalRenderAuthorized,
    sourceBinding: graph.sourceBinding,
  };
}
