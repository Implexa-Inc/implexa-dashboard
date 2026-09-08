/**
 * lib/coach-decision-cards.ts — the proposed decisions the Coach confirms.
 *
 * SPEC §1.2 (the Coach is the semantic authority), §3.4 (candidate compilation),
 * §5 F0 item 6.
 *
 * ── WHAT A CARD IS ───────────────────────────────────────────────────────────────
 *
 * A bounded, evidence-bound PROPOSAL about one decision the Coach demonstrated. It is
 * never an active rule and never a free-form essay: §3.4 fixes the fields, and every
 * one of them is either present or explicitly absent. Implexa may propose; only the
 * Coach's confirmed wording is canonical (§1.2, §4.3).
 *
 * ── THE THREE RULES THAT ARE NOT OBVIOUS ─────────────────────────────────────────
 *
 * 1. AN `insufficient_evidence` CARD CANNOT BE ACCEPTED AS-IS. §3.4 requires the
 *    compiler to say so explicitly when the recording cannot justify a claim, and
 *    §1.2 says intent may not be inferred from pixels. Letting the Coach click Accept
 *    on a card whose content is "we could not tell" would launder a model's ignorance
 *    into a confirmed decision under the Coach's name. So it must be EDITED first —
 *    the Coach supplies the trigger, the selected treatment and the rationale — and
 *    editing is what clears the flag. Discard is always available.
 *
 * 2. A MERGE IS NOT A DELETE. Merging card B into card A leaves B present and
 *    readable as `merged`, naming A. The evidence unions; nothing is dropped. A merge
 *    that silently discarded B's annotation ids would break the §3.4 requirement that
 *    every proposal carries its source annotation ids and evidence digests.
 *
 * 3. NOTHING HERE ACTIVATES ANYTHING. Confirmation mints or links an INERT canonical
 *    learning candidate (§5 F0 item 7). There is deliberately no `activate` action in
 *    this module — not a disabled one, not a guarded one. Absence is the guarantee.
 *
 * PURE ON PURPOSE. No I/O: the caller supplies the transport, so every rule below is
 * executable in a test.
 */

/** §1.2 scope: how far a confirmed decision is allowed to reach. */
export type DecisionScope = 'this_revision' | 'this_task' | 'this_agent' | 'proposed_future_version';

/** §3.4 proposed destination. */
export type DecisionDestination = 'run_local_revision' | 'agent_version_candidate' | 'both';

export type DecisionDisposition = 'proposed' | 'accepted' | 'edited' | 'merged' | 'discarded';

/** §3.4: bounded evidence, by identity and digest — never bytes, never a path. */
export type DecisionEvidence = {
  readonly annotationIds: readonly string[];
  readonly evidenceDigests: readonly string[];
};

/**
 * The §1.2 field set, complete.
 *
 * `invariant` and `exception` are `string | null` rather than optional: "the Coach
 * did not state an exception" is a fact worth carrying, and an absent key reads as an
 * unasked question.
 */
export type DecisionContent = {
  readonly trigger: string;
  readonly rejectedTreatment: string;
  readonly selectedTreatment: string;
  readonly rationale: string;
  readonly invariant: string | null;
  readonly exception: string | null;
  readonly scope: DecisionScope;
};

export type CoachDecisionCard = {
  readonly id: string;
  readonly content: DecisionContent;
  readonly destination: DecisionDestination;
  /** The compiler's own confidence. Displayed, never used to auto-confirm. */
  readonly confidence: number | null;
  readonly evidence: DecisionEvidence;
  /** Resolvable workflow step / capability, when the compiler could name one. */
  readonly affectedStep: string | null;
  readonly affectedCapability: string | null;
  /** §3.4: explicit, and rendered rather than hidden. */
  readonly insufficientEvidence: boolean;
  readonly disposition: DecisionDisposition;
  /** Set only when `disposition === 'merged'`. */
  readonly mergedIntoId: string | null;
  /** True once the Coach's own wording replaced the proposal's. */
  readonly editedByCoach: boolean;
};

