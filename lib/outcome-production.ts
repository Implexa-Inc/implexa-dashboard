/**
 * lib/outcome-production.ts — the Dashboard's read side of the Outcome
 * Orchestration control-plane contract (OUTCOME_ORCHESTRATION_MVP spec,
 * Session A → Session B).
 *
 * PURE and fail-closed, mirroring lib/live-feed.ts: every parser returns the
 * typed object or `null`, and `null` means UNREADABLE — the caller must render
 * "we can't show this", never an empty/all-clear state. The backend owns
 * ranking, budgets, and plan preparation; nothing here recomputes, ranks,
 * sums, or fills in a default for a missing contract field. Raw scores are not
 * part of the wire contract and are never displayed — only reason codes and
 * the backend's own human-readable reasons.
 */

export type OutcomeQuality = 'fast' | 'balanced' | 'best';

/** Value is identity, label is display — never persist a label. */
export const OUTCOME_QUALITIES: ReadonlyArray<{ value: OutcomeQuality; label: string; hint: string }> = [
  { value: 'fast', label: 'Fast', hint: 'Quickest eligible path.' },
  { value: 'balanced', label: 'Balanced', hint: 'Weighs quality against time and cost.' },
  { value: 'best', label: 'Best', hint: 'Strongest evidence of accepted outcomes.' },
];

export function isOutcomeQuality(v: unknown): v is OutcomeQuality {
  return v === 'fast' || v === 'balanced' || v === 'best';
}

export type InputRef = { id: string; kind: string; name: string; digest: string };

export const OUTCOME_INPUT_TYPES = ['project_bundle', 'presenter_video', 'image', 'document'] as const;
export type OutcomeInputType = typeof OUTCOME_INPUT_TYPES[number];
export type OutcomeInputReference = {
  kind: 'artifact';
  id: string;
  digest: string;
  description: string;
  input_type: OutcomeInputType;
  input_session_id: string;
};

export function suggestOutcomeInputType(displayName: string, mediaType?: string): OutcomeInputType {
  const name = displayName.toLowerCase();
  const media = (mediaType || '').toLowerCase();
  if (name.endsWith('.zip') || /project[-_ ]bundle/.test(name) || media === 'application/zip' || media === 'application/x-zip-compressed') return 'project_bundle';
  if (media.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name)) return 'presenter_video';
  if (media.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|avif|tiff?)$/i.test(name)) return 'image';
  return 'document';
}

export type OutcomeIntent = {
  goal: string;
  run_instructions?: string;
  input_references: OutcomeInputReference[];
  quality: OutcomeQuality;
  deadline_at: string | null;
  max_budget_credits: number;
  consequential_action_ceiling: {
    max_provider_calls: number;
    max_spend_minor: number;
    currency: 'USD';
  };
};

export type PlanNode = {
  ordinal: number;
  role: string;
  workflow_id: string;
  workflow_version_id: string;
  slug: string | null;
  agent: {
    name: string;
    task_key: string | null;
    task_label: string;
    required_input_types: string[];
    output_types: string[];
  } | null;
  budget_credits: number;
  max_duration_ms: number;
  max_retries: number;
  max_invocations: number;
};

export type OutcomePlan = {
  digest: string;
  contract_version: string;
  scorer_version: string;
  weight_set_digest: string;
  intent_digest: string;
  quality: OutcomeQuality;
  deadline_at: string | null;
  nodes: PlanNode[];
  budget: {
    max_budget_credits: number;
    allocations: Array<{ ordinal: number; budget_credits: number }>;
  };
  unresolved_missing_assets: Array<{ kind: string; description: string }>;
  stop_conditions: {
    max_nodes: number;
    sequential_only: boolean;
    on_child_failure: string;
    on_budget_exhausted: string;
    on_cancel: string;
  };
};

export type NoEligible = {
  reasonCode: string;
  message: string;
  exclusions: Array<{ agentName: string; reasonCode: string; detail: string }>;
};

export type PlanOutcome =
  | { kind: 'clarification_required'; clarification: { question: string; choices: Array<{ taskKey: string; label: string; outputTypes: string[] }> } }
  | { kind: 'plan'; productionId: string; intent: OutcomeIntent; plan: OutcomePlan }
  | { kind: 'no_match'; reason: string; message: string }
  | { kind: 'needs_input'; taskKey: string; question: string; missingInputTypes: string[] }
  | { kind: 'no_eligible'; noEligible: NoEligible };

