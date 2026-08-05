/**
 * lib/generation-proposal-v2-envelope.ts — the persisted READ of a v2 proposal
 * (GET /:id, and the identical body approve and cancel return).
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE v1 READ
 *
 * The same argument the backend used when it put the v2 control graph in its own
 * file: leaving lib/generation-proposal.ts untouched makes "existing Quick/v1
 * proposals behave exactly as before" a STRUCTURAL fact rather than a claim —
 * the bytes that parse them did not change. The event and receipt rules below
 * are deliberately restated rather than imported, so neither arm can be loosened
 * by an edit aimed at the other.
 *
 * Routing into this module happens in lib/generation-control-contract.ts, on the
 * explicit discriminator alone. Nothing here infers a contract from shape.
 */

import {
  parseCompiledProfessionalV2Proposal,
  type CompiledProfessionalV2Proposal,
} from './generation-proposal-v2.ts';

export type V2Lifecycle = 'awaiting_approval' | 'approved' | 'cancelled' | 'expired' | 'unavailable';
export type V2Progress =
  | 'awaiting_approval' | 'pending' | 'generating' | 'completed'
  | 'failed' | 'unknown' | 'expired' | 'cancelled' | 'unavailable';
export type V2AuthorizationStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'unknown' | 'expired';

export type V2AuthorizationVM = {
  id: string;
  digest: string;
  status: V2AuthorizationStatus;
  maxTasks: number;
  maxCredits: number;
  expiresAt: string;
  claimedAt: string | null;
  finalizedAt: string | null;
  errorCode: string | null;
};

export type V2TaskEventVM = {
  taskId: string;
  eventType: 'task_created' | 'task_succeeded';
  providerTaskId: string;
  status: 'created' | 'succeeded';
  artifactSha256: string | null;
  createdAt: string | null;
};

