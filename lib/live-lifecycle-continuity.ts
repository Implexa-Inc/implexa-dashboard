/**
 * lib/live-lifecycle-continuity.ts — a known piece of work may not disappear
 * mid-lifecycle just because one successful poll didn't mention it.
 *
 * THE INCIDENT (2026-08-21, preparation 5b3c1755-…). A large local-input run
 * showed "Preparing local input — 97% verified". Then the card vanished. An
 * unrelated older failed card became the top card. Minutes later the same work
 * reappeared as "Selecting". The agent ran fine the whole time.
 *
 * The backend half of that is fixed at its root (one statement snapshot, one
 * authoritative row per request id). This is the other half. <RunningAgents/>
 * called `setCards(items)` on every readable response, so the rendered list was
 * only ever the last response. A transport failure was already handled honestly
 * — keep the last cards, say we couldn't check. A SUCCESSFUL response that
 * omitted a request in flight was not: it erased it, confidently.
 *
 * So the feed is folded rather than replaced:
 *
 *   • identity is `requestId` (a preparation's id IS its reserved request id),
 *     falling back to `runId` for work that never had a request. NEVER the
 *     workflow slug — two live requests may share one, and a slug-keyed feed is
 *     how one request inherits another's card and another's Cancel button;
 *   • progression is monotonic, so "Preparing 100%" becomes "Finalizing" and
 *     never flickers backwards;
 *   • an omission is a GAP, not a deletion — the card is held, and says so
 *     ("Updating status…") rather than pretending to be current;
 *   • the hold is BOUNDED. Work that is genuinely gone leaves. A terminal state
 *     retires the hold immediately.
 *
 * Pure and clock-injected: every rule above is executable without React, a
 * network, or a timer — which is precisely what the original code was not.
 */

export type ContinuityStatus =
  | 'queued' | 'installing_media_support' | 'preparing_inputs' | 'selecting' | 'picked_up'
  | 'starting' | 'switching' | 'resuming' | 'fallback_blocked' | 'start_failed'
  | 'claim_expired' | 'waiting_approval' | 'needs_attention' | 'running' | 'verifying'
  | 'built' | 'failed' | 'finished' | 'action_available';

/** How current the rendered card actually is. The UI must not blur these. */
export type Freshness = 'fresh' | 'retained' | 'stale';

export type ContinuityCard = {
  runId?: string | null;
  requestId?: string | null;
  skillSlug?: string;
  status?: string;
  since?: string | null;
  finishedAt?: string | null;
  lastProgressAt?: string | null;
  cancelable?: boolean;
  isTerminal?: boolean;
  [key: string]: unknown;
};

export type ContinuityEntry<T extends ContinuityCard = ContinuityCard> = {
  /** The continuity identity. Stable across preparation → request → run. */
  key: string;
  card: T;
  rank: number;
  terminal: boolean;
  /** When this state was last confirmed by a readable response. */
  confirmedAt: number;
  /**
   * How many CONSECUTIVE readable polls have reported a lower state than the one
   * on screen. Reset to 0 the moment the backend agrees, or moves forward.
   */
  regressionCount: number;
  /** Where it sat in the last rendered list, so a held card keeps its place. */
  index: number;
};

export type ContinuityState<T extends ContinuityCard = ContinuityCard> = {
  entries: ReadonlyMap<string, ContinuityEntry<T>>;
  /** runId → key, so a card that loses its requestId does not fork in two. */
  runIndex: ReadonlyMap<string, string>;
};

export type ContinuityInput<T extends ContinuityCard = ContinuityCard> =
  /** A response we could read. `items` is what the backend currently asserts. */
  | { kind: 'items'; items: T[] }
  /** A 2xx whose body we could not understand, or a failed fetch. Same meaning: we do not know. */
  | { kind: 'unreadable' };

export type ContinuityResult<T extends ContinuityCard = ContinuityCard> = {
  state: ContinuityState<T>;
  cards: Array<T & { continuityKey: string; freshness: Freshness }>;
  /** Held through a successful omission — the "Updating status…" cases. */
  retainedKeys: string[];
  /** Dropped this tick: terminal, or past the bound. */
  releasedKeys: string[];
};

