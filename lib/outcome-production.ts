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

export type OutcomeIntent = {
  id: string;
  goal: string;
  inputRefs: InputRef[];
  quality: OutcomeQuality;
  deadline: string | null;
  maxBudgetCents: number;
  currency: string;
  digest: string;
};

export type PlanNode = {
  order: number;
  agentVersionId: string;
  agentId: string;
  agentName: string;
  versionNumber: string;
  reasonCode: string;
  reasons: string[];
  estimatedCostCentsRange: [number, number];
  estimatedDurationSecondsRange: [number, number];
  budgetAllocationCents: number;
  retryLimit: number;
  stopConditions: string[];
};

export type PlanMissingSetup = { agentVersionId: string; item: string; ownerAction: string };
export type PlanApproval = { kind: string; description: string; ceilingCents: number };

export type OutcomePlan = {
  id: string;
  intentId: string;
  scorerVersion: string;
  weightSetVersion: string;
  state: 'prepared' | 'blocked_on_setup';
  nodes: PlanNode[];
  inputs: InputRef[];
  totalEstimatedCostCentsRange: [number, number];
  maxBudgetCents: number;
  currency: string;
  missingSetup: PlanMissingSetup[];
  approvals: PlanApproval[];
  expiresAt: string;
  digest: string;
};

export type NoEligible = {
  reasonCode: string;
  message: string;
  exclusions: Array<{ agentName: string; reasonCode: string; detail: string }>;
};

export type PlanOutcome =
  | { kind: 'plan'; intent: OutcomeIntent; plan: OutcomePlan }
  | { kind: 'no_eligible'; noEligible: NoEligible };

export type ProductionChild = {
  runId: string;
  order: number;
  agentName: string;
  agentVersionId: string;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  budgetAllocationCents: number;
  spentCents: number;
  blocker: { reasonCode: string; detail: string } | null;
};

export type Production = {
  id: string;
  workItemId: string;
  state: string;
  planId: string;
  planDigest: string;
  goal: string;
  quality: OutcomeQuality;
  budget: { reservedCents: number; spentCents: number; maxBudgetCents: number; currency: string };
  progress: { completedNodes: number; totalNodes: number };
  blockers: Array<{ reasonCode: string; detail: string }>;
  canCancel: boolean;
  children: ProductionChild[];
};

export type ChildReceipt = {
  runId: string;
  order: number;
  costCents: number;
  durationSeconds: number;
  artifactDigest: string | null;
  verification: string;
  judge: string;
};

export type ProductionReceipt = {
  productionId: string;
  workItemId: string;
  scorerVersion: string;
  weightSetVersion: string;
  planId: string;
  planDigest: string;
  selectedPath: Array<{ order: number; agentName: string; agentVersionId: string; versionNumber: string }>;
  totals: { costCents: number; durationSeconds: number; reservedCents: number; refundedCents: number; currency: string };
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

function readRange(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2 || !num(v[0]) || !num(v[1])) return null;
  return [v[0], v[1]];
}

function readInputRef(v: unknown): InputRef | null {
  if (!isObj(v) || !str(v.id) || !str(v.kind) || !str(v.name) || !str(v.digest)) return null;
  return { id: v.id, kind: v.kind, name: v.name, digest: v.digest };
}

function readInputRefs(v: unknown): InputRef[] | null {
  if (!Array.isArray(v)) return null;
  const out: InputRef[] = [];
  for (const raw of v) {
    const ref = readInputRef(raw);
    if (!ref) return null;
    out.push(ref);
  }
  return out;
}

export function parseIntent(v: unknown): OutcomeIntent | null {
  if (!isObj(v) || !str(v.id) || !str(v.goal) || !isOutcomeQuality(v.quality)) return null;
  if (!num(v.maxBudgetCents) || !str(v.currency) || !str(v.digest)) return null;
  if (!strOrNull(v.deadline ?? null)) return null;
  const inputRefs = readInputRefs(v.inputRefs);
  if (!inputRefs) return null;
  return {
    id: v.id, goal: v.goal, inputRefs, quality: v.quality,
    deadline: (v.deadline as string | null) ?? null,
    maxBudgetCents: v.maxBudgetCents, currency: v.currency, digest: v.digest,
  };
}