export type ProductionChild = {
  runId: string | null;
  requestId: string | null;
  order: number;
  agentName: string;
  agentVersionId: string;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  budgetAllocationCredits: number;
  spentCredits: number;
  blocker: { reasonCode: string; detail: string } | null;
};

export type Production = {
  id: string;
  workItemId: string;
  state: string;
  /**
   * Whether this production has settled and therefore HAS a receipt.
   *
   * The backend is the authority. `state` is an open vocabulary that will grow,
   * so a consumer that decides settlement by listing terminal state strings
   * silently drops the receipt — the whole account of what was spent and what
   * came back — for every state it has not heard of yet.
   */
  settled: boolean;
  planId: string | null;
  planDigest: string | null;
  goal: string;
  quality: OutcomeQuality;
  budget: { reservedCredits: number; spentCredits: number; maxBudgetCredits: number };
  progress: { completedNodes: number; totalNodes: number };
  blockers: Array<{ reasonCode: string; detail: string }>;
  canCancel: boolean;
  children: ProductionChild[];
};

export type ChildReceipt = {
  runId: string | null;
  requestId: string | null;
  order: number;
  costCredits: number;
  durationSeconds: number | null;
  artifactDigests: string[];
  verification: string;
  judge: string;
};

export type ProductionReceipt = {
  productionId: string;
  workItemId: string;
  receiptDigest: string;
  scorerVersion: string;
  weightSetDigest: string;
  planId: string;
  planDigest: string;
  selectedPath: Array<{ order: number; agentName: string; agentVersionId: string; versionNumber: string }>;
  budget: { reservedCredits: number; spentCredits: number; maxBudgetCredits: number };
  durationSeconds: number | null;
  childReceipts: ChildReceipt[];
  artifacts: Array<{ id: string; name: string; kind: string; digest: string }>;
  review: { state: string };
  outcome: { type: 'success' | 'partial' | 'failure'; reasonCode: string; detail: string | null };
};

// ── strict readers ────────────────────────────────────────────────────
// A drifted body must come back `null`, never a best-effort object. These are
// deliberately verbose: each contract field is asserted for presence AND type,
// because "missing" and "empty" mean different things everywhere downstream.

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strOrNull = (v: unknown): v is string | null => v === null || str(v);

/**
 * A well-formed ISO-4217 code — exactly what Intl.NumberFormat accepts.
 *
 * This is checked HERE rather than at the point of formatting because
 * `toLocaleString` throws RangeError on anything else, and a throw inside
 * render takes the page down. Every other kind of contract drift in this
 * module degrades to an honest "we can't show this" status; without this
 * check, a currency of "US" or "$" would be the one drift that crashes
 * instead.
 */
const currency = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z]{3}$/.test(v);

function readRange(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2 || !num(v[0]) || !num(v[1])) return null;
  return [v[0], v[1]];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const integer = (v: unknown): v is number => Number.isSafeInteger(v);

function readOutcomeInputRefs(v: unknown): OutcomeInputReference[] | null {
  if (!Array.isArray(v)) return null;
  const out: OutcomeInputReference[] = [];
  for (const raw of v) {
    if (!isObj(raw) || raw.kind !== 'artifact' || !str(raw.id) || !UUID.test(raw.id)) return null;
    if (!str(raw.digest) || !SHA256.test(raw.digest) || !str(raw.description)) return null;
    if (!OUTCOME_INPUT_TYPES.includes(raw.input_type as OutcomeInputType)) return null;
    if (!str(raw.input_session_id) || !UUID.test(raw.input_session_id)) return null;
    out.push({ kind: 'artifact', id: raw.id, digest: raw.digest, description: raw.description, input_type: raw.input_type as OutcomeInputType, input_session_id: raw.input_session_id });
  }
  return out;
}