/**
 * How long a nonterminal card survives being omitted from responses we CAN
 * read. Three poll cycles at the feed's 15s cadence: long enough to cover a
 * lifecycle handoff and a missed tick, short enough that genuinely vanished
 * work leaves while the user is still looking at the screen.
 */
export const CONTINUITY_GRACE_MS = 45_000;

/**
 * How many consecutive disagreeing polls a HIGHER state may outrank the backend
 * before the backend wins.
 *
 * COUNTED, NOT TIMED, and that distinction is the whole point. The first version
 * of this measured wall-clock from the last poll — which at a 15s cadence and a
 * 20s window meant the elapsed time was ~15s on every tick and the window never
 * closed. A card frozen that way survives every fenced executor fallback as
 * "Running": the fallback reason never renders, and a request the backend says
 * IS cancellable shows no control.
 *
 * A count cannot self-refresh, and it says what we actually mean — one or two
 * disagreeing polls is a flicker across a lifecycle handoff, a third is the
 * backend telling us something. It is also independent of the poll cadence, so
 * it behaves identically in a rendered test and in production.
 */
export const REGRESSION_TOLERANCE_POLLS = 2;

/**
 * The lifecycle ladder, over the STATUS words every card carries. Ranks are
 * ordinal only — the gaps mean nothing, the ORDER is the whole contract.
 */
const RANK: Readonly<Record<string, number>> = Object.freeze({
  installing_media_support: 1,
  preparing_inputs: 2,
  queued: 3,
  selecting: 4,
  picked_up: 5,
  starting: 6,
  switching: 7,
  resuming: 7,
  verifying: 8,
  running: 9,
  // Needs-you states sit above running: something ran far enough to ask.
  needs_attention: 10,
  waiting_approval: 10,
  action_available: 10,
  // Terminals share the top rank — they are alternative ends, not later stages.
  built: 11,
  fallback_blocked: 11,
  finished: 11,
  failed: 11,
  start_failed: 11,
  claim_expired: 11,
});

const TERMINAL: ReadonlySet<string> = new Set([
  'built', 'finished', 'failed', 'start_failed', 'claim_expired',
  // Terminal at the REQUEST layer: replaying a consequential step could
  // duplicate an external side effect, so the backend closes the request and
  // marks it terminal. It is a standing "needs you" alert, not live work, and
  // it is emphatically not cancellable.
  'fallback_blocked',
]);

export function isTerminalStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL.has(status);
}