export const DECISION_TEXT_MAX = 4000;

export const SCOPE_LABELS: Record<DecisionScope, string> = {
  this_revision: 'This result only',
  this_task: 'This task',
  this_agent: 'This agent',
  proposed_future_version: 'A proposed future version',
};

export const DESTINATION_LABELS: Record<DecisionDestination, string> = {
  run_local_revision: 'Use when revising this result',
  agent_version_candidate: 'Propose for a future agent version',
  both: 'Use for this result and propose for a future version',
};

/** §1.2 field order, and the words the Coach reads. Distinct, and asserted so. */
export const FIELD_LABELS: Record<keyof DecisionContent, string> = {
  trigger: 'When this matters',
  rejectedTreatment: 'What the agent did',
  selectedTreatment: 'What you did instead',
  rationale: 'Why yours is better',
  invariant: 'What must stay true',
  exception: 'When not to do this',
  scope: 'How far this applies',
};

export const FIELD_ORDER: readonly (keyof DecisionContent)[] = [
  'trigger', 'rejectedTreatment', 'selectedTreatment', 'rationale', 'invariant', 'exception', 'scope',
];

/** The three fields a decision cannot be confirmed without. */
export const REQUIRED_FIELDS: readonly (keyof DecisionContent)[] = [
  'trigger', 'selectedTreatment', 'rationale',
];

// ── Actions ───────────────────────────────────────────────────────────────────────

export type DecisionAction =
  | { readonly type: 'accept'; readonly id: string }
  | { readonly type: 'edit'; readonly id: string; readonly content: Partial<DecisionContent> }
  | { readonly type: 'merge'; readonly id: string; readonly intoId: string }
  | { readonly type: 'discard'; readonly id: string };

export type DecisionActionResult =
  | { readonly ok: true; readonly cards: readonly CoachDecisionCard[] }
  /** A refusal the Coach can read and act on, never a thrown error. */
  | { readonly ok: false; readonly refusal: string };

const TERMINAL: ReadonlySet<DecisionDisposition> = new Set<DecisionDisposition>(['discarded', 'merged']);

const trimmed = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const value = v.trim();
  return value.length && value.length <= DECISION_TEXT_MAX ? value : null;
};

/**
 * Why a card cannot be accepted right now, or null when it can be.
 *
 * Returned as a SENTENCE rather than a boolean so the surface can explain the block
 * instead of rendering a dead button — the same rule `lib/review-room-state.ts`
 * enforces for the Review Room's own actions.
 */
export function acceptBlockedReason(card: CoachDecisionCard): string | null {
  if (card.disposition === 'discarded') return 'This decision was discarded.';
  if (card.disposition === 'merged') return 'This decision was merged into another one.';
  if (card.disposition === 'accepted') return 'You already accepted this decision.';
  if (card.insufficientEvidence) {
    return 'The recording does not justify this yet. Write what you meant, then accept it.';
  }
  const missing = REQUIRED_FIELDS.filter((field) => !trimmed(card.content[field]));
  if (missing.length) {
    return `Fill in ${missing.map((field) => FIELD_LABELS[field].toLowerCase()).join(', ')} before accepting.`;
  }
  if (!card.evidence.annotationIds.length) {
    return 'This decision names no moment from the recording, so it cannot be confirmed.';
  }
  return null;
}

export function canAccept(card: CoachDecisionCard): boolean {
  return acceptBlockedReason(card) === null;
}

function replace(
  cards: readonly CoachDecisionCard[], id: string, next: (card: CoachDecisionCard) => CoachDecisionCard,
): readonly CoachDecisionCard[] {
  return cards.map((card) => (card.id === id ? next(card) : card));
}

/**
 * Apply one Coach action. Pure: returns the next card list or a refusal.
 *
 * The refusal path matters more than the happy path. Every state below that CANNOT
 * take an action says why, so the surface never presents an option that silently
 * does nothing — the failure `review-submission-flow.ts` was written to end.
 */