export type ProfessionalV2ProposalViewModel = {
  proposalId: string;
  compiled: CompiledProfessionalV2Proposal;
  agentSubject: string;
  sourceRunId: string | null;
  sourceRequestId: string | null;
  /** The exact pair an approval must echo. Never recomputed client-side. */
  proposalVersion: string;
  proposalDigest: string;
  lifecycle: V2Lifecycle;
  progress: V2Progress;
  expiresAt: string;
  /** Credits already incurred, re-derived from the events and refused if it disagrees. */
  incurredCredits: number;
  authorization: V2AuthorizationVM | null;
  events: V2TaskEventVM[];
  /**
   * Always null under this contract: the backend supplies credits and no money
   * figure. A dollar amount may only ever come FROM a backend field.
   */
  dollars: null;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const SHA256_RE = /^[a-f0-9]{64}$/;
const isDigest = (v: unknown): v is string => typeof v === 'string' && SHA256_RE.test(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNullableString = (v: unknown) => v === null || typeof v === 'string';
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

const LIFECYCLES = new Set<V2Lifecycle>(['awaiting_approval', 'approved', 'cancelled', 'expired', 'unavailable']);
const PROGRESS = new Set<V2Progress>(['awaiting_approval', 'pending', 'generating', 'completed', 'failed', 'unknown', 'expired', 'cancelled', 'unavailable']);
const AUTH_STATUSES = new Set<V2AuthorizationStatus>(['pending', 'claimed', 'completed', 'failed', 'unknown', 'expired']);

/** The lifecycle each progress state may accompany, from the backend projection. */
const PROGRESS_BY_LIFECYCLE: Record<V2Lifecycle, ReadonlySet<V2Progress>> = {
  awaiting_approval: new Set<V2Progress>(['awaiting_approval']),
  approved: new Set<V2Progress>(['pending', 'generating', 'completed', 'failed', 'unknown', 'expired']),
  cancelled: new Set<V2Progress>(['cancelled']),
  expired: new Set<V2Progress>(['expired']),
  unavailable: new Set<V2Progress>(['unavailable']),
};

const PROGRESS_BY_AUTH: Record<V2AuthorizationStatus, V2Progress> = {
  pending: 'pending', claimed: 'generating', completed: 'completed',
  failed: 'failed', unknown: 'unknown', expired: 'expired',
};

function parseAuthorization(v: unknown): V2AuthorizationVM | null {
  if (!isObject(v)) return null;
  if (!isText(v.authorization_id) || !isDigest(v.authorization_digest)) return null;
  if (typeof v.status !== 'string' || !AUTH_STATUSES.has(v.status as V2AuthorizationStatus)) return null;
  if (!isNonNegInt(v.max_tasks) || !isNonNegInt(v.max_credits)) return null;
  if (!isText(v.expires_at)) return null;
  if (!isNullableString(v.claimed_at ?? null) || !isNullableString(v.finalized_at ?? null)) return null;
  if (!isNullableString(v.error_code ?? null)) return null;
  return {
    id: v.authorization_id, digest: v.authorization_digest,
    status: v.status as V2AuthorizationStatus,
    maxTasks: v.max_tasks, maxCredits: v.max_credits, expiresAt: v.expires_at,
    claimedAt: (v.claimed_at as string | null) ?? null,
    finalizedAt: (v.finalized_at as string | null) ?? null,
    errorCode: (v.error_code as string | null) ?? null,
  };
}

function parseEvent(v: unknown, taskIds: ReadonlySet<string>): V2TaskEventVM | null {
  if (!isObject(v)) return null;
  // An event about a task this proposal does not contain describes someone
  // else's work; rendering it would attribute foreign spend to this timeline.
  if (!isText(v.task_id) || !taskIds.has(v.task_id)) return null;
  if (v.event_type !== 'task_created' && v.event_type !== 'task_succeeded') return null;
  if (!isText(v.provider_task_id)) return null;
  if (!isNullableString(v.created_at ?? null)) return null;
  let artifactSha256: string | null = null;
  const artifact = v.artifact;
  if (artifact !== null && artifact !== undefined) {
    if (!isObject(artifact)) return null;
    if (artifact.sha256 !== undefined) {
      if (!isDigest(artifact.sha256)) return null;
      artifactSha256 = artifact.sha256;
    }
  }
  // TYPE-SPECIFIC STATUS. A `task_created` claiming `succeeded` is not a record
  // the backend projection can emit, and a success with no artifact digest is
  // evidence the record-time contract cannot contain.
  if (v.event_type === 'task_created') {
    if (v.status !== 'created') return null;
  } else if (v.status !== 'succeeded' || artifactSha256 === null) return null;
  return {
    taskId: v.task_id, eventType: v.event_type, providerTaskId: v.provider_task_id,
    status: v.status, artifactSha256, createdAt: (v.created_at as string | null) ?? null,
  };
}

/**
 * Parse the persisted read of a v2 proposal. Null on any violation, so the
 * caller reports "unavailable" rather than rendering a guess.
 *
 * `professional_progress` is deliberately NOT parsed or rendered here: it is the
 * per-moment execution projection, and this lane ships no execution surface for
 * it. Accepting it silently as an additive field is honest; inventing a
 * rendering for a document nothing here validates would not be.
 */
export function parseProfessionalV2ProposalResponse(
  body: unknown,
  expectedProposalId?: string,
): ProfessionalV2ProposalViewModel | null {
  if (!isObject(body) || body.ok !== true) return null;
  if (!isText(body.proposal_id)) return null;
  // IDENTITY. A valid-looking proposal for a DIFFERENT id must never render
  // under this URL — every action taken from it would target the wrong money.
  if (expectedProposalId && body.proposal_id !== expectedProposalId) return null;
  const proposalId = body.proposal_id;

  const compiled = parseCompiledProfessionalV2Proposal(body.proposal);
  if (!compiled) return null;

  const identity = body.identity;
  if (!isObject(identity)) return null;
  if (identity.proposal_id !== proposalId) return null;
  if (!isText(identity.agent_subject) || !isText(identity.proposal_version)) return null;
  if (!isDigest(identity.proposal_digest) || identity.proposal_digest !== compiled.proposalDigest) return null;
  if (identity.capability_key !== compiled.capabilityKey) return null;
  if (!isNullableString(identity.source_run_id ?? null) || !isNullableString(identity.source_request_id ?? null)) return null;

  if (typeof body.lifecycle_state !== 'string' || !LIFECYCLES.has(body.lifecycle_state as V2Lifecycle)) return null;
  const lifecycle = body.lifecycle_state as V2Lifecycle;
  if (typeof body.progress_state !== 'string' || !PROGRESS.has(body.progress_state as V2Progress)) return null;
  const progress = body.progress_state as V2Progress;
  if (!PROGRESS_BY_LIFECYCLE[lifecycle].has(progress)) return null;

  // The envelope repeats availability; it must not contradict the document.
  if (body.availability !== compiled.availability) return null;
  if ((body.unavailable_reason ?? null) !== compiled.unavailableReason) return null;
  // Unavailability is a lifecycle fact stated twice. Both statements must agree.
  if ((lifecycle === 'unavailable') !== (compiled.availability === false)) return null;

  if (!isText(body.expires_at) || Number.isNaN(Date.parse(body.expires_at))) return null;

  if (!isObject(body.cost)) return null;
  if (body.cost.maximum_credits !== compiled.maximumCredits) return null;
  if (!isNonNegInt(body.cost.total_credits)) return null;

  const authorization = body.authorization === null || body.authorization === undefined
    ? null : parseAuthorization(body.authorization);
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

  // REQUIRED array. `task_progress: null` is a progress read we could not make;
  // parsing it as "no events yet" would fabricate a calm zero.
  if (!Array.isArray(body.task_progress)) return null;
  const taskIds = new Set(compiled.tasks.map((t) => t.taskId));
  const events: V2TaskEventVM[] = [];
  const eventKeys = new Set<string>();
  const createdByTask = new Map<string, V2TaskEventVM>();
  const succeededByTask = new Map<string, V2TaskEventVM>();
  for (const raw of body.task_progress) {
    const event = parseEvent(raw, taskIds);
    if (!event) return null;
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
  if (events.length > 0 && !authorization) return null;

  // MONEY AGREES WITH EVENTS. Spend attaches to a take STARTING. Re-derive and
  // refuse a rival figure in either direction — spend understated is as false as
  // spend invented.
  const incurred = compiled.tasks.reduce((sum, t) => sum + (createdByTask.has(t.taskId) ? t.credits : 0), 0);
  if (body.cost.total_credits !== incurred) return null;

  return {
    proposalId,
    compiled,
    agentSubject: identity.agent_subject as string,
    sourceRunId: (identity.source_run_id as string | null) ?? null,
    sourceRequestId: (identity.source_request_id as string | null) ?? null,
    proposalVersion: identity.proposal_version as string,
    proposalDigest: compiled.proposalDigest,
    lifecycle, progress,
    expiresAt: body.expires_at,
    incurredCredits: body.cost.total_credits as number,
    authorization, events,
    dollars: null,
  };
}
