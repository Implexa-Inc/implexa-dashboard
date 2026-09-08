/**
 * lib/coach-decision-cards.ts — the proposed decisions the Coach confirms.
 *
 * SPEC §1.2 (the Coach is the semantic authority), §3.4 (candidate compilation),
 * §5 F0 items 6 and 7.
 *
 * ── WHAT A CARD IS ───────────────────────────────────────────────────────────────
 *
 * A bounded, evidence-bound PROPOSAL about one decision the Coach demonstrated, as the
 * backend's `proposalView` returns it. It is never an active rule and never a free-form
 * essay: the field set is fixed, and every field is either present or explicitly absent.
 * Implexa may propose; only the Coach's confirmed wording is canonical (§1.2, §4.3).
 *
 * ── THE FOUR RULES THAT ARE NOT OBVIOUS ──────────────────────────────────────────
 *
 * 1. AN `insufficient_evidence` CARD CANNOT BE CONFIRMED. §3.4 requires the compiler to
 *    say so explicitly when the recording cannot justify a claim, and §1.2 says intent
 *    may not be inferred from pixels. The SERVER enforces this — it refuses such a
 *    confirmation with `insufficient_evidence_not_confirmable` (422) — and
 *    `confirmBlockedReason` below mirrors it in the same words, so the pre-flight block
 *    and the server's refusal cannot describe different rules to the same Coach.
 *    Discarding is always available.
 *
 * 2. THERE IS NO EDIT AND NO MERGE. The wire has exactly two decisions, `confirmed` and
 *    `discarded`. A client-side "edit" or "merge" would change what a Coach sees while
 *    changing nothing that is stored — a control that lies by working.
 *
 * 3. CONFIRMING NEEDS THE DIGEST OF THE CARD THAT WAS SHOWN. `proposalDigest` travels
 *    back on every decision so a confirmation cannot land on a card that changed
 *    underneath the Coach (`stale_proposal_confirmation`).
 *
 * 4. NOTHING HERE ACTIVATES ANYTHING, AND A CONFIRMED CARD IS NOT YET A LEARNING.
 *    Confirming links an existing canonical candidate or, far more often in F0, DEFERS
 *    the mint entirely — `canonicalLinkState: 'mint_deferred'`. That is not a failure
 *    and not a half-success: a canonical learning candidate requires supporting
 *    evidence from real runs, and a demonstration has none. `learningStanding` and
 *    `standingSentence` below say exactly that, and there is deliberately no `activate`
 *    action in this module — not a disabled one, not a guarded one. Absence is the
 *    guarantee. F1 is where an eligible verified-and-accepted teaching becomes the
 *    canonical inert candidate.
 *
 * PURE ON PURPOSE. No I/O: the caller supplies the transport, so every rule below is
 * executable in a test.
 */

import {
  CONFIDENCE_LEVELS, PROPOSED_SCOPES,
  type ConfidenceLevel, type ProposalKind, type ProposedScope,
} from './training-review-actions.ts';

/** Backend `PROPOSAL_STATUSES`. There is no `accepted`, `edited` or `merged`. */
export type DecisionStatus = 'proposed' | 'confirmed' | 'discarded';

/** Backend `CANONICAL_LINK_STATES`. */
export type CanonicalLinkState = 'unlinked' | 'linked_existing' | 'mint_deferred';

/**
 * The §1.2 field set, as the backend names it.
 *
 * Every one is `string | null` rather than optional: "the Coach did not state an
 * exception" is a fact worth carrying, and an absent key reads as an unasked question.
 */
export type DecisionContent = {
  readonly triggerText: string | null;
  readonly rejectedTreatment: string | null;
  readonly selectedTreatment: string | null;
  readonly rationale: string | null;
  readonly invariantText: string | null;
  readonly exceptionText: string | null;
};