export function parseIntent(v: unknown): OutcomeIntent | null {
  if (!isObj(v) || !str(v.goal) || !isOutcomeQuality(v.quality)) return null;
  if (v.run_instructions !== undefined && !str(v.run_instructions)) return null;
  if (!integer(v.max_budget_credits) || v.max_budget_credits < 0 || !strOrNull(v.deadline_at ?? null)) return null;
  const inputReferences = readOutcomeInputRefs(v.input_references);
  const ceiling = v.consequential_action_ceiling;
  if (!inputReferences || !isObj(ceiling)) return null;
  if (!integer(ceiling.max_provider_calls) || ceiling.max_provider_calls < 0) return null;
  if (!integer(ceiling.max_spend_minor) || ceiling.max_spend_minor < 0 || ceiling.currency !== 'USD') return null;
  return {
    goal: v.goal,
    ...(typeof v.run_instructions === 'string' ? { run_instructions: v.run_instructions } : {}),
    input_references: inputReferences, quality: v.quality,
    deadline_at: (v.deadline_at as string | null) ?? null,
    max_budget_credits: v.max_budget_credits,
    consequential_action_ceiling: {
      max_provider_calls: ceiling.max_provider_calls,
      max_spend_minor: ceiling.max_spend_minor,
      currency: 'USD',
    },
  };
}

function readNode(v: unknown): PlanNode | null {
  if (!isObj(v) || !integer(v.ordinal) || !str(v.role) || !str(v.workflow_id) || !UUID.test(v.workflow_id)) return null;
  if (!str(v.workflow_version_id) || !UUID.test(v.workflow_version_id) || (v.slug !== null && !str(v.slug))) return null;
  if (!integer(v.budget_credits) || v.budget_credits < 0 || !integer(v.max_duration_ms) || v.max_duration_ms < 0) return null;
  if (!integer(v.max_retries) || v.max_retries < 0 || !integer(v.max_invocations) || v.max_invocations < 0) return null;
  let agent: PlanNode['agent'] = null;
  if (v.agent !== undefined) {
    if (!isObj(v.agent) || !str(v.agent.name) || !str(v.agent.task_label)) return null;
    if (v.agent.task_key !== null && !str(v.agent.task_key)) return null;
    if (!Array.isArray(v.agent.required_input_types) || !v.agent.required_input_types.every(str)) return null;
    if (!Array.isArray(v.agent.output_types) || !v.agent.output_types.every(str)) return null;
    agent = {
      name: v.agent.name,
      task_key: v.agent.task_key as string | null,
      task_label: v.agent.task_label,
      required_input_types: v.agent.required_input_types as string[],
      output_types: v.agent.output_types as string[],
    };
  }
  return {
    ordinal: v.ordinal, role: v.role, workflow_id: v.workflow_id,
    workflow_version_id: v.workflow_version_id, slug: v.slug as string | null,
    agent,
    budget_credits: v.budget_credits, max_duration_ms: v.max_duration_ms,
    max_retries: v.max_retries, max_invocations: v.max_invocations,
  };
}

export function parsePlan(v: unknown): OutcomePlan | null {
  if (!isObj(v) || !str(v.contract_version) || !str(v.scorer_version) || !str(v.weight_set_digest)) return null;
  if (!str(v.intent_digest) || !SHA256.test(v.intent_digest) || !isOutcomeQuality(v.quality)) return null;
  if (!strOrNull(v.deadline_at ?? null)) return null;
  const rawDigest = v.digest ?? v.plan_digest ?? v.planDigest;
  if (!str(rawDigest) || !SHA256.test(rawDigest)) return null;
  if (!Array.isArray(v.nodes) || v.nodes.length < 1 || v.nodes.length > 2) return null;
  const nodes: PlanNode[] = [];
  for (let i = 0; i < v.nodes.length; i += 1) {
    const raw = v.nodes[i];
    const node = readNode(raw);
    if (!node || node.ordinal !== i) return null;
    nodes.push(node);
  }
  if (!isObj(v.budget) || !integer(v.budget.max_budget_credits) || v.budget.max_budget_credits < 0 || !Array.isArray(v.budget.allocations)) return null;
  const allocations: OutcomePlan['budget']['allocations'] = [];
  for (const raw of v.budget.allocations) {
    if (!isObj(raw) || !integer(raw.ordinal) || !integer(raw.budget_credits) || raw.budget_credits < 0) return null;
    allocations.push({ ordinal: raw.ordinal, budget_credits: raw.budget_credits });
  }
  if (!Array.isArray(v.unresolved_missing_assets)) return null;
  const unresolved: OutcomePlan['unresolved_missing_assets'] = [];
  for (const raw of v.unresolved_missing_assets) {
    if (!isObj(raw) || !str(raw.kind) || !str(raw.description)) return null;
    unresolved.push({ kind: raw.kind, description: raw.description });
  }
  const stop = v.stop_conditions;
  if (!isObj(stop) || stop.max_nodes !== 2 || stop.sequential_only !== true) return null;
  if (!str(stop.on_child_failure) || !str(stop.on_budget_exhausted) || !str(stop.on_cancel)) return null;
  return {
    digest: rawDigest, contract_version: v.contract_version, scorer_version: v.scorer_version,
    weight_set_digest: v.weight_set_digest, intent_digest: v.intent_digest,
    quality: v.quality, deadline_at: (v.deadline_at as string | null) ?? null,
    nodes, budget: { max_budget_credits: v.budget.max_budget_credits, allocations },
    unresolved_missing_assets: unresolved,
    stop_conditions: {
      max_nodes: stop.max_nodes, sequential_only: stop.sequential_only,
      on_child_failure: stop.on_child_failure, on_budget_exhausted: stop.on_budget_exhausted,
      on_cancel: stop.on_cancel,
    },
  };
}