export function statusRank(status: unknown): number | null {
  if (typeof status !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(RANK, status) ? RANK[status] : null;
}

/**
 * The continuity identity, or null when the card cannot be tracked.
 *
 * requestId first — it is the ONE id that survives preparation → request → run.
 * runId second, for work that never had a request (a scheduled run). The slug is
 * deliberately absent: it is a label, and using it here is how a fresh request
 * inherits a finished run's card, and its Cancel.
 */
export function continuityKey(card: ContinuityCard | null | undefined): string | null {
  if (!card || typeof card !== 'object') return null;
  const requestId = typeof card.requestId === 'string' && card.requestId ? card.requestId : null;
  if (requestId) return requestId;
  const runId = typeof card.runId === 'string' && card.runId ? card.runId : null;
  return runId;
}

export function emptyContinuityState<T extends ContinuityCard = ContinuityCard>(): ContinuityState<T> {
  return { entries: new Map(), runIndex: new Map() };
}

/**
 * reduceLiveFeed(state, input, nowMs) — fold one poll into the continuity cache.
 *
 * `nowMs` is injected rather than read, so every bound below is testable without
 * waiting for a real clock.
 */
export function reduceLiveFeed<T extends ContinuityCard>(
  state: ContinuityState<T>,
  input: ContinuityInput<T>,
  nowMs: number,
): ContinuityResult<T> {
  const previous = state && state.entries instanceof Map ? state.entries : new Map<string, ContinuityEntry<T>>();
  const previousRunIndex = state && state.runIndex instanceof Map ? state.runIndex : new Map<string, string>();

  // UNREADABLE IS NOT EMPTY. A failed fetch, or a 2xx we could not parse, tells
  // us nothing about what is live — so nothing is confirmed, nothing expires,
  // and every card is republished marked STALE so the surface can say it is
  // showing the last thing it actually knew.
  if (!input || input.kind !== 'items' || !Array.isArray(input.items)) {
    const cards = [...previous.values()]
      .sort((a, b) => a.index - b.index)
      .map((entry) => ({ ...entry.card, continuityKey: entry.key, freshness: 'stale' as Freshness }));
    return { state: { entries: previous, runIndex: previousRunIndex }, cards, retainedKeys: [], releasedKeys: [] };
  }

  const entries = new Map<string, ContinuityEntry<T>>();
  const runIndex = new Map<string, string>(previousRunIndex);
  const seen = new Set<string>();
  const ordered: Array<{ key: string; card: T; freshness: Freshness }> = [];
  const untracked: T[] = [];

  for (const item of input.items) {
    if (!item || typeof item !== 'object') continue;                 // fail closed
    const rank = statusRank(item.status);
    // An unknown status cannot be ranked, so it cannot be held, replaced, or
    // compared. Render it if the surface knows what to do with it, but never
    // admit it to the cache — inventing a rank is how a malformed row wins.
    let key = continuityKey(item);
    if (key === null || rank === null) { untracked.push(item); continue; }

    // A card that arrives without its requestId but WITH a run we are already
    // tracking is the same work, not new work. Keep the established identity so
    // a backend that stops carrying the request id cannot fork one card in two.
    const runId = typeof item.runId === 'string' && item.runId ? item.runId : null;
    if (runId && runIndex.has(runId)) key = runIndex.get(runId) as string;

    if (seen.has(key)) continue;    // one card per identity, whatever arrives
    seen.add(key);
    if (runId) runIndex.set(runId, key);

    const prior = previous.get(key);
    const terminal = item.isTerminal === true || isTerminalStatus(item.status);
    const regressing = !!prior && !terminal && rank < prior.rank;
    const regressionCount = regressing ? (prior as ContinuityEntry<T>).regressionCount + 1 : 0;
    let card = item;
    let heldRank = rank;
    let heldTerminal = terminal;
    if (regressing && regressionCount <= REGRESSION_TOLERANCE_POLLS) {
      // MONOTONIC, BUT BOUNDED. Inside the window the higher state stands, so a
      // handoff cannot flicker backwards on screen. Past it the backend wins,
      // because a request really can be queued again after a released claim —
      // and every fenced executor fallback IS such a step back — so freezing the
      // display on a stale "Running" would be its own lie.
      card = prior.card;
      heldRank = prior.rank;
      heldTerminal = prior.terminal;
    }

    entries.set(key, {
      key, card, rank: heldRank, terminal: heldTerminal,
      confirmedAt: nowMs, regressionCount, index: ordered.length,
    });
    // A HELD CARD IS NOT A CONFIRMED ONE, whichever way it came to be held.
    //
    // The monotonic hold keeps the OLD, higher card on screen while the backend
    // reports a lower state. Publishing that as 'fresh' let both destructive
    // paths act on it: for up to REGRESSION_TOLERANCE_POLLS the user saw
    // "Running" with a live Stop for a request the backend had already said was
    // switching executors and had no bound run — and confirming killed the
    // ABANDONED attempt while the request carried on under a new one. Same rule
    // as an omission: hold the display, withhold the certainty.
    ordered.push({ key, card, freshness: card === item ? 'fresh' : 'retained' });
  }

  // Anything the response did not mention. A terminal state retires immediately
  // — it reached an end, and holding an end open is not continuity, it is a
  // ghost. A nonterminal one is held, briefly, and says it is being re-checked.
  const retainedKeys: string[] = [];
  const releasedKeys: string[] = [];
  for (const [key, entry] of previous) {
    if (seen.has(key)) continue;
    if (entry.terminal || (nowMs - entry.confirmedAt) >= CONTINUITY_GRACE_MS) {
      releasedKeys.push(key);
      continue;
    }
    retainedKeys.push(key);
    // Held cards keep the slot they last occupied, so a lifecycle handoff does
    // not make the card jump down the list and read as a different item.
    const at = Math.min(entry.index, ordered.length);
    ordered.splice(at, 0, { key, card: entry.card, freshness: 'retained' });
    entries.set(key, { ...entry, index: at });
  }

  // Reindex once, after every insertion, so the next tick's slots are the slots
  // actually rendered this tick.
  ordered.forEach((row, index) => {
    const entry = entries.get(row.key);
    if (entry) entries.set(row.key, { ...entry, index });
  });
  for (const key of releasedKeys) runIndexDrop(runIndex, key);

  const cards: Array<T & { continuityKey: string; freshness: Freshness }> = ordered.map(
    (row) => ({ ...row.card, continuityKey: row.key, freshness: row.freshness }),
  );
  // Untracked cards render but are never cached: they have no identity to hold,
  // so they also cannot be held, replaced, or cancelled by mistake.
  for (const item of untracked) {
    cards.push({ ...item, continuityKey: `untracked:${cards.length}`, freshness: 'fresh' as Freshness });
  }

  return { state: { entries, runIndex }, cards, retainedKeys, releasedKeys };
}

function runIndexDrop(runIndex: Map<string, string>, key: string): void {
  for (const [runId, mapped] of [...runIndex]) {
    if (mapped === key) runIndex.delete(runId);
  }
}

/**
 * Cancellation authority for a rendered card.
 *
 * Four independent facts must all hold, and each closes a real way to get this
 * wrong: the action must name the EXACT request (never a slug, never "the card
 * at hand"); we must UNDERSTAND the phase we are cancelling from, because a
 * status outside the vocabulary is data we cannot reason about; the backend
 * must currently say this phase is cancellable; and we must be looking at a
 * state we just confirmed — offering to cancel a card we are only holding
 * through a gap would fire at work whose state we do not know.
 */
export function cancellationTarget(
  card: (ContinuityCard & { freshness?: Freshness }) | null | undefined,
): { requestId: string } | null {
  if (!card) return null;
  if (card.freshness && card.freshness !== 'fresh') return null;
  // FAIL CLOSED ON AN UNKNOWN PHASE. An unrankable status is a lifecycle we do
  // not model; treating it as cancellable would fire a destructive action from
  // a state we cannot name.
  if (statusRank(card.status) === null) return null;
  if (card.cancelable === false) return null;
  if (isTerminalStatus(card.status) || card.isTerminal === true) return null;
  const requestId = typeof card.requestId === 'string' && card.requestId ? card.requestId : null;
  if (!requestId) return null;
  return { requestId };
}

/**
 * resolveConfirmTarget(cards, key) — the card a confirm dialog is CURRENTLY about.
 *
 * A dialog is bound to an identity, not to a card object, so that a state change
 * while it is open is graded by the authority rule rather than by a snapshot. The
 * other half of that is this: when the identity no longer resolves, there is
 * nothing left to confirm. Without it the key outlived its card — open Stop, let
 * the item drop out of the feed, and when the same request came back the key
 * still matched, so a live destructive confirm reappeared unasked.
 *
 * Returns null rather than approximating. Never falls back to "the card at hand":
 * that is how one request's dialog ends up firing at another's work.
 */
export function resolveConfirmTarget<T extends { continuityKey?: string }>(
  cards: readonly T[] | null | undefined,
  key: string | null | undefined,
): T | null {
  if (!key || !Array.isArray(cards)) return null;
  return cards.find((card) => card && card.continuityKey === key) ?? null;
}

/** Honest copy for a card we are holding rather than confirming. */
export function freshnessNotice(freshness: Freshness | undefined): string | null {
  if (freshness === 'retained') return 'Updating status…';
  if (freshness === 'stale') return 'Last known status — we could not reach the backend';
  return null;
}
