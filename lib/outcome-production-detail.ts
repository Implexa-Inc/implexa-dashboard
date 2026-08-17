/**
 * lib/outcome-production-detail.ts — the Dashboard's read side of the
 * canonical multi-agent Production detail contract.
 *
 * Same discipline as lib/outcome-production.ts and for the same reason: every
 * parser returns the typed object or `null`, and `null` means UNREADABLE, so
 * the Production page renders "we can't show this" rather than a confident
 * page missing an agent, a handoff, or the engine a node actually ran on.
 *
 * Nothing here derives, sums, or guesses. In particular:
 *   · an engine is only ever what the backend recorded — this module has no
 *     fallback to a workflow default or to the requested engine;
 *   · a handoff's artifact identity comes from the handoff row, never from a
 *     node's own artifact list, so a digest cannot cross agents;
 *   · a trace entry without a timestamp and a source is rejected outright,
 *     because an event that cannot say where it came from is not evidence.
 */

import type { Production } from './outcome-production.ts';

export type ExecutionEngine = 'claude' | 'codex';

export type NodeStepStatus = 'pending' | 'running' | 'done' | 'failed';
export type NodeStep = { index: number; label: string | null; status: NodeStepStatus };
export type NodeTraceEntry = { at: string; step: string | null; note: string | null };

export type NodeArtifact = {
  id: string | null;
  runId: string;
  name: string | null;
  relativePath: string | null;
  /**
   * The desktop-resolved absolute path, present only for a validated artifact
   * inside this production's lineage — exactly the file the existing Open /
   * Reveal bridge is already authorised to act on. Never rendered as prose.
   */
  validatedPath: string | null;
  role: string | null;
  digest: string | null;
  sizeBytes: number | null;
  validatedAt: string | null;
};

export type NodeExecution = {
  grantId: string;
  requestId: string | null;
  runId: string | null;
  state: string;
  grantState: string;
  outcomeLabel: string | null;
  startedAt: string | null;
  completedAt: string | null;
  runStartedAt: string | null;
  runCompletedAt: string | null;
  durationMs: number | null;
  requestedEngine: ExecutionEngine | null;
  selectedExecutor: ExecutionEngine | null;
  actualEngine: ExecutionEngine | null;
  failover: boolean;
  failoverReason: string | null;
  avoidedEngine: ExecutionEngine | null;
  engineObservedAt: string | null;
  verificationStatus: string | null;
  completenessStatus: string | null;
  creditsSpent: number | null;
  budgetCredits: number | null;
  failureReason: string | null;
  stepSummary: { done: number; total: number } | null;
  steps: NodeStep[];
  trace: NodeTraceEntry[];
  artifacts: NodeArtifact[];
  /** Which bounded lists the backend had to cut, so the page can say so. */
  truncated: string[];
};

export type ProductionNode = {
  ordinal: number;
  agentName: string;
  workflowId: string;
  agentVersionId: string;
  versionNumber: string;
  role: string | null;
  taskLabel: string | null;
  expectedArtifact: { kind: string | null; description: string | null } | null;
  execution: NodeExecution;
};

export type HandoffState = 'pending' | 'validated' | 'accepted' | 'blocked' | 'failed';

export type ProductionHandoff = {
  producerOrdinal: number;
  consumerOrdinal: number;
  producerAgentName: string | null;
  consumerAgentName: string | null;
  artifactId: string | null;
  artifactName: string | null;
  artifactKind: string | null;
  digest: string | null;
  digestPrefix: string | null;
  validationStatus: string;
  validatedAt: string | null;
  dispatchedAt: string | null;
  state: HandoffState;
  failureReason: string | null;
};

export type TraceSource = 'outcome_production_events' | 'run_execution_contexts' | 'run_artifacts';

export type ProductionTraceEntry = {
  at: string;
  type: string;
  source: TraceSource;
  /** The node this event belongs to, or null for a parent-level event. */
  ordinal: number | null;
  detail: Record<string, unknown>;
};

export type FinalDeliverable = NodeArtifact & { ordinal: number; agentName: string };

export type ProductionDetail = Production & {
  nodes: ProductionNode[];
  handoffs: ProductionHandoff[];
  trace: ProductionTraceEntry[];
  traceTruncated: boolean;
  finalDeliverable: FinalDeliverable | null;
};