export function parseNoEligible(v: unknown): NoEligible | null {
  if (!isObj(v) || !str(v.reasonCode) || !str(v.message) || !Array.isArray(v.exclusions)) return null;
  const exclusions: NoEligible['exclusions'] = [];
  for (const raw of v.exclusions) {
    if (!isObj(raw) || !str(raw.agentName) || !str(raw.reasonCode) || !str(raw.detail)) return null;
    exclusions.push({ agentName: raw.agentName, reasonCode: raw.reasonCode, detail: raw.detail });
  }
  return { reasonCode: v.reasonCode, message: v.message, exclusions };
}

/**
 * Parse the POST /prepare response envelope. `null` means the answer was
 * unreadable and the surface must fail closed — "no eligible agent" is a
 * successful, explicit answer (`kind: 'no_eligible'`), never a fallback for a
 * body we did not understand.
 */
export function parsePlanResponse(v: unknown): PlanOutcome | null {
  if (!isObj(v) || v.ok !== true) return null;
  if (v.kind === 'clarification_required') {
    if (!isObj(v.clarification) || !str(v.clarification.question) || !Array.isArray(v.clarification.choices) || v.clarification.choices.length === 0) return null;
    const choices: Array<{ taskKey: string; label: string; outputTypes: string[] }> = [];
    for (const raw of v.clarification.choices) {
      if (!isObj(raw) || !str(raw.taskKey) || !str(raw.label) || !Array.isArray(raw.outputTypes) || !raw.outputTypes.every(str)) return null;
      choices.push({ taskKey: raw.taskKey, label: raw.label, outputTypes: raw.outputTypes as string[] });
    }
    return { kind: 'clarification_required', clarification: { question: v.clarification.question, choices } };
  }
  if (v.kind === 'plan') {
    if (!str(v.productionId) || !UUID.test(v.productionId)) return null;
    const intent = parseIntent(v.intent);
    const plan = parsePlan(v.plan);
    if (!intent || !plan) return null;
    if (intent.quality !== plan.quality || intent.max_budget_credits !== plan.budget.max_budget_credits) return null;
    return { kind: 'plan', productionId: v.productionId, intent, plan };
  }
  if (v.kind === 'no_match') {
    if (!str(v.reason) || !str(v.message)) return null;
    return { kind: 'no_match', reason: v.reason, message: v.message };
  }
  if (v.kind === 'needs_input') {
    if (!str(v.taskKey) || !str(v.question) || !Array.isArray(v.missingInputTypes) || v.missingInputTypes.length === 0 || !v.missingInputTypes.every(str)) return null;
    return { kind: 'needs_input', taskKey: v.taskKey, question: v.question, missingInputTypes: v.missingInputTypes as string[] };
  }
  if (v.kind === 'no_eligible') {
    const noEligible = parseNoEligible(v.noEligible ?? v);
    if (!noEligible) return null;
    return { kind: 'no_eligible', noEligible };
  }
  return null;
}