export type CoachDecisionCard = {
  readonly proposalId: string;
  readonly ordinal: number;
  readonly kind: ProposalKind;
  readonly status: DecisionStatus;
  /** SERVER-STATED: this card has already been decided. */
  readonly decided: boolean;
  readonly content: DecisionContent;
  /** Where a confirmed teaching would apply. Null on an insufficient-evidence card. */
  readonly proposedScope: ProposedScope | null;
  /** The compiler's own confidence. Displayed, never used to auto-confirm. */
  readonly confidence: ConfidenceLevel | null;
  readonly affectedStepIndex: number | null;
  readonly affectedCapabilityIdentity: string | null;
  /** §3.4: bounded evidence, by identity and digest — never bytes, never a path. */
  readonly sourceAnnotationIds: readonly string[];
  readonly evidenceDigests: readonly string[];
  /** §3.4: explicit, and rendered rather than hidden. */
  readonly insufficientEvidenceReason: string | null;
  /** The server's own words for what this KIND of card means. */
  readonly kindNote: string | null;
  readonly canonicalCandidateKey: string | null;
  readonly canonicalCandidateId: string | null;
  readonly canonicalLinkState: CanonicalLinkState;
  /** Always `inert` in this contract. Read, never assumed. */
  readonly influenceState: string;
  /** The server's own sentence explaining why this changes nothing yet. */
  readonly inertNote: string | null;
  /** Echoed back on every decision. Without it a confirmation is refused as stale. */
  readonly proposalDigest: string;
  readonly createdAt: string | null;
  readonly decidedAt: string | null;
};

/** Convenience: this card is the compiler saying it could not justify a claim. */
export function isInsufficientEvidence(card: CoachDecisionCard): boolean {
  return card.kind === 'insufficient_evidence';
}

/** §1.2 field order, and the words the Coach reads. Distinct, and asserted so. */
export const FIELD_LABELS: Record<keyof DecisionContent, string> = {
  triggerText: 'When this matters',
  rejectedTreatment: 'What the agent did',
  selectedTreatment: 'What you did instead',
  rationale: 'Why yours is better',
  invariantText: 'What must stay true',
  exceptionText: 'When not to do this',
};

export const FIELD_ORDER: readonly (keyof DecisionContent)[] = [
  'triggerText', 'rejectedTreatment', 'selectedTreatment', 'rationale', 'invariantText', 'exceptionText',
];

/** How far a confirmed teaching would reach, in the Coach's words. */
export const SCOPE_LABELS: Record<ProposedScope, string> = {
  run_local_revision: 'Use when revising this result',
  agent_version_candidate: 'Propose for a future agent version',
  both: 'Use for this result and propose for a future version',
};

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

// ── Actions ───────────────────────────────────────────────────────────────────────

/**
 * The wire's two decisions, and nothing else.
 *
 * `confirm` and `discard` are the only members because they are the only values the
 * server accepts. A third arm here would be a control with no upstream.
 */
export type DecisionAction =
  | { readonly type: 'confirm'; readonly proposalId: string }
  | { readonly type: 'discard'; readonly proposalId: string };

/** The server's decision literal for one action. The only mapping there is. */
export function wireDecision(action: DecisionAction): 'confirmed' | 'discarded' {
  return action.type === 'confirm' ? 'confirmed' : 'discarded';
}

/**
 * Why a card cannot be confirmed right now, or null when it can be.
 *
 * Returned as a SENTENCE rather than a boolean so the surface can explain the block
 * instead of rendering a dead button — the same rule `lib/review-room-state.ts`
 * enforces for the Review Room's own actions.
 *
 * Each branch mirrors a refusal the SERVER would give, in the server's own terms:
 * `insufficient_evidence_not_confirmable`, and a card that is already decided.
 */
export function confirmBlockedReason(card: CoachDecisionCard): string | null {
  if (card.status === 'discarded') return 'This decision was discarded.';
  if (card.status === 'confirmed') return 'You already confirmed this decision.';
  if (isInsufficientEvidence(card)) {
    return 'The recording does not justify this, so it cannot be confirmed. Discard it instead.';
  }
  if (!card.sourceAnnotationIds.length) {
    return 'This decision names no moment from the recording, so it cannot be confirmed.';
  }
  return null;
}

export function canConfirm(card: CoachDecisionCard): boolean {
  return confirmBlockedReason(card) === null;
}

export function discardBlockedReason(card: CoachDecisionCard): string | null {
  if (card.status === 'discarded') return 'This decision is already discarded.';
  if (card.status === 'confirmed') return 'You already confirmed this decision.';
  return null;
}