/**
 * What the run permalink must say about a run that belongs to a production.
 *
 * `superseded` is the load-bearing field: it is the difference between "this
 * run stalled" and "this execution attempt was superseded by a related run
 * that completed". The backend decides it from the parent's persisted lineage;
 * this surface never re-derives it from run state.
 */
export type ProductionLineage = {
  productionId: string;
  productionState: string;
  productionGoal: string | null;
  settled: boolean;
  ordinal: number;
  agentName: string | null;
  role: string | null;
  nodeState: string;
  nodeOutcomeLabel: string | null;
  nodeFailureReason: string | null;
  viewedRunId: string | null;
  authoritativeRunId: string | null;
  isAuthoritative: boolean;
  superseded: boolean;
  authoritativeRunState: string | null;
  authoritativeRunStatus: string | null;
  authoritativeRunCompletedAt: string | null;
  suppressRunAgain: boolean;
};

// ── strict readers ────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const strOrNull = (v: unknown): v is string | null => v === null || str(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v);
const intOrNull = (v: unknown): v is number | null => v === null || integer(v);
const bool = (v: unknown): v is boolean => typeof v === 'boolean';

const ENGINES: ReadonlyArray<ExecutionEngine> = ['claude', 'codex'];
function engineOrNull(v: unknown): ExecutionEngine | null | undefined {
  if (v === null || v === undefined) return null;
  return ENGINES.includes(v as ExecutionEngine) ? (v as ExecutionEngine) : undefined;
}

const TRACE_SOURCES: ReadonlyArray<TraceSource> = [
  'outcome_production_events', 'run_execution_contexts', 'run_artifacts',
];
const HANDOFF_STATES: ReadonlyArray<HandoffState> = [
  'pending', 'validated', 'accepted', 'blocked', 'failed',
];

function readStep(v: unknown): NodeStep | null {
  if (!isObj(v) || !integer(v.index) || !strOrNull(v.label ?? null)) return null;
  if (v.status !== 'pending' && v.status !== 'running' && v.status !== 'done' && v.status !== 'failed') return null;
  return { index: v.index, label: (v.label as string | null) ?? null, status: v.status };
}

function readTraceEntry(v: unknown): NodeTraceEntry | null {
  if (!isObj(v) || !str(v.at) || !strOrNull(v.step ?? null) || !strOrNull(v.note ?? null)) return null;
  return { at: v.at, step: (v.step as string | null) ?? null, note: (v.note as string | null) ?? null };
}

function readArtifact(v: unknown): NodeArtifact | null {
  if (!isObj(v) || !strOrNull(v.id ?? null) || !str(v.runId)) return null;
  if (!strOrNull(v.name ?? null) || !strOrNull(v.relativePath ?? null)) return null;
  if (!strOrNull(v.validatedPath ?? null) || !strOrNull(v.role ?? null) || !strOrNull(v.digest ?? null)) return null;
  if (!intOrNull(v.sizeBytes ?? null) || !strOrNull(v.validatedAt ?? null)) return null;
  return {
    id: (v.id as string | null) ?? null,
    runId: v.runId,
    name: (v.name as string | null) ?? null,
    relativePath: (v.relativePath as string | null) ?? null,
    validatedPath: (v.validatedPath as string | null) ?? null,
    role: (v.role as string | null) ?? null,
    digest: (v.digest as string | null) ?? null,
    sizeBytes: (v.sizeBytes as number | null) ?? null,
    validatedAt: (v.validatedAt as string | null) ?? null,
  };
}