function readChild(v: unknown): ProductionChild | null {
  if (!isObj(v) || !strOrNull(v.runId ?? null) || !strOrNull(v.requestId ?? null) || !num(v.order) || !str(v.agentName) || !str(v.agentVersionId)) return null;
  if (!str(v.state) || !num(v.budgetAllocationCredits) || !num(v.spentCredits)) return null;
  if (!strOrNull(v.startedAt ?? null) || !strOrNull(v.finishedAt ?? null)) return null;
  let blocker: ProductionChild['blocker'] = null;
  if (v.blocker !== null && v.blocker !== undefined) {
    if (!isObj(v.blocker) || !str(v.blocker.reasonCode) || !str(v.blocker.detail)) return null;
    blocker = { reasonCode: v.blocker.reasonCode, detail: v.blocker.detail };
  }
  return {
    runId: (v.runId as string | null) ?? null, requestId: (v.requestId as string | null) ?? null, order: v.order, agentName: v.agentName, agentVersionId: v.agentVersionId,
    state: v.state, startedAt: (v.startedAt as string | null) ?? null, finishedAt: (v.finishedAt as string | null) ?? null,
    budgetAllocationCredits: v.budgetAllocationCredits, spentCredits: v.spentCredits, blocker,
  };
}

export function parseProduction(v: unknown): Production | null {
  if (!isObj(v) || !str(v.id) || !str(v.workItemId) || !str(v.state)) return null;
  if (typeof v.settled !== 'boolean') return null;
  if (!strOrNull(v.planId ?? null) || !strOrNull(v.planDigest ?? null) || !str(v.goal) || !isOutcomeQuality(v.quality)) return null;
  const planId = (v.planId as string | null) ?? null;
  const planDigest = (v.planDigest as string | null) ?? null;
  if ((planId === null) !== (planDigest === null)) return null;
  const b = v.budget;
  if (!isObj(b) || !num(b.reservedCredits) || !num(b.spentCredits) || !num(b.maxBudgetCredits)) return null;
  const p = v.progress;
  if (!isObj(p) || !num(p.completedNodes) || !num(p.totalNodes)) return null;
  if (typeof v.canCancel !== 'boolean') return null;
  if (!Array.isArray(v.blockers)) return null;
  const blockers: Production['blockers'] = [];
  for (const raw of v.blockers) {
    if (!isObj(raw) || !str(raw.reasonCode) || !str(raw.detail)) return null;
    blockers.push({ reasonCode: raw.reasonCode, detail: raw.detail });
  }
  if (!Array.isArray(v.children)) return null;
  const children: ProductionChild[] = [];
  for (const raw of v.children) {
    const child = readChild(raw);
    if (!child) return null;
    children.push(child);
  }
  return {
    id: v.id, workItemId: v.workItemId, state: v.state, settled: v.settled,
    planId, planDigest,
    goal: v.goal, quality: v.quality,
    budget: { reservedCredits: b.reservedCredits, spentCredits: b.spentCredits, maxBudgetCredits: b.maxBudgetCredits },
    progress: { completedNodes: p.completedNodes, totalNodes: p.totalNodes },
    blockers, canCancel: v.canCancel, children,
  };
}

export function parseProductionResponse(v: unknown): Production | null {
  if (!isObj(v) || v.ok !== true) return null;
  return parseProduction(v.production);
}

/**
 * The owner's productions, newest first. One drifted member makes the WHOLE
 * list unreadable: a partially-parsed list rendered as complete would tell the
 * user "these are your productions" while silently omitting one that may be
 * running and spending ([[parseLiveItems discipline]]).
 */
export function parseProductionListResponse(v: unknown): Production[] | null {
  if (!isObj(v) || v.ok !== true || !Array.isArray(v.productions)) return null;
  const out: Production[] = [];
  for (const raw of v.productions) {
    const production = parseProduction(raw);
    if (!production) return null;
    out.push(production);
  }
  return out;
}

