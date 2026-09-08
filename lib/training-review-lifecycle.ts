/**
 * lib/training-review-lifecycle.ts — six facts, never one status.
 *
 * SPEC §1.3, which is a prohibition before it is a design:
 *
 *   "The UI and database must never collapse requested, demonstrated, implemented,
 *    verified, accepted, and activated into one status."
 *
 * ── WHY A STATUS ENUM WOULD BE WRONG ─────────────────────────────────────────────
 *
 * The tempting model is one `status` moving along a line. It is wrong here because
 * these are not stages of one thing — they are answers to six different questions,
 * and they genuinely disagree in production:
 *
 *   · a correction can be IMPLEMENTED and fail VERIFICATION;
 *   · a revision can be VERIFIED and the Coach still not ACCEPT it (§1.3: revision
 *     and learning are separate outcomes);
 *   · a decision can be ACCEPTED forever and never be ACTIVATED — that is the normal
 *     F0 resting state, not a missing step; and
 *   · any of the six can be UNREADABLE, which is not the same as "no".
 *
 * Collapsing them produces the specific product lie this feature exists to avoid: a
 * surface that shows one green tick and lets a Coach believe a future run learned
 * something when nothing was activated at all.
 *
 * So each fact is three-valued and carries its own words. PURE ON PURPOSE: the labels
 * and the derivations are the contract, and the render tests assert that the six read
 * DISTINCTLY on screen rather than trusting that six keys existed in an object.
 */

/**
 * Three-valued, per fact. `unknown` exists because a projection read can fail, and
 * `verified-artifacts.tsx` already established the house rule: unavailable is not
 * empty, and it is certainly not "no".
 */
export type FactStatus = 'yes' | 'no' | 'unknown';

export type LifecycleFactKey =
  | 'requested' | 'demonstrated' | 'implemented' | 'verified' | 'accepted' | 'activated';

/** Declaration order IS render order. Six rows, in the order §1.3 names them. */
export const LIFECYCLE_FACT_KEYS: readonly LifecycleFactKey[] = [
  'requested', 'demonstrated', 'implemented', 'verified', 'accepted', 'activated',
];

export type LifecycleFact = {
  readonly key: LifecycleFactKey;
  readonly status: FactStatus;
  /** ISO instant the fact became true, when the server named one. */
  readonly at: string | null;
  /** The server's own words for this fact, when it had any. Never invented here. */
  readonly detail: string | null;
};

export type AuthorityState = { readonly [K in LifecycleFactKey]: LifecycleFact };

/**
 * Distinct words per fact, in all three values.
 *
 * EVERY STRING BELOW IS DISTINCT, and a test asserts that across all 18. Two facts
 * sharing a sentence is exactly how a collapse re-enters after the type is right:
 * the object still has six keys, and the screen still says one thing twice.
 */
type FactCopy = { label: string; yes: string; no: string };

const COPY: Record<LifecycleFactKey, FactCopy> = {
  requested: {
    label: 'Correction requested',
    yes: 'You asked for this change.',
    no: 'No correction has been requested.',
  },
  demonstrated: {
    label: 'Demonstrated by you',
    yes: 'You showed the preferred work and explained it.',
    no: 'Nothing has been demonstrated for this correction.',
  },
  implemented: {
    label: 'Implemented in a revision',
    yes: 'A revision claims to carry out this correction.',
    no: 'No revision has carried this out yet.',
  },
  verified: {
    label: 'Verified by checks',
    yes: 'Checks and an independent review agreed the revision did it.',
    no: 'No check has confirmed the revision did this.',
  },
  accepted: {
    label: 'Accepted by you',
    yes: 'You accepted the revised result.',
    no: 'You have not accepted a revised result for this.',
  },
  activated: {
    label: 'Activated for future runs',
    yes: 'A later run may select this decision.',
    // The single most important "no" on the surface. It says what the state MEANS,
    // not merely that a flag is false.
    no: 'Not activated. Future runs behave exactly as they did before.',
  },
};