/**
 * Where a card stands in the ONE thing a Coach will want to know: has this taught the
 * Agent anything?
 *
 * `confirmed_not_a_learning` is the F0 resting state and is not a lesser version of a
 * learning — it is a different thing with a different consequence for the next run. A
 * confirmed teaching whose mint is DEFERRED has no canonical candidate at all, because
 * a canonical candidate needs supporting evidence from real runs and a demonstration
 * has none.
 */
export type LearningStanding =
  | 'undecided'
  | 'discarded'
  | 'confirmed_not_a_learning'
  | 'confirmed_linked_inert';

export function learningStanding(card: CoachDecisionCard): LearningStanding {
  if (card.status === 'discarded') return 'discarded';
  if (card.status !== 'confirmed') return 'undecided';
  return card.canonicalLinkState === 'linked_existing'
    ? 'confirmed_linked_inert' : 'confirmed_not_a_learning';
}

/**
 * What the surface says about that standing.
 *
 * The server's own `inertNote` WINS when it sent one — it is written for the exact link
 * state and is more precise than anything derivable here. These are the fallbacks, and
 * every one of them stops short of implying activation.
 */
export const STANDING_SENTENCES: Record<LearningStanding, string> = {
  undecided: 'Not decided yet. Nothing about your Agent has changed.',
  discarded: 'Discarded. Nothing about your Agent has changed.',
  confirmed_not_a_learning:
    'Confirmed, not yet a learning. It changes nothing until a revision carries it out and a '
    + 'verified result is accepted.',
  confirmed_linked_inert:
    'Confirmed and linked to a teaching your Agent already had evidence for. Still inert — it '
    + 'changes nothing about future runs.',
};

export function standingSentence(card: CoachDecisionCard): string {
  return card.inertNote ?? STANDING_SENTENCES[learningStanding(card)];
}

/** True only when the card claims something about a FUTURE run. Never true in F0. */
export function changesFutureRuns(card: CoachDecisionCard): boolean {
  return card.influenceState !== 'inert';
}

/** What the Coach has confirmed, in submission order. Discarded excluded. */
export function confirmedDecisions(cards: readonly CoachDecisionCard[]): readonly CoachDecisionCard[] {
  return cards.filter((card) => card.status === 'confirmed');
}

/**
 * One honest progress sentence. Counts UNRESOLVED work rather than claiming a
 * percentage, and names the insufficient-evidence cards separately because they need
 * a different action from the Coach.
 */
export function confirmationSummary(cards: readonly CoachDecisionCard[]): string {
  const open = cards.filter((card) => card.status === 'proposed');
  const blocked = open.filter(isInsufficientEvidence).length;
  const confirmed = confirmedDecisions(cards).length;
  const parts = [`${confirmed} confirmed`];
  if (open.length) parts.push(`${open.length} still to decide`);
  if (blocked) parts.push(`${blocked} the recording cannot justify`);
  return parts.join(' · ');
}

// ── Parsing the compiler's output ─────────────────────────────────────────────────