export function parseReceipt(v: unknown): ProductionReceipt | null {
  if (!isObj(v) || !str(v.productionId) || !str(v.workItemId)) return null;
  if (!str(v.receiptDigest) || !str(v.scorerVersion) || !str(v.weightSetDigest) || !str(v.planId) || !str(v.planDigest)) return null;
  if (!Array.isArray(v.selectedPath) || v.selectedPath.length < 1) return null;
  const selectedPath: ProductionReceipt['selectedPath'] = [];
  for (const raw of v.selectedPath) {
    if (!isObj(raw) || !num(raw.order) || !str(raw.agentName) || !str(raw.agentVersionId) || !str(raw.versionNumber)) return null;
    selectedPath.push({ order: raw.order, agentName: raw.agentName, agentVersionId: raw.agentVersionId, versionNumber: raw.versionNumber });
  }
  const b = v.budget;
  if (!isObj(b) || !num(b.reservedCredits) || !num(b.spentCredits) || !num(b.maxBudgetCredits)) return null;
  if (v.durationSeconds !== null && !num(v.durationSeconds)) return null;
  if (!Array.isArray(v.childReceipts)) return null;
  const childReceipts: ChildReceipt[] = [];
  for (const raw of v.childReceipts) {
    if (!isObj(raw) || !strOrNull(raw.runId ?? null) || !strOrNull(raw.requestId ?? null) || !num(raw.order) || !num(raw.costCredits)) return null;
    if (raw.durationSeconds !== null && !num(raw.durationSeconds)) return null;
    if (!str(raw.verification) || !str(raw.judge)) return null;
    if (!Array.isArray(raw.artifactDigests) || !raw.artifactDigests.every(str)) return null;
    childReceipts.push({
      runId: (raw.runId as string | null) ?? null, requestId: (raw.requestId as string | null) ?? null, order: raw.order, costCredits: raw.costCredits,
      durationSeconds: (raw.durationSeconds as number | null) ?? null, artifactDigests: raw.artifactDigests as string[],
      verification: raw.verification, judge: raw.judge,
    });
  }
  if (!Array.isArray(v.artifacts)) return null;
  const artifacts: ProductionReceipt['artifacts'] = [];
  for (const raw of v.artifacts) {
    if (!isObj(raw) || !str(raw.id) || !str(raw.name) || !str(raw.kind) || !str(raw.digest)) return null;
    artifacts.push({ id: raw.id, name: raw.name, kind: raw.kind, digest: raw.digest });
  }
  if (!isObj(v.review) || !str(v.review.state)) return null;
  const o = v.outcome;
  if (!isObj(o) || (o.type !== 'success' && o.type !== 'partial' && o.type !== 'failure')) return null;
  if (!str(o.reasonCode) || !strOrNull(o.detail ?? null)) return null;
  return {
    productionId: v.productionId, workItemId: v.workItemId,
    receiptDigest: v.receiptDigest, scorerVersion: v.scorerVersion, weightSetDigest: v.weightSetDigest,
    planId: v.planId, planDigest: v.planDigest,
    selectedPath,
    budget: { reservedCredits: b.reservedCredits, spentCredits: b.spentCredits, maxBudgetCredits: b.maxBudgetCredits },
    durationSeconds: (v.durationSeconds as number | null) ?? null,
    childReceipts, artifacts,
    review: { state: v.review.state },
    outcome: { type: o.type, reasonCode: o.reasonCode, detail: (o.detail as string | null) ?? null },
  };
}

export function parseReceiptResponse(v: unknown): ProductionReceipt | null {
  if (!isObj(v) || v.ok !== true) return null;
  return parseReceipt(v.receipt);
}

// ── display helpers ───────────────────────────────────────────────────
// Formatting only. Nothing is summed, priced, or rounded here — every figure
// is the backend's verbatim, converted from minor units for display exactly
// like _components/marketplace-execution-requirements.tsx.

export function formatMinor(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency });
}

export function formatMinorRange(range: [number, number], currency: string): string {
  return `${formatMinor(range[0], currency)}–${formatMinor(range[1], currency)}`;
}

export function formatDurationRange(range: [number, number]): string {
  const minutes = (s: number) => Math.round(s / 60);
  return `${minutes(range[0])}–${minutes(range[1])} min`;
}

/**
 * Start is offered ONLY for a server-prepared plan with nothing left to set
 * up. This is a display gate, not the authority — the backend re-checks the
 * production id + plan digest at start time.
 */
export function canStartPlan(plan: OutcomePlan): boolean {
  return plan.unresolved_missing_assets.length === 0;
}

/**
 * Whether the monitor should keep re-reading this production.
 *
 * Unsettled work changes while the user watches — children finish and real
 * money moves — so a page that never re-reads shows a snapshot that quietly
 * becomes a lie. Settled work never changes again, so polling it is pure noise.
 */
export function shouldPollProduction(production: Production): boolean {
  return !production.settled;
}
