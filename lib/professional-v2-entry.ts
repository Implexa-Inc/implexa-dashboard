/**
 * lib/professional-v2-entry.ts — the pure boundary between the Professional
 * timeline editor and the paid-generation API.
 *
 * THREE SEPARATE CONTRACTS, DELIBERATELY NOT ONE
 *
 *   preview  — no durable identity, no money, no row. It exists so a user can
 *              see the real compiled plan and the real ceiling before anything
 *              is written down.
 *   create   — must return the exact persisted identity the browser will
 *              navigate to and later approve against.
 *   approve  — the only step that commits money, and the only one with a gate.
 *
 * Neither response is accepted because it says `ok: true`. Each is bound back to
 * WHAT THE USER TYPED: a well-formed proposal for a different timeline, prompt,
 * variant count or Judge mode is still the wrong proposal, and must never become
 * the thing this page offers to approve.
 *
 * THE IDENTITY RULE (the one that stops an edited plan being approved)
 *
 * An approval reference binds four things at once: the proposal id, the
 * version/digest pair the backend issued, the compiled GRAPH digest, and a
 * fingerprint of the timeline that produced them. Editing any moment changes the
 * fingerprint, which invalidates the reference — so there is nothing left on
 * screen that could approve the previous plan. Re-previewing is the only way
 * back, and it produces a new identity from the backend.
 */

import {
  derivedCandidatePrompt, derivedRepairPrompt, toMs,
  V2_CAPABILITY_KEY, V2_COMPILER_VERSION, V2_CONTRACT_VERSION, CONTROL_V2,
} from './professional-v2-contract.ts';
import {
  reconcileWithBackend, timelineFingerprint, validateTimeline,
  type TimelineMoment,
} from './professional-v2-timeline.ts';
export type { TimelineMoment } from './professional-v2-timeline.ts';
import {
  parseCompiledProfessionalV2Proposal,
  type CompiledProfessionalV2Proposal,
} from './generation-proposal-v2.ts';
import {
  parseProfessionalV2ProposalResponse,
  type ProfessionalV2ProposalViewModel,
} from './generation-proposal-v2-envelope.ts';
import { routeProposalDocument } from './generation-control-contract.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT = /^[a-z0-9][a-z0-9-]{1,119}$/;
// The backend's own idempotency-key grammar, enforced here too so a malformed
// key fails before it can burn the user's one approval attempt on a 400.
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type ProfessionalV2EntryIdentity = {
  agentSubject: string;
  sourceRunId: string;
  moments: readonly TimelineMoment[];
};