const SCOPES: ReadonlySet<string> = new Set<ProposedScope>(PROPOSED_SCOPES);
const CONFIDENCES: ReadonlySet<string> = new Set<ConfidenceLevel>(CONFIDENCE_LEVELS);
const KINDS: ReadonlySet<string> = new Set<ProposalKind>(['decision', 'insufficient_evidence']);
const STATUSES: ReadonlySet<string> = new Set<DecisionStatus>(['proposed', 'confirmed', 'discarded']);
const LINK_STATES: ReadonlySet<string> = new Set<CanonicalLinkState>([
  'unlinked', 'linked_existing', 'mint_deferred',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

const trimmed = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const value = v.trim();
  return value.length ? value : null;
};

const idList = (v: unknown, re: RegExp): string[] =>
  (Array.isArray(v) ? v : []).filter((entry): entry is string => typeof entry === 'string' && re.test(entry.trim()))
    .map((entry) => entry.trim());

/**
 * Parse ONE proposal from the backend projection.
 *
 * Returns null rather than a repaired card. A proposal missing its id, its kind, its
 * status, its link state or its digest is not a slightly-wrong decision — it is a
 * decision whose standing or whose confirmability we cannot state, and rendering it
 * with a default would put words in the Coach's mouth about what it does.
 */
export function parseDecisionCard(raw: unknown): CoachDecisionCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const proposalId = typeof value.proposalId === 'string' && UUID_RE.test(value.proposalId.trim())
    ? value.proposalId.trim() : null;
  if (!proposalId) return null;
  const ordinal = Number.isInteger(value.ordinal) ? (value.ordinal as number) : null;
  if (ordinal === null) return null;
  const kind = typeof value.kind === 'string' && KINDS.has(value.kind) ? (value.kind as ProposalKind) : null;
  const status = typeof value.status === 'string' && STATUSES.has(value.status)
    ? (value.status as DecisionStatus) : null;
  const canonicalLinkState = typeof value.canonicalLinkState === 'string' && LINK_STATES.has(value.canonicalLinkState)
    ? (value.canonicalLinkState as CanonicalLinkState) : null;
  if (!kind || !status || !canonicalLinkState) return null;
  // WITHOUT THE DIGEST THE CARD CANNOT BE DECIDED AT ALL. Rendering it with confirm and
  // discard controls that the server would refuse as stale is worse than not rendering
  // it: the Coach would read a refusal as a bug rather than as a missing field.
  const proposalDigest = typeof value.proposalDigest === 'string' && SHA256_RE.test(value.proposalDigest.trim())
    ? value.proposalDigest.trim().toLowerCase() : null;
  if (!proposalDigest) return null;
  // THE INERTNESS CLAIM IS READ, NOT ASSUMED — and a payload claiming otherwise is
  // DROPPED. This contract cannot produce an active teaching, so a card saying it is
  // active is forged or from a later contract, and this parser has not earned the right
  // to render it as if a future run would select it.
  const influenceState = trimmed(value.influenceState);
  if (influenceState !== 'inert') return null;

  const confidence = typeof value.confidence === 'string' && CONFIDENCES.has(value.confidence)
    ? (value.confidence as ConfidenceLevel) : null;
  const proposedScope = typeof value.proposedScope === 'string' && SCOPES.has(value.proposedScope)
    ? (value.proposedScope as ProposedScope) : null;
  const canonicalCandidateId = typeof value.canonicalCandidateId === 'string'
    && UUID_RE.test(value.canonicalCandidateId.trim()) ? value.canonicalCandidateId.trim() : null;

  return {
    proposalId,
    ordinal,
    kind,
    status,
    // SERVER-STATED, not derived from `status`.
    decided: value.decided === true,
    content: {
      triggerText: trimmed(value.triggerText),
      rejectedTreatment: trimmed(value.rejectedTreatment),
      selectedTreatment: trimmed(value.selectedTreatment),
      rationale: trimmed(value.rationale),
      invariantText: trimmed(value.invariantText),
      exceptionText: trimmed(value.exceptionText),
    },
    proposedScope,
    confidence,
    affectedStepIndex: Number.isInteger(value.affectedStepIndex) ? (value.affectedStepIndex as number) : null,
    affectedCapabilityIdentity: trimmed(value.affectedCapabilityIdentity),
    sourceAnnotationIds: idList(value.sourceAnnotationIds, UUID_RE),
    evidenceDigests: idList(value.evidenceDigests, SHA256_RE).map((entry) => entry.toLowerCase()),
    insufficientEvidenceReason: trimmed(value.insufficientEvidenceReason),
    kindNote: trimmed(value.kindNote),
    canonicalCandidateKey: typeof value.canonicalCandidateKey === 'string'
      && SHA256_RE.test(value.canonicalCandidateKey.trim())
      ? value.canonicalCandidateKey.trim().toLowerCase() : null,
    canonicalCandidateId,
    canonicalLinkState,
    influenceState,
    inertNote: trimmed(value.inertNote),
    proposalDigest,
    createdAt: trimmed(value.createdAt),
    decidedAt: trimmed(value.decidedAt),
  };
}

/** Parse a projection's proposals. Unreadable cards are DROPPED, never invented. */
export function parseDecisionCards(raw: unknown): readonly CoachDecisionCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseDecisionCard).filter((card): card is CoachDecisionCard => card !== null);
}