function readExecution(v: unknown): NodeExecution | null {
  if (!isObj(v) || !str(v.grantId) || !strOrNull(v.requestId ?? null) || !strOrNull(v.runId ?? null)) return null;
  if (!str(v.state) || !str(v.grantState) || !strOrNull(v.outcomeLabel ?? null)) return null;
  for (const key of ['startedAt', 'completedAt', 'runStartedAt', 'runCompletedAt', 'engineObservedAt',
    'verificationStatus', 'completenessStatus', 'failureReason', 'failoverReason']) {
    if (!strOrNull(v[key] ?? null)) return null;
  }
  for (const key of ['durationMs', 'creditsSpent', 'budgetCredits']) {
    if (!intOrNull(v[key] ?? null)) return null;
  }
  const requestedEngine = engineOrNull(v.requestedEngine);
  const selectedExecutor = engineOrNull(v.selectedExecutor);
  const actualEngine = engineOrNull(v.actualEngine);
  const avoidedEngine = engineOrNull(v.avoidedEngine);
  if (requestedEngine === undefined || selectedExecutor === undefined
    || actualEngine === undefined || avoidedEngine === undefined) return null;
  if (!bool(v.failover)) return null;

  let stepSummary: NodeExecution['stepSummary'] = null;
  if (v.stepSummary !== null && v.stepSummary !== undefined) {
    if (!isObj(v.stepSummary) || !integer(v.stepSummary.done) || !integer(v.stepSummary.total)) return null;
    stepSummary = { done: v.stepSummary.done, total: v.stepSummary.total };
  }
  if (!Array.isArray(v.steps) || !Array.isArray(v.trace) || !Array.isArray(v.artifacts)) return null;
  if (!Array.isArray(v.truncated) || !v.truncated.every(str)) return null;

  const steps: NodeStep[] = [];
  for (const raw of v.steps) { const step = readStep(raw); if (!step) return null; steps.push(step); }
  const trace: NodeTraceEntry[] = [];
  for (const raw of v.trace) { const entry = readTraceEntry(raw); if (!entry) return null; trace.push(entry); }
  const artifacts: NodeArtifact[] = [];
  for (const raw of v.artifacts) { const artifact = readArtifact(raw); if (!artifact) return null; artifacts.push(artifact); }

  return {
    grantId: v.grantId,
    requestId: (v.requestId as string | null) ?? null,
    runId: (v.runId as string | null) ?? null,
    state: v.state,
    grantState: v.grantState,
    outcomeLabel: (v.outcomeLabel as string | null) ?? null,
    startedAt: (v.startedAt as string | null) ?? null,
    completedAt: (v.completedAt as string | null) ?? null,
    runStartedAt: (v.runStartedAt as string | null) ?? null,
    runCompletedAt: (v.runCompletedAt as string | null) ?? null,
    durationMs: (v.durationMs as number | null) ?? null,
    requestedEngine, selectedExecutor, actualEngine, avoidedEngine,
    failover: v.failover,
    failoverReason: (v.failoverReason as string | null) ?? null,
    engineObservedAt: (v.engineObservedAt as string | null) ?? null,
    verificationStatus: (v.verificationStatus as string | null) ?? null,
    completenessStatus: (v.completenessStatus as string | null) ?? null,
    creditsSpent: (v.creditsSpent as number | null) ?? null,
    budgetCredits: (v.budgetCredits as number | null) ?? null,
    failureReason: (v.failureReason as string | null) ?? null,
    stepSummary, steps, trace, artifacts,
    truncated: v.truncated as string[],
  };
}

function readNode(v: unknown): ProductionNode | null {
  if (!isObj(v) || !integer(v.ordinal) || !str(v.agentName) || !str(v.workflowId)) return null;
  if (!str(v.agentVersionId) || !str(v.versionNumber)) return null;
  if (!strOrNull(v.role ?? null) || !strOrNull(v.taskLabel ?? null)) return null;
  let expectedArtifact: ProductionNode['expectedArtifact'] = null;
  if (v.expectedArtifact !== null && v.expectedArtifact !== undefined) {
    if (!isObj(v.expectedArtifact)) return null;
    if (!strOrNull(v.expectedArtifact.kind ?? null) || !strOrNull(v.expectedArtifact.description ?? null)) return null;
    expectedArtifact = {
      kind: (v.expectedArtifact.kind as string | null) ?? null,
      description: (v.expectedArtifact.description as string | null) ?? null,
    };
  }
  const execution = readExecution(v.execution);
  if (!execution) return null;
  return {
    ordinal: v.ordinal, agentName: v.agentName, workflowId: v.workflowId,
    agentVersionId: v.agentVersionId, versionNumber: v.versionNumber,
    role: (v.role as string | null) ?? null,
    taskLabel: (v.taskLabel as string | null) ?? null,
    expectedArtifact, execution,
  };
}