function readNode(v: unknown): PlanNode | null {
  if (!isObj(v) || !num(v.order) || !str(v.agentVersionId) || !str(v.agentId)) return null;
  if (!str(v.agentName) || !str(v.versionNumber) || !str(v.reasonCode)) return null;
  if (!Array.isArray(v.reasons) || !v.reasons.every(str) || v.reasons.length === 0) return null;
  const cost = readRange(v.estimatedCostCentsRange);
  const duration = readRange(v.estimatedDurationSecondsRange);
  if (!cost || !duration || !num(v.budgetAllocationCents) || !num(v.retryLimit)) return null;
  if (!Array.isArray(v.stopConditions) || !v.stopConditions.every(str)) return null;
  return {
    order: v.order, agentVersionId: v.agentVersionId, agentId: v.agentId,
    agentName: v.agentName, versionNumber: v.versionNumber,
    reasonCode: v.reasonCode, reasons: v.reasons as string[],
    estimatedCostCentsRange: cost, estimatedDurationSecondsRange: duration,
    budgetAllocationCents: v.budgetAllocationCents, retryLimit: v.retryLimit,
    stopConditions: v.stopConditions as string[],
  };
}

export function parsePlan(v: unknown): OutcomePlan | null {
  if (!isObj(v) || !str(v.id) || !str(v.intentId) || !str(v.scorerVersion) || !str(v.weightSetVersion)) return null;
  if (v.state !== 'prepared' && v.state !== 'blocked_on_setup') return null;
  if (!Array.isArray(v.nodes) || v.nodes.length < 1 || v.nodes.length > 2) return null;
  const nodes: PlanNode[] = [];
  for (const raw of v.nodes) {
    const node = readNode(raw);
    if (!node) return null;
    nodes.push(node);
  }
  const inputs = readInputRefs(v.inputs);
  const total = readRange(v.totalEstimatedCostCentsRange);
  if (!inputs || !total || !num(v.maxBudgetCents) || !str(v.currency) || !str(v.expiresAt) || !str(v.digest)) return null;
  if (!Array.isArray(v.missingSetup)) return null;
  const missingSetup: PlanMissingSetup[] = [];
  for (const raw of v.missingSetup) {
    if (!isObj(raw) || !str(raw.agentVersionId) || !str(raw.item) || !str(raw.ownerAction)) return null;
    missingSetup.push({ agentVersionId: raw.agentVersionId, item: raw.item, ownerAction: raw.ownerAction });
  }
  if (!Array.isArray(v.approvals)) return null;
  const approvals: PlanApproval[] = [];
  for (const raw of v.approvals) {
    if (!isObj(raw) || !str(raw.kind) || !str(raw.description) || !num(raw.ceilingCents)) return null;
    approvals.push({ kind: raw.kind, description: raw.description, ceilingCents: raw.ceilingCents });
  }
  return {
    id: v.id, intentId: v.intentId, scorerVersion: v.scorerVersion, weightSetVersion: v.weightSetVersion,
    state: v.state, nodes, inputs, totalEstimatedCostCentsRange: total,
    maxBudgetCents: v.maxBudgetCents, currency: v.currency,
    missingSetup, approvals, expiresAt: v.expiresAt, digest: v.digest,
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
 * Parse the POST /plan response envelope. `null` means the answer was
 * unreadable and the surface must fail closed — "no eligible agent" is a
 * successful, explicit answer (`kind: 'no_eligible'`), never a fallback for a
 * body we did not understand.
 */
export function parsePlanResponse(v: unknown): PlanOutcome | null {
  if (!isObj(v) || v.ok !== true) return null;
  if (v.result === 'plan') {
    const intent = parseIntent(v.intent);
    const plan = parsePlan(v.plan);
    if (!intent || !plan) return null;
    return { kind: 'plan', intent, plan };
  }
  if (v.result === 'no_eligible') {
    const noEligible = parseNoEligible(v.noEligible);
    if (!noEligible) return null;
    return { kind: 'no_eligible', noEligible };
  }
  return null;
}

function readChild(v: unknown): ProductionChild | null {
  if (!isObj(v) || !str(v.runId) || !num(v.order) || !str(v.agentName) || !str(v.agentVersionId)) return null;
  if (!str(v.state) || !num(v.budgetAllocationCents) || !num(v.spentCents)) return null;
  if (!strOrNull(v.startedAt ?? null) || !strOrNull(v.finishedAt ?? null)) return null;
  let blocker: ProductionChild['blocker'] = null;
  if (v.blocker !== null && v.blocker !== undefined) {
    if (!isObj(v.blocker) || !str(v.blocker.reasonCode) || !str(v.blocker.detail)) return null;
    blocker = { reasonCode: v.blocker.reasonCode, detail: v.blocker.detail };
  }
  return {
    runId: v.runId, order: v.order, agentName: v.agentName, agentVersionId: v.agentVersionId,
    state: v.state, startedAt: (v.startedAt as string | null) ?? null, finishedAt: (v.finishedAt as string | null) ?? null,
    budgetAllocationCents: v.budgetAllocationCents, spentCents: v.spentCents, blocker,
  };
}

export function parseProduction(v: unknown): Production | null {
  if (!isObj(v) || !str(v.id) || !str(v.workItemId) || !str(v.state)) return null;
  if (!str(v.planId) || !str(v.planDigest) || !str(v.goal) || !isOutcomeQuality(v.quality)) return null;
  const b = v.budget;
  if (!isObj(b) || !num(b.reservedCents) || !num(b.spentCents) || !num(b.maxBudgetCents) || !str(b.currency)) return null;
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
    id: v.id, workItemId: v.workItemId, state: v.state, planId: v.planId, planDigest: v.planDigest,
    goal: v.goal, quality: v.quality,
    budget: { reservedCents: b.reservedCents, spentCents: b.spentCents, maxBudgetCents: b.maxBudgetCents, currency: b.currency },
    progress: { completedNodes: p.completedNodes, totalNodes: p.totalNodes },
    blockers, canCancel: v.canCancel, children,
  };
}

export function parseProductionResponse(v: unknown): Production | null {
  if (!isObj(v) || v.ok !== true) return null;
  return parseProduction(v.production);
}

export function parseReceipt(v: unknown): ProductionReceipt | null {
  if (!isObj(v) || !str(v.productionId) || !str(v.workItemId)) return null;
  if (!str(v.scorerVersion) || !str(v.weightSetVersion) || !str(v.planId) || !str(v.planDigest)) return null;
  if (!Array.isArray(v.selectedPath) || v.selectedPath.length < 1) return null;
  const selectedPath: ProductionReceipt['selectedPath'] = [];
  for (const raw of v.selectedPath) {
    if (!isObj(raw) || !num(raw.order) || !str(raw.agentName) || !str(raw.agentVersionId) || !str(raw.versionNumber)) return null;
    selectedPath.push({ order: raw.order, agentName: raw.agentName, agentVersionId: raw.agentVersionId, versionNumber: raw.versionNumber });
  }
  const t = v.totals;
  if (!isObj(t) || !num(t.costCents) || !num(t.durationSeconds) || !num(t.reservedCents) || !num(t.refundedCents) || !str(t.currency)) return null;
  if (!Array.isArray(v.childReceipts)) return null;
  const childReceipts: ChildReceipt[] = [];
  for (const raw of v.childReceipts) {
    if (!isObj(raw) || !str(raw.runId) || !num(raw.order) || !num(raw.costCents) || !num(raw.durationSeconds)) return null;
    if (!str(raw.verification) || !str(raw.judge)) return null;
    if (!strOrNull(raw.artifactDigest ?? null)) return null;
    childReceipts.push({
      runId: raw.runId, order: raw.order, costCents: raw.costCents, durationSeconds: raw.durationSeconds,
      artifactDigest: (raw.artifactDigest as string | null) ?? null,
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
    scorerVersion: v.scorerVersion, weightSetVersion: v.weightSetVersion,
    planId: v.planId, planDigest: v.planDigest,
    selectedPath, totals: { costCents: t.costCents, durationSeconds: t.durationSeconds, reservedCents: t.reservedCents, refundedCents: t.refundedCents, currency: t.currency },
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
 * plan id + digest at start time.
 */
export function canStartPlan(plan: OutcomePlan): boolean {
  return plan.state === 'prepared' && plan.missingSetup.length === 0;
}
