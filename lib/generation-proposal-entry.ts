/**
 * Pure boundary for creating a paid-generation proposal from a run.
 *
 * Preview and create are deliberately separate contracts: preview has no durable
 * identity, while create must return the exact persisted identity the browser will
 * navigate to. Neither response is accepted merely because it says `ok: true`.
 */

import {
  parseCompiledGenerationProposal,
  type CompiledGenerationProposal,
} from './generation-proposal.ts';
import { qualityModeLabel, type QualityMode } from './quality-mode.ts';

export const GENERATION_CONTRACT_VERSION = '2026-08-01';
export const GENERATION_COMPILER_VERSION = 'generation-quality.v1';
export const BROLL_CAPABILITY = 'video.generate_broll';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT = /^[a-z0-9][a-z0-9-]{1,119}$/;

export type GenerationMomentInput = {
  id: string;
  prompt: string;
  startSeconds: number;
  endSeconds: number;
};

export type GenerationEntryIdentity = {
  agentSubject: string;
  sourceRunId: string;
  qualityMode: QualityMode;
  moment: GenerationMomentInput;
};

export type CreatedGenerationProposal = {
  proposalId: string;
  state: 'awaiting_approval' | 'unavailable';
  compiled: CompiledGenerationProposal;
};

export type GenerationPreviewSet = Record<QualityMode, CompiledGenerationProposal>;
export type ProposalCreateFlight = { current: boolean };