function readHandoff(v: unknown): ProductionHandoff | null {
  if (!isObj(v) || !integer(v.producerOrdinal) || !integer(v.consumerOrdinal)) return null;
  if (!strOrNull(v.producerAgentName ?? null) || !strOrNull(v.consumerAgentName ?? null)) return null;
  if (!strOrNull(v.artifactId ?? null) || !strOrNull(v.artifactName ?? null) || !strOrNull(v.artifactKind ?? null)) return null;
  if (!strOrNull(v.digest ?? null) || !strOrNull(v.digestPrefix ?? null)) return null;
  if (!str(v.validationStatus) || !strOrNull(v.validatedAt ?? null) || !strOrNull(v.dispatchedAt ?? null)) return null;
  if (!strOrNull(v.failureReason ?? null)) return null;
  if (!HANDOFF_STATES.includes(v.state as HandoffState)) return null;
  return {
    producerOrdinal: v.producerOrdinal, consumerOrdinal: v.consumerOrdinal,
    producerAgentName: (v.producerAgentName as string | null) ?? null,
    consumerAgentName: (v.consumerAgentName as string | null) ?? null,
    artifactId: (v.artifactId as string | null) ?? null,
    artifactName: (v.artifactName as string | null) ?? null,
    artifactKind: (v.artifactKind as string | null) ?? null,
    digest: (v.digest as string | null) ?? null,
    digestPrefix: (v.digestPrefix as string | null) ?? null,
    validationStatus: v.validationStatus,
    validatedAt: (v.validatedAt as string | null) ?? null,
    dispatchedAt: (v.dispatchedAt as string | null) ?? null,
    state: v.state as HandoffState,
    failureReason: (v.failureReason as string | null) ?? null,
  };
}

function readTrace(v: unknown): ProductionTraceEntry | null {
  if (!isObj(v) || !str(v.at) || !str(v.type)) return null;
  if (!TRACE_SOURCES.includes(v.source as TraceSource)) return null;
  if (v.ordinal !== null && !integer(v.ordinal)) return null;
  if (!isObj(v.detail)) return null;
  return {
    at: v.at, type: v.type, source: v.source as TraceSource,
    ordinal: (v.ordinal as number | null) ?? null,
    detail: v.detail,
  };
}

/**
 * Parse the detail body on top of an already-parsed monitor production.
 *
 * The monitor contract is parsed FIRST and separately: the header, budget,
 * progress and stop control must keep working on a deployment whose detail
 * projection drifts, because they answer "is my money still moving" and that
 * question outranks the node breakdown.
 */
export function parseProductionDetail(v: unknown, production: Production): ProductionDetail | null {
  if (!isObj(v) || !Array.isArray(v.nodes) || !Array.isArray(v.handoffs) || !Array.isArray(v.trace)) return null;
  if (!bool(v.traceTruncated)) return null;

  const nodes: ProductionNode[] = [];
  for (const raw of v.nodes) { const node = readNode(raw); if (!node) return null; nodes.push(node); }
  // Ordinal order is the backend's, and it is contractual: the page renders
  // "Agent 1", "Agent 2" from it, so a gap or a repeat is unreadable, not
  // something to quietly re-sort into a plausible order.
  for (let i = 0; i < nodes.length; i += 1) if (nodes[i].ordinal !== i) return null;

  const handoffs: ProductionHandoff[] = [];
  for (const raw of v.handoffs) {
    const handoff = readHandoff(raw);
    // A handoff between nodes this production does not have would attribute an
    // artifact to an agent that is not on the page.
    if (!handoff) return null;
    if (!nodes.some((n) => n.ordinal === handoff.producerOrdinal)) return null;
    if (!nodes.some((n) => n.ordinal === handoff.consumerOrdinal)) return null;
    handoffs.push(handoff);
  }

  const trace: ProductionTraceEntry[] = [];
  for (const raw of v.trace) {
    const entry = readTrace(raw);
    if (!entry) return null;
    if (entry.ordinal !== null && !nodes.some((n) => n.ordinal === entry.ordinal)) return null;
    trace.push(entry);
  }

  let finalDeliverable: FinalDeliverable | null = null;
  if (v.finalDeliverable !== null && v.finalDeliverable !== undefined) {
    const artifact = readArtifact(v.finalDeliverable);
    const raw = v.finalDeliverable as Record<string, unknown>;
    if (!artifact || !integer(raw.ordinal) || !str(raw.agentName)) return null;
    finalDeliverable = { ...artifact, ordinal: raw.ordinal, agentName: raw.agentName };
  }

  return { ...production, nodes, handoffs, trace, traceTruncated: v.traceTruncated, finalDeliverable };
}