/** One shared unknown sentence is correct: it describes the READ, not the fact. */
export const FACT_UNKNOWN_SENTENCE =
  'Implexa could not read this just now. That does not mean it did not happen.';

export function factLabel(key: LifecycleFactKey): string {
  return COPY[key].label;
}

/**
 * `detail` is honoured for `yes` and for `unknown`, and NEVER for `no`.
 *
 * An unknown fact has two genuinely different causes — a read that failed, and a fact
 * this stage does not record at all — and the second deserves its own sentence rather
 * than being described as a failed read. A `no`, by contrast, takes only the pinned
 * words: a server-supplied sentence softening "Not activated" is precisely the collapse
 * this module exists to prevent, arriving through a data field after the types stopped
 * it at the door.
 */
export function factSentence(fact: LifecycleFact): string {
  switch (fact.status) {
    case 'yes': return fact.detail ?? COPY[fact.key].yes;
    case 'no': return COPY[fact.key].no;
    case 'unknown': return fact.detail ?? FACT_UNKNOWN_SENTENCE;
    default: {
      const never: never = fact.status;
      throw new Error(`factSentence: unhandled status ${String(never)}`);
    }
  }
}

/**
 * Visual weight, so the six do not render as one undifferentiated list. Distinct per
 * status — and a test asserts an `unknown` row is never styled as a `no`, because
 * "we could not read it" rendered in the grey of "it did not happen" is the collapse
 * arriving through CSS after the types stopped it.
 */
export type FactTone = 'affirmed' | 'not-yet' | 'unread';

export function factTone(fact: LifecycleFact): FactTone {
  switch (fact.status) {
    case 'yes': return 'affirmed';
    case 'no': return 'not-yet';
    case 'unknown': return 'unread';
    default: {
      const never: never = fact.status;
      throw new Error(`factTone: unhandled status ${String(never)}`);
    }
  }
}

// ── Inert candidate vs active learning ────────────────────────────────────────────

/**
 * §5 F0: "Canonical inert candidate links; no activation." and the must-not
 * "activate a learning".
 *
 * `inert` is not a weaker `active`. It is a different thing with a different
 * consequence for the customer's next run, so it gets its own type, its own heading,
 * and its own tone — and `activationStance` is computed from the ACTIVATED fact
 * alone. Deriving it from `accepted` is the bug this function exists to prevent:
 * acceptance of a revision is not activation of a learning (§1.3).
 */
export type ActivationStance = 'inert_candidate' | 'active_learning' | 'unknown';

export function activationStance(state: AuthorityState): ActivationStance {
  switch (state.activated.status) {
    case 'yes': return 'active_learning';
    case 'no': return 'inert_candidate';
    case 'unknown': return 'unknown';
    default: {
      const never: never = state.activated.status;
      throw new Error(`activationStance: unhandled status ${String(never)}`);
    }
  }
}

/**
 * A convenience for tests and for the mutation harness: does this state claim
 * anything about the future? Exactly one fact may answer that.
 */
export function changesFutureRuns(state: AuthorityState): boolean {
  return state.activated.status === 'yes';
}

// ── Parsing ───────────────────────────────────────────────────────────────────────

const STATUSES: ReadonlySet<string> = new Set<FactStatus>(['yes', 'no', 'unknown']);

function parseFact(key: LifecycleFactKey, raw: unknown): LifecycleFact {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    // A missing or malformed fact is UNKNOWN, never `no`. Defaulting to `no` would
    // let a truncated payload render a confident "not activated" for a state we did
    // not read — and the same defaulting elsewhere would render a confident
    // "activated: no" for something that IS active.
    return { key, status: 'unknown', at: null, detail: null };
  }
  const value = raw as Record<string, unknown>;
  const status = typeof value.status === 'string' && STATUSES.has(value.status)
    ? (value.status as FactStatus) : 'unknown';
  const at = typeof value.at === 'string' && value.at.trim() ? value.at.trim() : null;
  const detail = typeof value.detail === 'string' && value.detail.trim() ? value.detail.trim() : null;
  return { key, status, at, detail: status === 'yes' ? detail : null };
}