function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validDate(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function envelopeAgrees(
  body: Record<string, unknown>,
  compiled: CompiledGenerationProposal,
  expected: GenerationEntryIdentity,
): boolean {
  if (compiled.contractVersion !== GENERATION_CONTRACT_VERSION
    || compiled.compilerVersion !== GENERATION_COMPILER_VERSION
    || compiled.capabilityKey !== BROLL_CAPABILITY
    || compiled.qualityMode !== expected.qualityMode) return false;
  if (body.availability !== compiled.availability) return false;
  if ((body.unavailable_reason ?? null) !== compiled.unavailableReason) return false;
  if (!Array.isArray(body.required_missing_capabilities)
    || body.required_missing_capabilities.length !== compiled.requiredMissingCapabilities.length
    || body.required_missing_capabilities.some((v, i) => v !== compiled.requiredMissingCapabilities[i])) return false;
  const identity = body.identity;
  if (!object(identity)) return false;
  if (!(identity.capability_key === BROLL_CAPABILITY
    && identity.agent_subject === expected.agentSubject
    && identity.source_run_id === expected.sourceRunId
    && (identity.source_request_id ?? null) === null)) return false;

  // Bind what came back to what the user typed. A valid proposal for another
  // timestamp or prompt is still the wrong proposal, and must never become the
  // thing this page offers to approve.
  const prompt = expected.moment.prompt.trim();
  if (compiled.qualityMode === 'production') return compiled.tasks.length === 0;
  const expectedVariants = compiled.qualityMode === 'fast'
    ? new Map([['primary', prompt]])
    : new Map([
      ['primary', `${prompt}. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.`],
      ['coverage', `${prompt}. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.`],
    ]);
  // Professional additionally reserves ONE bounded repair per moment. It is
  // priced into the ceiling the user approves, so it is bound to the typed
  // prompt exactly like the candidates are — a reserve carrying someone else's
  // intent is still the wrong 36 credits.
  const expectedRepairs = compiled.qualityMode === 'professional'
    ? new Map([[1, `${prompt}. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.`]])
    : new Map<number, string>();
  if (compiled.candidateCount !== expectedVariants.size) return false;
  // DEFENSE IN DEPTH, not the only line: the parser's Professional gate already
  // requires exactly one reserve per moment, and refuses a reserve under any
  // other mode, so mutating THIS check alone does not fail a test (verified by
  // mutation — reported honestly rather than dressed up). It stays because it
  // states the entry boundary's own expectation where the counts are read.
  if (compiled.repairCount !== expectedRepairs.size) return false;

  for (const task of compiled.tasks) {
    if (task.momentId !== expected.moment.id) return false;
    if (task.kind === 'repair') {
      if (task.promptText !== expectedRepairs.get(task.repairOrdinal)) return false;
      expectedRepairs.delete(task.repairOrdinal);
      continue;
    }
    if (task.window.startSeconds !== expected.moment.startSeconds
      || task.window.endSeconds !== expected.moment.endSeconds
      || task.promptText !== expectedVariants.get(task.variant)) return false;
    expectedVariants.delete(task.variant);
  }
  // Every expected task was matched exactly once. Both halves are defense in
  // depth — each entry is deleted from its map as it matches, so a duplicate or
  // unmatched task already returned false above (verified by mutation). (No
  // credit assertion here:
  // initialCredits + repairReserveCredits === maximumCredits is a TAUTOLOGY —
  // the parser derives all three from the same task list — so asserting it would
  // be dead validation that reads like a real guarantee. The parser's own
  // `maximum_credits === sum(tasks)` check is where that is genuinely enforced.)
  return expectedVariants.size === 0 && expectedRepairs.size === 0;
}

export function parseGenerationPreviewResponse(
  body: unknown,
  expected: GenerationEntryIdentity,
): CompiledGenerationProposal | null {
  if (!object(body) || body.ok !== true || body.proposal_id !== null || body.state !== 'proposed') return null;
  if ((body.expires_at ?? null) !== null || (body.created_at ?? null) !== null) return null;
  if (!AGENT.test(expected.agentSubject) || !UUID.test(expected.sourceRunId)) return null;
  const compiled = parseCompiledGenerationProposal(body.proposal);
  if (!compiled || !envelopeAgrees(body, compiled, expected)) return null;
  return compiled;
}

export function parseGenerationCreateResponse(
  body: unknown,
  expected: GenerationEntryIdentity,
): CreatedGenerationProposal | null {
  if (!object(body) || body.ok !== true || typeof body.proposal_id !== 'string' || !UUID.test(body.proposal_id)) return null;
  if (body.state !== 'awaiting_approval' && body.state !== 'unavailable') return null;
  if (!validDate(body.created_at) || !validDate(body.expires_at)
    || Date.parse(body.expires_at) <= Date.parse(body.created_at)) return null;
  if (!AGENT.test(expected.agentSubject) || !UUID.test(expected.sourceRunId)) return null;
  const compiled = parseCompiledGenerationProposal(body.proposal);
  if (!compiled || !envelopeAgrees(body, compiled, expected)) return null;
  const expectedState = compiled.availability ? 'awaiting_approval' : 'unavailable';
  if (body.state !== expectedState) return null;

  const identity = body.identity;
  if (!object(identity)
    || identity.proposal_id !== body.proposal_id
    || identity.proposal_version !== GENERATION_COMPILER_VERSION
    || identity.proposal_digest !== compiled.proposalDigest
    || (identity.authorization_id ?? null) !== null
    || (identity.authorization_digest ?? null) !== null
    || typeof identity.user_id !== 'string' || !UUID.test(identity.user_id)
    || !((identity.organization_id ?? null) === null
      || (typeof identity.organization_id === 'string' && UUID.test(identity.organization_id)))) return null;

  return { proposalId: body.proposal_id, state: body.state, compiled };
}

export function parseGenerationPreviewSet(
  bodies: Record<QualityMode, unknown>,
  expected: Omit<GenerationEntryIdentity, 'qualityMode'>,
): GenerationPreviewSet | null {
  const fast = parseGenerationPreviewResponse(bodies.fast, { ...expected, qualityMode: 'fast' });
  const professional = parseGenerationPreviewResponse(bodies.professional, { ...expected, qualityMode: 'professional' });
  const production = parseGenerationPreviewResponse(bodies.production, { ...expected, qualityMode: 'production' });
  // One dark mode poisons the comparison. Showing two cards beside a missing
  // third looks like a complete choice and invites a decision on partial data.
  return fast && professional && production ? { fast, professional, production } : null;
}

/**
 * What the builder's create button says it will do. It MUST name the selected
 * mode: this string was hard-coded to "Quick" while the selector offered three
 * modes, so a user selecting Professional read a button promising Quick — at
 * three times the credits. A control in a paid flow that names the wrong mode is
 * a misstatement of what is about to be authorized.
 */
export function proposalCreateLabel(mode: QualityMode): string {
  return `Create ${qualityModeLabel(mode)} proposal`;
}

/**
 * The one-line summary above the create button. It counts CLIPS, and names the
 * repair reserve separately rather than folding it into the clip count — the
 * reserve is priced into the ceiling but only spent on a judged failure.
 */
export function proposalSummaryLine(
  compiled: Pick<CompiledGenerationProposal, 'candidateCount' | 'repairCount' | 'maximumCredits'>,
): string {
  const clips = `${compiled.candidateCount} ${compiled.candidateCount === 1 ? 'clip' : 'clips'}`;
  const reserve = compiled.repairCount > 0
    ? ` + ${compiled.repairCount} repair ${compiled.repairCount === 1 ? 'reserve' : 'reserves'}`
    : '';
  return `${clips}${reserve} · up to ${compiled.maximumCredits} credits`;
}

export function validateGenerationMoment(input: GenerationMomentInput): string | null {
  const prompt = input.prompt.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(input.id)) return 'The moment id is invalid.';
  if (prompt.length < 1 || prompt.length > 700) return 'Describe the B-roll in 700 characters or fewer.';
  if (!Number.isFinite(input.startSeconds) || !Number.isFinite(input.endSeconds)
    || !Number.isInteger(input.startSeconds * 1000) || !Number.isInteger(input.endSeconds * 1000)
    || input.startSeconds < 0 || input.endSeconds <= input.startSeconds) return 'Enter a valid timestamp window.';
  const duration = input.endSeconds - input.startSeconds;
  if (duration < 2 || duration > 10) return 'The B-roll window must be between 2 and 10 seconds.';
  return null;
}

/** The synchronous latch is set before the first await, so two clicks share one flight. */
export function beginProposalCreate(
  flight: ProposalCreateFlight,
  phase: string,
  hasPreviews: boolean,
  selectedAvailable: boolean,
): boolean {
  if (flight.current || phase !== 'ready' || !hasPreviews || !selectedAvailable) return false;
  flight.current = true;
  return true;
}

export function proposalEntryError(
  responseOk: boolean,
  body: unknown,
  operation: 'preview' | 'create' = 'preview',
  responseStatus: number | null = null,
): string {
  if (operation === 'create' && !responseOk
    && (responseStatus === null || responseStatus >= 500 || (object(body) && body.unavailable === true))) {
    return "Implexa couldn't confirm whether the proposal was created. Reload this run before trying again; do not approve from this response.";
  }
  if (object(body) && body.unavailable === true) return 'The generation service did not give a reliable answer. Nothing should be approved from this response.';
  if (object(body) && typeof body.error === 'string' && body.error) return `The proposal was refused (${body.error}).`;
  return responseOk
    ? 'The generation service answered in an unexpected form, so Implexa refused to use it.'
    : 'The generation service could not prepare this proposal.';
}