export function applyDecisionAction(
  cards: readonly CoachDecisionCard[], action: DecisionAction,
): DecisionActionResult {
  const card = cards.find((entry) => entry.id === action.id);
  if (!card) return { ok: false, refusal: 'That decision is no longer on this submission.' };

  switch (action.type) {
    case 'accept': {
      const blocked = acceptBlockedReason(card);
      if (blocked) return { ok: false, refusal: blocked };
      return { ok: true, cards: replace(cards, card.id, (c) => ({ ...c, disposition: 'accepted' })) };
    }

    case 'edit': {
      if (TERMINAL.has(card.disposition)) {
        return { ok: false, refusal: 'A discarded or merged decision cannot be edited.' };
      }
      const patch = action.content;
      const content: DecisionContent = {
        ...card.content,
        ...(patch.trigger !== undefined ? { trigger: trimmed(patch.trigger) ?? '' } : {}),
        ...(patch.rejectedTreatment !== undefined
          ? { rejectedTreatment: trimmed(patch.rejectedTreatment) ?? '' } : {}),
        ...(patch.selectedTreatment !== undefined
          ? { selectedTreatment: trimmed(patch.selectedTreatment) ?? '' } : {}),
        ...(patch.rationale !== undefined ? { rationale: trimmed(patch.rationale) ?? '' } : {}),
        ...(patch.invariant !== undefined ? { invariant: trimmed(patch.invariant) } : {}),
        ...(patch.exception !== undefined ? { exception: trimmed(patch.exception) } : {}),
        ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      };
      const overLimit = FIELD_ORDER.some((field) => {
        const value = patch[field];
        return typeof value === 'string' && value.trim().length > DECISION_TEXT_MAX;
      });
      if (overLimit) return { ok: false, refusal: `Keep each answer under ${DECISION_TEXT_MAX} characters.` };

      // THE FLAG CLEARS ONLY WHEN THE COACH SUPPLIED THE MISSING CONTENT. An edit that
      // changed only the scope must not turn "we could not tell what you meant" into a
      // confirmable decision — that is the laundering path rule 1 exists to close.
      const supplied = REQUIRED_FIELDS.every((field) => !!trimmed(content[field]));
      return {
        ok: true,
        cards: replace(cards, card.id, (c) => ({
          ...c,
          content,
          editedByCoach: true,
          insufficientEvidence: c.insufficientEvidence && !supplied,
          disposition: c.disposition === 'accepted' ? 'accepted' : 'edited',
        })),
      };
    }

    case 'merge': {
      if (action.intoId === card.id) return { ok: false, refusal: 'A decision cannot merge into itself.' };
      const into = cards.find((entry) => entry.id === action.intoId);
      if (!into) return { ok: false, refusal: 'That decision is no longer on this submission.' };
      if (TERMINAL.has(card.disposition)) {
        return { ok: false, refusal: 'A discarded or merged decision cannot be merged again.' };
      }
      if (TERMINAL.has(into.disposition)) {
        return { ok: false, refusal: 'You cannot merge into a discarded or merged decision.' };
      }
      const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];
      const merged = replace(cards, into.id, (c) => ({
        ...c,
        evidence: {
          annotationIds: union(c.evidence.annotationIds, card.evidence.annotationIds),
          evidenceDigests: union(c.evidence.evidenceDigests, card.evidence.evidenceDigests),
        },
        // Merging IN unresolved evidence keeps the target honest: it now rests partly
        // on a claim the recording did not justify, and it must be edited before it
        // can be accepted.
        insufficientEvidence: c.insufficientEvidence || card.insufficientEvidence,
        disposition: c.disposition === 'accepted' ? 'accepted' : 'edited',
      }));
      return {
        ok: true,
        cards: replace(merged, card.id, (c) => ({
          ...c, disposition: 'merged', mergedIntoId: into.id,
        })),
      };
    }

    case 'discard': {
      if (card.disposition === 'discarded') return { ok: false, refusal: 'This decision is already discarded.' };
      if (card.disposition === 'merged') return { ok: false, refusal: 'This decision was merged into another one.' };
      return {
        ok: true,
        cards: replace(cards, card.id, (c) => ({ ...c, disposition: 'discarded', mergedIntoId: null })),
      };
    }

    default: {
      const never: never = action;
      throw new Error(`applyDecisionAction: unhandled action ${JSON.stringify(never)}`);
    }
  }
}