export function parseAuthorityState(raw: unknown): AuthorityState {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? (raw as Record<string, unknown>) : {};
  const out = {} as { [K in LifecycleFactKey]: LifecycleFact };
  for (const key of LIFECYCLE_FACT_KEYS) out[key] = parseFact(key, source[key]);
  return out;
}

/** An all-unknown state: what an unreadable projection produces. */
export function unknownAuthorityState(): AuthorityState {
  return parseAuthorityState({});
}

// ── Deriving the six from what the backend actually says ──────────────────────────

/**
 * Sentences for the facts THIS STAGE DOES NOT RECORD.
 *
 * These are `unknown`, not `no`. "No revision has carried this out yet" would be a
 * claim about revisions, and F0 has no revision authority at all — `revisions` is in
 * the backend contract's own `outOfScope` list. Answering a question we were never
 * given the data to answer, in the confident words of a `no`, is the §1.3 collapse.
 *
 * They are also not the failed-read sentence, because the read did not fail. Saying
 * "Implexa could not read this" about something Implexa never stores would train a
 * Coach to distrust a message that means something specific elsewhere.
 */
export const NOT_CARRIED_HERE: Partial<Record<LifecycleFactKey, string>> = {
  requested: 'This stage records what you taught, not what you asked for. Implexa cannot say.',
  implemented: 'No revision has been made from this teaching yet, so there is nothing to report.',
  verified: 'Nothing can be verified until a revision runs. That has not happened yet.',
  accepted: 'There is no revised result to accept yet.',
};

const fact = (
  key: LifecycleFactKey, status: FactStatus, detail: string | null = null, at: string | null = null,
): LifecycleFact => ({ key, status, at, detail });

/**
 * Derive the six facts from one parsed training review.
 *
 * ONLY `demonstrated` AND `activated` ARE ANSWERABLE FROM F0's DATA, and both are read
 * from something the server STATED rather than inferred here:
 *
 *   · `demonstrated` — a demonstration source is present on the review;
 *   · `activated`    — the server's own `learning` block, which reports
 *                      `activatedCount` and `versionsCreated` explicitly and says in
 *                      words that nothing has changed the Agent.
 *
 * A missing `learning` block gives UNKNOWN, not `no`. Defaulting to `no` would render a
 * confident "Not activated" for a record whose learning we never read — and the same
 * defaulting, on the day activation exists, would render a confident "not activated"
 * for something that IS active.
 *
 * `decisions` is accepted and deliberately UNUSED for `accepted`: confirming a decision
 * card is not accepting a revised result (§1.3), and wiring the two together here is
 * the single most likely way this collapse comes back.
 */
export function deriveAuthorityState(input: {
  source: unknown;
  learning: { activatedCount: number; versionsCreated: number; note: string | null } | null;
  decisions?: readonly unknown[];
}): AuthorityState {
  const demonstrated: LifecycleFact = input.source
    ? fact('demonstrated', 'yes')
    : fact('demonstrated', 'unknown');

  let activated: LifecycleFact;
  if (!input.learning) {
    activated = fact('activated', 'unknown');
  } else if (input.learning.activatedCount === 0 && input.learning.versionsCreated === 0) {
    activated = fact('activated', 'no');
  } else {
    activated = fact('activated', 'yes');
  }

  return {
    requested: fact('requested', 'unknown', NOT_CARRIED_HERE.requested ?? null),
    demonstrated,
    implemented: fact('implemented', 'unknown', NOT_CARRIED_HERE.implemented ?? null),
    verified: fact('verified', 'unknown', NOT_CARRIED_HERE.verified ?? null),
    accepted: fact('accepted', 'unknown', NOT_CARRIED_HERE.accepted ?? null),
    activated,
  };
}