export function parseLineage(v: unknown): ProductionLineage | null {
  if (!isObj(v) || !str(v.productionId) || !str(v.productionState) || !strOrNull(v.productionGoal ?? null)) return null;
  if (!bool(v.settled) || !integer(v.ordinal) || !strOrNull(v.agentName ?? null) || !strOrNull(v.role ?? null)) return null;
  if (!str(v.nodeState) || !strOrNull(v.nodeOutcomeLabel ?? null) || !strOrNull(v.nodeFailureReason ?? null)) return null;
  if (!strOrNull(v.viewedRunId ?? null) || !strOrNull(v.authoritativeRunId ?? null)) return null;
  if (!bool(v.isAuthoritative) || !bool(v.superseded) || !bool(v.suppressRunAgain)) return null;
  if (!strOrNull(v.authoritativeRunState ?? null) || !strOrNull(v.authoritativeRunStatus ?? null)) return null;
  if (!strOrNull(v.authoritativeRunCompletedAt ?? null)) return null;
  return {
    productionId: v.productionId, productionState: v.productionState,
    productionGoal: (v.productionGoal as string | null) ?? null,
    settled: v.settled, ordinal: v.ordinal,
    agentName: (v.agentName as string | null) ?? null,
    role: (v.role as string | null) ?? null,
    nodeState: v.nodeState,
    nodeOutcomeLabel: (v.nodeOutcomeLabel as string | null) ?? null,
    nodeFailureReason: (v.nodeFailureReason as string | null) ?? null,
    viewedRunId: (v.viewedRunId as string | null) ?? null,
    authoritativeRunId: (v.authoritativeRunId as string | null) ?? null,
    isAuthoritative: v.isAuthoritative, superseded: v.superseded,
    authoritativeRunState: (v.authoritativeRunState as string | null) ?? null,
    authoritativeRunStatus: (v.authoritativeRunStatus as string | null) ?? null,
    authoritativeRunCompletedAt: (v.authoritativeRunCompletedAt as string | null) ?? null,
    suppressRunAgain: v.suppressRunAgain,
  };
}

/**
 * `{ ok, lineage }` where lineage may legitimately be null — "this run is not
 * part of a production" is an ANSWER, not a parse failure. `undefined` back
 * means the body was unreadable.
 */
export function parseLineageResponse(v: unknown): ProductionLineage | null | undefined {
  if (!isObj(v) || v.ok !== true) return undefined;
  if (v.lineage === null || v.lineage === undefined) return null;
  return parseLineage(v.lineage) ?? undefined;
}

// ── display helpers ───────────────────────────────────────────────────

/** Human label for a node's execution state. Display only — never persisted. */
export const NODE_STATE_LABELS: Record<string, string> = {
  queued: 'Queued',
  dispatched: 'Dispatched',
  running: 'Running',
  stalled: 'Stalled',
  completing: 'Finishing',
  succeeded: 'Completed',
  partial: 'Partially delivered',
  failed: 'Failed',
  cancelled: 'Released',
  dispatch_failed: 'Never started',
  settled: 'Settled',
};

export const ENGINE_LABELS: Record<ExecutionEngine, string> = { claude: 'Claude', codex: 'Codex' };

/**
 * The label for one combined-trace event.
 *
 * Deliberately a lookup, not a template over the backend's event_type: an
 * unknown event renders its raw type rather than being dropped, because a
 * trace that silently omits what it does not recognise is a trace that lies.
 */
export const TRACE_LABELS: Record<string, string> = {
  production_created: 'Production created',
  plan_prepared: 'Plan prepared',
  plan_no_eligible_candidate: 'No eligible agent',
  production_started: 'Production started',
  child_budget_reserved: 'Budget reserved',
  child_dispatched: 'Dispatched',
  child_engine_selected: 'Picked up',
  child_artifact_validated: 'Output validated',
  child_settled: 'Completed',
  child_dispatch_released: 'Released',
  cancel_requested: 'Stop requested',
  production_cancelled: 'Production stopped',
  receipt_recorded: 'Receipt recorded',
};

export function traceLabel(entry: ProductionTraceEntry): string {
  return TRACE_LABELS[entry.type] || entry.type.replace(/_/g, ' ');
}

/**
 * Whether an unsettled production's detail should keep re-reading.
 *
 * Mirrors shouldPollProduction: settled work never changes again, so polling
 * it is pure noise, and the detail read is the expensive one.
 */
export function shouldPollDetail(detail: ProductionDetail): boolean {
  return !detail.settled;
}

/**
 * Does this node still have work the user could be waiting on?
 *
 * Used to decide which node section opens by default: a live or failed node
 * earns the reader's attention, a quietly completed one does not.
 */
export function nodeNeedsAttention(node: ProductionNode): boolean {
  if (node.execution.failureReason) return true;
  return ['running', 'stalled', 'dispatched', 'failed', 'partial'].includes(node.execution.state);
}