export type CreatedProfessionalV2Proposal = {
  proposalId: string;
  state: 'awaiting_approval' | 'unavailable';
  compiled: CompiledProfessionalV2Proposal;
  proposalVersion: string;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validDate(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/**
 * The compiled document, routed by its EXPLICIT discriminator and then parsed.
 * A v1 document arriving where a v2 one was requested is refused rather than
 * rendered — the request said v2, so anything else is a contract mismatch, not a
 * smaller answer.
 */
function compiledV2From(document: unknown): CompiledProfessionalV2Proposal | null {
  const route = routeProposalDocument(document);
  if (route.contract !== 'v2') return null;
  return parseCompiledProfessionalV2Proposal(route.document);
}

/**
 * Bind the compiled document to the timeline that was submitted.
 *
 * Every field the user chose is checked, in ORDER, including the ones that only
 * change price (variants, repair reserve) and the ones that only change
 * behaviour (Judge mode). And every prompt the provider will actually receive is
 * rebuilt from the pinned suffix table and compared: a proposal whose derived
 * prompts carry different intent is the wrong spend even when every number matches.
 */
function documentAgreesWithTimeline(
  compiled: CompiledProfessionalV2Proposal,
  moments: readonly TimelineMoment[],
): boolean {
  if (compiled.contractVersion !== V2_CONTRACT_VERSION) return false;
  if (compiled.compilerVersion !== V2_COMPILER_VERSION) return false;
  if (compiled.capabilityKey !== V2_CAPABILITY_KEY) return false;
  if (compiled.controlContractVersion !== CONTROL_V2) return false;
  if (compiled.executionMode !== 'professional') return false;
  if (compiled.momentCount !== moments.length) return false;

  const tasksById = new Map(compiled.tasks.map((task) => [task.taskId, task]));

  for (let index = 0; index < moments.length; index += 1) {
    const submitted = moments[index];
    const returned = compiled.moments[index];
    const prompt = submitted.prompt.trim();
    if (returned.momentId !== submitted.id) return false;
    if (returned.startMs !== toMs(submitted.startSeconds)) return false;
    if (returned.endMs !== toMs(submitted.endSeconds)) return false;
    if (returned.ratio !== submitted.ratio) return false;
    if (returned.prompt !== prompt) return false;
    if (returned.variantsRequested !== submitted.variantsRequested) return false;
    if (returned.judgeMode !== submitted.judgeMode) return false;
    if (returned.maxRepairs !== submitted.maxRepairs) return false;

    for (const taskId of returned.candidateTaskIds) {
      const task = tasksById.get(taskId);
      if (!task || task.kind !== 'candidate') return false;
      const expected = derivedCandidatePrompt(prompt, task.ordinal, returned.variantsRequested);
      if (expected === null || task.promptText !== expected) return false;
    }
    for (const taskId of returned.repairTaskIds) {
      const task = tasksById.get(taskId);
      if (!task || task.kind !== 'repair') return false;
      // The reserve is priced into the ceiling the user approves, so it is bound
      // to the typed prompt exactly like the takes are. A reserve carrying
      // someone else's intent is still the wrong credits.
      if (task.promptText !== derivedRepairPrompt(prompt)) return false;
    }
  }
  return true;
}

function envelopeAgrees(body: Record<string, unknown>, compiled: CompiledProfessionalV2Proposal, expected: ProfessionalV2EntryIdentity): boolean {
  if (body.availability !== compiled.availability) return false;
  if ((body.unavailable_reason ?? null) !== compiled.unavailableReason) return false;
  if (!Array.isArray(body.required_missing_capabilities)
    || body.required_missing_capabilities.length !== compiled.requiredMissingCapabilities.length
    || body.required_missing_capabilities.some((v, i) => v !== compiled.requiredMissingCapabilities[i])) return false;
  const identity = body.identity;
  if (!isObject(identity)) return false;
  return identity.capability_key === V2_CAPABILITY_KEY
    && identity.agent_subject === expected.agentSubject
    && identity.source_run_id === expected.sourceRunId
    && (identity.source_request_id ?? null) === null;
}

/**
 * The local cost model reconciled against the backend's compiled figures.
 *
 * FAIL CLOSED. A disagreement does not mean "trust the backend and carry on" —
 * it means the plan that was priced locally is not the plan the backend
 * compiled, and neither number can be trusted to describe what the user is
 * about to authorize.
 */
export function reconcileProposal(
  moments: readonly TimelineMoment[], compiled: CompiledProfessionalV2Proposal,
): { ok: true } | { ok: false; reason: string } {
  return reconcileWithBackend(validateTimeline(moments).cost, {
    maximumCredits: compiled.maximumCredits,
    initialCredits: compiled.initialCredits,
    repairReserveCredits: compiled.repairReserveCredits,
    taskCount: compiled.taskCount,
    momentCount: compiled.momentCount,
  });
}

export function parseProfessionalV2PreviewResponse(
  body: unknown, expected: ProfessionalV2EntryIdentity,
): CompiledProfessionalV2Proposal | null {
  if (!isObject(body) || body.ok !== true) return null;
  // A preview has NO durable identity. A response carrying one is not a preview,
  // and treating it as one would let a row the user never asked to create become
  // the thing they approve.
  if (body.proposal_id !== null || body.state !== 'proposed') return null;
  if ((body.expires_at ?? null) !== null || (body.created_at ?? null) !== null) return null;
  if (!AGENT.test(expected.agentSubject) || !UUID.test(expected.sourceRunId)) return null;
  if (!validateTimeline(expected.moments).ok) return null;
  const compiled = compiledV2From(body.proposal);
  if (!compiled) return null;
  if (!envelopeAgrees(body, compiled, expected)) return null;
  if (!documentAgreesWithTimeline(compiled, expected.moments)) return null;
  if (!reconcileProposal(expected.moments, compiled).ok) return null;
  return compiled;
}

export function parseProfessionalV2CreateResponse(
  body: unknown, expected: ProfessionalV2EntryIdentity,
): CreatedProfessionalV2Proposal | null {
  if (!isObject(body) || body.ok !== true) return null;
  if (typeof body.proposal_id !== 'string' || !UUID.test(body.proposal_id)) return null;
  if (body.state !== 'awaiting_approval' && body.state !== 'unavailable') return null;
  if (!validDate(body.created_at) || !validDate(body.expires_at)
    || Date.parse(body.expires_at) <= Date.parse(body.created_at)) return null;
  if (!AGENT.test(expected.agentSubject) || !UUID.test(expected.sourceRunId)) return null;
  if (!validateTimeline(expected.moments).ok) return null;
  const compiled = compiledV2From(body.proposal);
  if (!compiled) return null;
  if (!envelopeAgrees(body, compiled, expected)) return null;
  if (!documentAgreesWithTimeline(compiled, expected.moments)) return null;
  if (!reconcileProposal(expected.moments, compiled).ok) return null;

  // The persisted state must BE the compiled availability. A row claiming
  // awaiting_approval for an unavailable document would offer an approval the
  // backend will refuse — and would tell the user Professional is live.
  if (body.state !== (compiled.availability ? 'awaiting_approval' : 'unavailable')) return null;

  const identity = body.identity;
  if (!isObject(identity)
    || identity.proposal_id !== body.proposal_id
    || identity.proposal_version !== V2_COMPILER_VERSION
    || identity.proposal_digest !== compiled.proposalDigest
    || (identity.authorization_id ?? null) !== null
    || (identity.authorization_digest ?? null) !== null
    || typeof identity.user_id !== 'string' || !UUID.test(identity.user_id)
    || !((identity.organization_id ?? null) === null
      || (typeof identity.organization_id === 'string' && UUID.test(identity.organization_id)))) return null;

  return {
    proposalId: body.proposal_id,
    state: body.state,
    compiled,
    proposalVersion: identity.proposal_version as string,
  };
}

// ── the approval boundary ────────────────────────────────────────────────────

/**
 * Everything an approval must still be true about. All-null means INVALIDATED:
 * there is deliberately nothing left with which to approve.
 */
export type ProfessionalApprovalRef = {
  proposalId: string | null;
  proposalVersion: string | null;
  proposalDigest: string | null;
  /** The compiled graph the user actually read. */
  graphDigest: string | null;
  /** The timeline that produced it. Any edit changes this. */
  timelineFingerprint: string | null;
};

export const INVALIDATED_APPROVAL_REF: ProfessionalApprovalRef = {
  proposalId: null, proposalVersion: null, proposalDigest: null,
  graphDigest: null, timelineFingerprint: null,
};

export function approvalRefFor(
  vm: Pick<ProfessionalV2ProposalViewModel, 'proposalId' | 'proposalVersion' | 'proposalDigest' | 'compiled'>,
  moments: readonly TimelineMoment[] | null,
): ProfessionalApprovalRef {
  return {
    proposalId: vm.proposalId,
    proposalVersion: vm.proposalVersion,
    proposalDigest: vm.proposalDigest,
    graphDigest: vm.compiled.graphDigest,
    timelineFingerprint: moments ? timelineFingerprint(moments) : null,
  };
}

/** Editing destroys the reference. Nothing on screen can approve the old plan. */
export function invalidateApprovalRef(): ProfessionalApprovalRef {
  return { ...INVALIDATED_APPROVAL_REF };
}

export type ApprovalRefusalCode =
  | 'in_flight' | 'edited' | 'unavailable' | 'not_awaiting_approval' | 'expired'
  | 'identity_mismatch' | 'graph_changed' | 'timeline_changed'
  | 'ceiling_not_confirmed' | 'invalid_idempotency_key';

export type ApprovalDecision =
  | {
    ok: true;
    request: {
      action: 'approve';
      proposalId: string;
      proposalVersion: string;
      proposalDigest: string;
      idempotencyKey: string;
    };
  }
  | { ok: false; code: ApprovalRefusalCode; message: string };

const REFUSAL_COPY: Record<ApprovalRefusalCode, string> = {
  in_flight: 'An approval is already in flight for this proposal.',
  edited: 'This plan was edited. Preview it again — the edit produces a new proposal with its own approval.',
  unavailable: 'Professional generation is not available, so this plan cannot be approved.',
  not_awaiting_approval: 'This proposal is not awaiting approval.',
  expired: 'This proposal has expired. Preview the plan again to get a fresh one.',
  identity_mismatch: 'This card no longer matches the proposal it was built from, so Implexa will not approve it.',
  graph_changed: 'The compiled plan changed since it was shown. Reload before approving.',
  timeline_changed: 'The timeline changed since this proposal was compiled. Preview it again.',
  ceiling_not_confirmed: 'Confirm the maximum credits this authorizes before approving.',
  invalid_idempotency_key: 'Implexa could not mint a safe retry key for this approval.',
};

/**
 * May this approval be sent?
 *
 * SIX INDEPENDENT CONDITIONS, each of which alone blocks the request:
 *
 *   1. Single-flight — a double click sends exactly one request.
 *   2. The reference survives — an edit has not invalidated it.
 *   3. The backend says the proposal is AVAILABLE and awaiting approval, and has
 *      not expired. Availability is the backend's answer, never a local guess.
 *   4. The proposal identity the user saw still matches the one on screen.
 *   5. The compiled GRAPH digest is unchanged, and the timeline fingerprint the
 *      preview was bound to still matches the timeline in hand.
 *   6. The user has explicitly confirmed the exact HARD MAXIMUM. Not the expected
 *      spend — the ceiling, including a repair reserve that may never run.
 */
export function decideProfessionalApproval(input: {
  vm: ProfessionalV2ProposalViewModel;
  ref: ProfessionalApprovalRef;
  /** The timeline currently in hand, or null when approving from the read page. */
  currentTimelineFingerprint: string | null;
  /** The ceiling the user explicitly confirmed, in credits. */
  confirmedMaximumCredits: number | null;
  idempotencyKey: string;
  inFlight: boolean;
  now: number;
}): ApprovalDecision {
  const refuse = (code: ApprovalRefusalCode): ApprovalDecision => ({ ok: false, code, message: REFUSAL_COPY[code] });

  if (input.inFlight) return refuse('in_flight');
  const { ref, vm } = input;
  if (!ref.proposalId || !ref.proposalVersion || !ref.proposalDigest || !ref.graphDigest) return refuse('edited');
  // THE BACKEND IS AUTHORITATIVE FOR AVAILABILITY. With the Professional server
  // flags false this is where every approval stops, and it must not be softened
  // to make local testing convenient.
  if (vm.compiled.availability !== true) return refuse('unavailable');
  if (vm.lifecycle !== 'awaiting_approval') return refuse('not_awaiting_approval');
  if (!Number.isFinite(Date.parse(vm.expiresAt)) || Date.parse(vm.expiresAt) <= input.now) return refuse('expired');
  if (ref.proposalId !== vm.proposalId
    || ref.proposalVersion !== vm.proposalVersion
    || ref.proposalDigest !== vm.proposalDigest) return refuse('identity_mismatch');
  if (ref.graphDigest !== vm.compiled.graphDigest) return refuse('graph_changed');
  if (ref.timelineFingerprint !== null
    && input.currentTimelineFingerprint !== null
    && ref.timelineFingerprint !== input.currentTimelineFingerprint) return refuse('timeline_changed');
  if (input.confirmedMaximumCredits === null
    || input.confirmedMaximumCredits !== vm.compiled.maximumCredits) return refuse('ceiling_not_confirmed');
  if (!IDEMPOTENCY.test(input.idempotencyKey)) return refuse('invalid_idempotency_key');

  return {
    ok: true,
    request: {
      action: 'approve',
      proposalId: ref.proposalId,
      proposalVersion: ref.proposalVersion,
      proposalDigest: ref.proposalDigest,
      idempotencyKey: input.idempotencyKey,
    },
  };
}

// ── the edit lifecycle ───────────────────────────────────────────────────────

/**
 * Rebuild the editable timeline from a compiled plan.
 *
 * This is what makes Edit an EDIT. Without it, "edit" navigates to a blank
 * builder and the user's whole timeline is gone — a destructive action wearing
 * the label of a reversible one.
 *
 * Returns null if the rebuilt timeline would not validate. A plan the editor
 * cannot legally hold is a plan it must not pretend to have loaded; seeding it
 * anyway would show the user their moments beside refusals they cannot fix.
 */
export function timelineFromCompiledProposal(
  compiled: CompiledProfessionalV2Proposal,
): TimelineMoment[] | null {
  const moments: TimelineMoment[] = compiled.moments.map((moment) => ({
    id: moment.momentId,
    prompt: moment.prompt,
    startSeconds: moment.startMs / 1000,
    endSeconds: moment.endMs / 1000,
    ratio: moment.ratio,
    variantsRequested: moment.variantsRequested,
    judgeMode: moment.judgeMode,
    maxRepairs: moment.maxRepairs,
  }));
  return validateTimeline(moments).ok ? moments : null;
}

export type EditDecision =
  | {
    ok: true;
    /**
     * True when the plan is still approvable, so editing must durably retire it
     * before the new one exists. False when it never could be approved
     * (unavailable, expired, already cancelled) — there is nothing to retire.
     */
    mustRetire: boolean;
  }
  | { ok: false; reason: string };

/**
 * May this plan be edited, and does editing have to retire it first?
 *
 * THE DURABILITY PROBLEM THIS SOLVES. Forgetting the approval identity in
 * component state is not invalidation — it survives exactly as long as the card
 * stays mounted. Press Back and the card remounts, the identity is rebuilt from
 * the same proposal, and the plan the user just decided to abandon is approvable
 * again at its old ceiling. Meanwhile the backend still holds it
 * `awaiting_approval` for its whole TTL, so a second tab, a bookmark, or a
 * refresh can approve the superseded plan while the replacement is being built.
 *
 * So an approvable plan is CANCELLED at the backend before the editor opens.
 * That is the only place the retirement can be durable, and it also removes the
 * "two approvable plans for one run, each with its own ceiling" window entirely.
 * Nothing is lost by it: the plan's content is carried into the editor, so
 * re-compiling and re-saving reproduces it exactly.
 *
 * An APPROVED plan is not editable at all. Money is committed; the honest next
 * step is a new plan, not an edit that implies the authorization moves with it.
 */
export function decideProfessionalEdit(
  vm: Pick<ProfessionalV2ProposalViewModel, 'lifecycle'>,
): EditDecision {
  if (vm.lifecycle === 'approved') {
    return { ok: false, reason: 'This plan is already approved, so it cannot be edited. Build a new plan instead.' };
  }
  return { ok: true, mustRetire: vm.lifecycle === 'awaiting_approval' };
}

export type CancelOutcome = 'cancelled' | 'refused' | 'unverified';

/**
 * Did the cancellation actually land?
 *
 * Same rule as approval: `ok: true` is not an answer. Cancellation is claimed
 * only when the body parses under the strict v2 parser, names THIS proposal, and
 * reads lifecycle `cancelled`. Anything else is unverified — and because the
 * editor only opens on a CONFIRMED cancel, an unverified answer leaves the user
 * on a card that still, truthfully, says the plan is approvable.
 */
export function interpretProfessionalCancelResponse(
  httpOk: boolean, body: unknown, proposalId: string,
): CancelOutcome {
  if (!httpOk) {
    if (isObject(body) && body.unavailable === true) return 'unverified';
    if (isObject(body) && typeof body.error === 'string' && body.error) return 'refused';
    return 'unverified';
  }
  const vm = parseProfessionalV2ProposalResponse(body, proposalId);
  if (!vm) return 'unverified';
  return vm.lifecycle === 'cancelled' ? 'cancelled' : 'unverified';
}

export type ApprovalOutcome =
  | { outcome: 'confirmed'; vm: ProfessionalV2ProposalViewModel }
  | { outcome: 'refused'; code: string }
  /** The request may or may not have landed. Never rendered as either. */
  | { outcome: 'unverified' };

/**
 * What actually came back.
 *
 * `body.ok === true` is NOT success. An approval is claimed only when the HTTP
 * call succeeded, the body parses under the strict v2 parser, it names THIS
 * proposal with the SAME digests the user approved, and it reads lifecycle
 * `approved` with an authorization whose ceiling matches the compiled maximum.
 * Anything else is unverified — and unverified is announced as unverified, since
 * the idempotency key makes a deliberate retry safe but a false "approved" does not.
 */
export function interpretProfessionalApprovalResponse(
  httpOk: boolean, body: unknown, ref: ProfessionalApprovalRef,
): ApprovalOutcome {
  if (!ref.proposalId) return { outcome: 'unverified' };
  if (!httpOk) {
    // A read/write the backend could not make is not a refusal — it is an
    // unknown. Only a typed error code counts as an answer.
    if (isObject(body) && body.unavailable === true) return { outcome: 'unverified' };
    if (isObject(body) && typeof body.error === 'string' && body.error) return { outcome: 'refused', code: body.error };
    return { outcome: 'unverified' };
  }
  const vm = parseProfessionalV2ProposalResponse(body, ref.proposalId);
  if (!vm) return { outcome: 'unverified' };
  if (vm.proposalDigest !== ref.proposalDigest) return { outcome: 'unverified' };
  if (vm.compiled.graphDigest !== ref.graphDigest) return { outcome: 'unverified' };
  if (vm.lifecycle !== 'approved' || !vm.authorization) return { outcome: 'unverified' };
  if (vm.authorization.maxCredits !== vm.compiled.maximumCredits) return { outcome: 'unverified' };
  if (vm.authorization.maxTasks !== vm.compiled.taskCount) return { outcome: 'unverified' };
  return { outcome: 'confirmed', vm };
}

/**
 * The honest one-liner for a failed preview or create. Distinguishes a REFUSAL
 * (the backend answered, with a reason) from an ABSENT ANSWER — and for create,
 * an absent answer must never read as "nothing happened", because a timed-out
 * create may have landed.
 */
export function professionalEntryError(
  responseOk: boolean, body: unknown,
  operation: 'preview' | 'create', responseStatus: number | null = null,
): string {
  if (operation === 'create' && !responseOk
    && (responseStatus === null || responseStatus >= 500 || (isObject(body) && body.unavailable === true))) {
    return "Implexa couldn't confirm whether the proposal was created. Reload this run before trying again; do not approve from this response.";
  }
  if (isObject(body) && body.unavailable === true) {
    return 'The generation service did not give a reliable answer. Nothing should be approved from this response.';
  }
  if (isObject(body) && typeof body.error === 'string' && body.error) {
    return `The plan was refused (${body.error}).`;
  }
  return responseOk
    ? 'The generation service answered in an unexpected form, so Implexa refused to use it.'
    : 'The generation service could not compile this timeline.';
}