/** What the Coach has confirmed, in submission order. Merged and discarded excluded. */
export function acceptedDecisions(cards: readonly CoachDecisionCard[]): readonly CoachDecisionCard[] {
  return cards.filter((card) => card.disposition === 'accepted');
}

/**
 * One honest progress sentence. Counts UNRESOLVED work rather than claiming a
 * percentage, and names the insufficient-evidence cards separately because they need
 * a different action from the Coach.
 */
export function confirmationSummary(cards: readonly CoachDecisionCard[]): string {
  const open = cards.filter((card) => card.disposition === 'proposed' || card.disposition === 'edited');
  const blocked = open.filter((card) => card.insufficientEvidence).length;
  const accepted = acceptedDecisions(cards).length;
  const parts = [`${accepted} confirmed`];
  if (open.length) parts.push(`${open.length} still to decide`);
  if (blocked) parts.push(`${blocked} needs your words`);
  return parts.join(' · ');
}

// ── Parsing the compiler's output ─────────────────────────────────────────────────

const SCOPES: ReadonlySet<string> = new Set<DecisionScope>([
  'this_revision', 'this_task', 'this_agent', 'proposed_future_version',
]);
const DESTINATIONS: ReadonlySet<string> = new Set<DecisionDestination>([
  'run_local_revision', 'agent_version_candidate', 'both',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

const idList = (v: unknown, re: RegExp): string[] =>
  (Array.isArray(v) ? v : []).filter((entry): entry is string => typeof entry === 'string' && re.test(entry.trim()))
    .map((entry) => entry.trim());

/**
 * Parse ONE proposal from the compiler.
 *
 * Returns null rather than a repaired card. A proposal missing its id, its scope or
 * its destination is not a slightly-wrong decision — it is a decision whose reach we
 * cannot state, and rendering it with a default would put words in the Coach's mouth
 * about how far it applies.
 */
export function parseDecisionCard(raw: unknown): CoachDecisionCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' && UUID_RE.test(value.id.trim()) ? value.id.trim() : null;
  if (!id) return null;
  const scope = typeof value.scope === 'string' && SCOPES.has(value.scope) ? (value.scope as DecisionScope) : null;
  const destination = typeof value.destination === 'string' && DESTINATIONS.has(value.destination)
    ? (value.destination as DecisionDestination) : null;
  if (!scope || !destination) return null;

  const insufficientEvidence = value.insufficientEvidence === true;
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    && value.confidence >= 0 && value.confidence <= 1 ? value.confidence : null;

  return {
    id,
    content: {
      trigger: trimmed(value.trigger) ?? '',
      rejectedTreatment: trimmed(value.rejectedTreatment) ?? '',
      selectedTreatment: trimmed(value.selectedTreatment) ?? '',
      rationale: trimmed(value.rationale) ?? '',
      invariant: trimmed(value.invariant),
      exception: trimmed(value.exception),
      scope,
    },
    destination,
    confidence,
    evidence: {
      annotationIds: idList(value.annotationIds, UUID_RE),
      evidenceDigests: idList(value.evidenceDigests, SHA256_RE).map((entry) => entry.toLowerCase()),
    },
    affectedStep: trimmed(value.affectedStep),
    affectedCapability: trimmed(value.affectedCapability),
    insufficientEvidence,
    disposition: 'proposed',
    mergedIntoId: null,
    editedByCoach: false,
  };
}

/** Parse a compiler response. Unreadable proposals are DROPPED, never invented. */
export function parseDecisionCards(raw: unknown): readonly CoachDecisionCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseDecisionCard).filter((card): card is CoachDecisionCard => card !== null);
}
