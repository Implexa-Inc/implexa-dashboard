// node --test lib/live-lifecycle-continuity.test.ts
//
// The ten required continuity cases, plus the ways this cache could itself
// become a liar: a card held forever, a card inheriting another request's
// identity, a Cancel fired at work whose state we are not currently confirming.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reduceLiveFeed,
  emptyContinuityState,
  continuityKey,
  cancellationTarget,
  resolveConfirmTarget,
  freshnessNotice,
  statusRank,
  isTerminalStatus,
  CONTINUITY_GRACE_MS,
  REGRESSION_TOLERANCE_POLLS,
  type ContinuityCard,
  type ContinuityState,
} from './live-lifecycle-continuity.ts';

const REQ = '5b3c1755-c563-433d-90cb-f7024de2f05a';   // the production request id
const OTHER_REQ = '11111111-1111-1111-1111-111111111111';
const RUN = '22222222-2222-2222-2222-222222222222';
const T0 = Date.parse('2026-08-21T10:00:00.000Z');

function card(over: Partial<ContinuityCard> = {}): ContinuityCard {
  return {
    runId: null, requestId: REQ, skillSlug: 'clean-cut', status: 'preparing_inputs',
    since: '2026-08-21T09:58:00.000Z', finishedAt: null, lastProgressAt: null,
    cancelable: true, isTerminal: false, bytesRead: 970, totalBytes: 1000, ...over,
  };
}

function feed(
  state: ContinuityState,
  items: ContinuityCard[] | 'unreadable',
  nowMs: number,
) {
  return reduceLiveFeed(state, items === 'unreadable' ? { kind: 'unreadable' } : { kind: 'items', items }, nowMs);
}

// ── 1 ────────────────────────────────────────────────────────────────────────
test('1 · Preparing 97%, then a successful poll omits the id — the card remains', () => {
  const first = feed(emptyContinuityState(), [card()], T0);
  assert.equal(first.cards.length, 1);
  assert.equal(first.cards[0].freshness, 'fresh');

  // A well-formed, successful, EMPTY response — exactly what production returned.
  const second = feed(first.state, [], T0 + 15_000);
  assert.equal(second.cards.length, 1, 'the in-flight card must survive a successful omission');
  assert.equal(second.cards[0].continuityKey, REQ);
  assert.equal(second.cards[0].status, 'preparing_inputs');
  assert.equal(second.cards[0].freshness, 'retained');
  assert.deepEqual(second.retainedKeys, [REQ]);
  assert.equal(freshnessNotice(second.cards[0].freshness), 'Updating status…');
});

// ── 2 ────────────────────────────────────────────────────────────────────────
test('2 · the whole lifecycle keeps ONE identity and one card throughout', () => {
  const ladder: Array<[string, Partial<ContinuityCard>]> = [
    ['preparing_inputs', { bytesRead: 970, totalBytes: 1000 }],
    ['preparing_inputs', { bytesRead: 1000, totalBytes: 1000 }],     // 100% verified
    ['preparing_inputs', { bytesRead: 1000, totalBytes: 1000, cancelable: false }], // finalizing
    ['queued', {}],
    ['selecting', {}],
    ['starting', {}],
    ['running', { runId: RUN }],
  ];
  let state = emptyContinuityState();
  let at = T0;
  const seenKeys = new Set<string>();
  for (const [status, over] of ladder) {
    const result = feed(state, [card({ status, ...over })], at);
    assert.equal(result.cards.length, 1, `${status}: exactly one card`);
    assert.equal(result.cards[0].status, status);
    assert.equal(result.cards[0].freshness, 'fresh');
    seenKeys.add(result.cards[0].continuityKey);
    state = result.state;
    at += 15_000;
  }
  assert.deepEqual([...seenKeys], [REQ], 'one identity from Preparing all the way to Running');
});

test('2b · "Preparing 100%" becomes Finalizing rather than disappearing', () => {
  const at100 = feed(emptyContinuityState(), [card({ bytesRead: 1000, totalBytes: 1000 })], T0);
  assert.equal(at100.cards[0].bytesRead, 1000);
  assert.equal(at100.cards[0].cancelable, true);
  // Finalizing is the same status word with cancellation withdrawn — the fence
  // the backend owns. The card must persist and simply stop offering Cancel.
  const finalizing = feed(at100.state, [card({ bytesRead: 1000, totalBytes: 1000, cancelable: false })], T0 + 15_000);
  assert.equal(finalizing.cards.length, 1);
  assert.equal(finalizing.cards[0].freshness, 'fresh');
  assert.equal(cancellationTarget(finalizing.cards[0]), null, 'a finalizing preparation is past the cancel point');
});

// ── 3 ────────────────────────────────────────────────────────────────────────
test('3 · a same-id successor replaces its predecessor without duplicating', () => {
  const prep = feed(emptyContinuityState(), [card({ status: 'preparing_inputs' })], T0);
  const queued = feed(prep.state, [card({ status: 'queued' })], T0 + 15_000);
  assert.equal(queued.cards.length, 1);
  assert.equal(queued.cards[0].status, 'queued');
  assert.equal(queued.state.entries.size, 1, 'no orphan entry left behind');

  // And once the run is born, the run card carries the SAME request identity.
  const running = feed(queued.state, [card({ status: 'running', runId: RUN })], T0 + 30_000);
  assert.equal(running.cards.length, 1, 'the request card and its run card are one item');
  assert.equal(running.cards[0].continuityKey, REQ);
  assert.equal(running.cards[0].runId, RUN);
});

// ── 4 ────────────────────────────────────────────────────────────────────────
test('4 · a different request can neither replace nor cancel the target', () => {
  const first = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  const both = feed(first.state, [
    card({ status: 'running', runId: RUN }),
    // Same agent, same slug, different request — the exact shape that used to
    // let one item inherit another's card.
    card({ requestId: OTHER_REQ, runId: null, status: 'queued' }),
  ], T0 + 15_000);
  assert.equal(both.cards.length, 2, 'a shared slug is not a shared identity');
  assert.deepEqual(both.cards.map((c) => c.continuityKey).sort(), [OTHER_REQ, REQ].sort());
  assert.deepEqual(cancellationTarget(both.cards.find((c) => c.continuityKey === OTHER_REQ)!), { requestId: OTHER_REQ });
  const target = both.cards.find((c) => c.continuityKey === REQ)!;
  assert.equal(cancellationTarget(target)!.requestId, REQ, 'cancel names the exact request, never the neighbour');
});

test('4b · a card arriving with only a slug in common cannot take over an entry', () => {
  const first = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  const impostor = feed(first.state, [
    { skillSlug: 'clean-cut', status: 'queued', requestId: null, runId: null },
  ], T0 + 15_000);
  const tracked = impostor.cards.filter((c) => c.continuityKey === REQ);
  assert.equal(tracked.length, 1, 'the real entry is held, not overwritten');
  assert.equal(tracked[0].status, 'running');
  assert.equal(tracked[0].freshness, 'retained');
  const untracked = impostor.cards.find((c) => c.continuityKey.startsWith('untracked:'));
  assert.ok(untracked, 'an identity-less card still renders');
  assert.equal(cancellationTarget(untracked!), null, 'but it can never be cancelled');
});

// ── 5 ────────────────────────────────────────────────────────────────────────
test('5 · a terminal state retires continuity retention immediately', () => {
  const running = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  const finished = feed(running.state, [card({ status: 'finished', runId: RUN, isTerminal: true, finishedAt: '2026-08-21T10:05:00.000Z' })], T0 + 15_000);
  assert.equal(finished.cards[0].status, 'finished');

  // One tick later the backend stops listing it. A terminal is an END: it does
  // not get held open for the grace window.
  const gone = feed(finished.state, [], T0 + 20_000);
  assert.deepEqual(gone.retainedKeys, [], 'a finished item is not retained');
  assert.deepEqual(gone.releasedKeys, [REQ]);
  assert.equal(gone.cards.length, 0);
});

test('5c · terminality declared by the backend flag alone still retires the hold', () => {
  // A COMPLETED run held for approval: the run lane reports status
  // 'waiting_approval' with is_terminal true, because run_state IS terminal even
  // though the product word is a standing to-do. Only the flag says so, and it
  // must be believed — holding it open would keep an ended run in the live feed
  // after the backend stopped listing it.
  const held = feed(emptyContinuityState(),
    [card({ status: 'waiting_approval', runId: RUN, isTerminal: true })], T0);
  assert.equal(held.cards.length, 1);
  assert.equal(held.cards[0].status, 'waiting_approval');
  const gone = feed(held.state, [], T0 + 1_000);
  assert.deepEqual(gone.retainedKeys, [], 'a backend-declared terminal is not held');
  assert.deepEqual(gone.releasedKeys, [REQ]);

  // …and without the flag, the same status IS held: the word alone decides nothing.
  const live = feed(emptyContinuityState(),
    [card({ status: 'waiting_approval', runId: RUN, isTerminal: false })], T0);
  const stillThere = feed(live.state, [], T0 + 1_000);
  assert.deepEqual(stillThere.retainedKeys, [REQ]);
});

test('5b · a terminal FAILURE retires just as promptly as a success', () => {
  const running = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  const failed = feed(running.state, [card({ status: 'failed', runId: RUN, isTerminal: true })], T0 + 15_000);
  const gone = feed(failed.state, [], T0 + 16_000);
  assert.deepEqual(gone.releasedKeys, [REQ]);
});

// ── 6 ────────────────────────────────────────────────────────────────────────
test('6 · the hold is bounded — genuinely vanished work eventually leaves', () => {
  let state = feed(emptyContinuityState(), [card()], T0).state;
  // Just inside the bound: still held.
  const inside = feed(state, [], T0 + CONTINUITY_GRACE_MS - 1);
  assert.deepEqual(inside.retainedKeys, [REQ]);
  assert.equal(inside.cards.length, 1);

  // At the bound: released. The confirmedAt stamp does NOT advance while held,
  // so the window measures from the last real confirmation, not from the last
  // time we chose to hold — otherwise a held card renews itself forever.
  state = feed(emptyContinuityState(), [card()], T0).state;
  for (const at of [T0 + 15_000, T0 + 30_000, T0 + 44_000]) {
    state = feed(state, [], at).state;
  }
  const expired = feed(state, [], T0 + CONTINUITY_GRACE_MS);
  assert.deepEqual(expired.retainedKeys, [], 'the hold must not renew itself');
  assert.deepEqual(expired.releasedKeys, [REQ]);
  assert.equal(expired.cards.length, 0);
});

// ── 7 ────────────────────────────────────────────────────────────────────────
test('7 · a fetch failure preserves the last known state and discloses it', () => {
  const first = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  const failed = feed(first.state, 'unreadable', T0 + 15_000);
  assert.equal(failed.cards.length, 1);
  assert.equal(failed.cards[0].status, 'running');
  assert.equal(failed.cards[0].freshness, 'stale');
  assert.match(freshnessNotice('stale')!, /could not reach the backend/);
  assert.equal(cancellationTarget(failed.cards[0]), null,
    'we must not offer to cancel work whose state we are not currently confirming');
});

test('7b · an unreadable response neither confirms nor expires anything', () => {
  let state = feed(emptyContinuityState(), [card()], T0).state;
  // A long outage: nothing is confirmed, so nothing ages out on these ticks.
  for (const at of [T0 + 15_000, T0 + 60_000, T0 + 600_000]) {
    const result = feed(state, 'unreadable', at);
    assert.equal(result.cards.length, 1, 'an outage does not delete what we last knew');
    assert.deepEqual(result.releasedKeys, []);
    state = result.state;
  }
  // The moment a readable response arrives and still omits it, the bound applies
  // — measured from the last real confirmation, so it expires at once.
  const readable = feed(state, [], T0 + 600_001);
  assert.deepEqual(readable.releasedKeys, [REQ]);
});

// ── 8 ────────────────────────────────────────────────────────────────────────
test('8 · a successful EMPTY response does not instantly erase recent work', () => {
  const first = feed(emptyContinuityState(), [card({ status: 'queued' })], T0);
  const empty = feed(first.state, [], T0 + 1_000);
  assert.equal(empty.cards.length, 1);
  assert.equal(empty.cards[0].freshness, 'retained');
  assert.equal(empty.cards[0].status, 'queued');
});

// ── 9 ────────────────────────────────────────────────────────────────────────
test('9 · a reload converges on backend authority — the cache does not survive it', () => {
  const before = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  assert.equal(before.cards.length, 1);
  // A reload starts from the empty state. Whatever the backend says next IS the
  // answer; nothing is carried over, because nothing is persisted.
  const afterReload = feed(emptyContinuityState(), [], T0 + 15_000);
  assert.equal(afterReload.cards.length, 0, 'held state must be in memory only');
  assert.equal(afterReload.state.entries.size, 0);
});

// ── 10 ───────────────────────────────────────────────────────────────────────
test('10 · Cancel is offered only for the exact request in a cancellable phase', () => {
  assert.deepEqual(cancellationTarget({ ...card(), freshness: 'fresh' }), { requestId: REQ });

  for (const [why, sample] of [
    ['a held card', { ...card(), freshness: 'retained' }],
    ['a stale card', { ...card(), freshness: 'stale' }],
    ['a phase the backend closed', { ...card({ cancelable: false }), freshness: 'fresh' }],
    ['a terminal card', { ...card({ status: 'failed', isTerminal: true }), freshness: 'fresh' }],
    ['a finished card', { ...card({ status: 'finished' }), freshness: 'fresh' }],
    ['a card with no request identity', { ...card({ requestId: null, runId: RUN }), freshness: 'fresh' }],
    ['nothing at all', null],
  ] as const) {
    assert.equal(cancellationTarget(sample as never), null, `${why} must not offer Cancel`);
  }
});

// ── monotonicity, and its bound ──────────────────────────────────────────────
test('progression is monotonic: a lower state does not flicker over a higher one', () => {
  const running = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  const flicker = feed(running.state, [card({ status: 'queued', runId: null })], T0 + 5_000);
  assert.equal(flicker.cards[0].status, 'running', 'a backwards report inside the window does not repaint');
  // …but it is HELD, not confirmed, and it says so. Publishing a held card as
  // fresh let a Stop fire at a state the backend had already superseded.
  assert.equal(flicker.cards[0].freshness, 'retained');
  assert.equal(cancellationTarget(flicker.cards[0]), null,
    'no destructive action on a state we are not confirming');
});

test('a regression-held card offers no destructive control while it is held', () => {
  // The exact shape: the backend says the executor was fenced and the request
  // now has NO bound run, while the display still reads "Running" with the old
  // run id. Acting on that killed the abandoned attempt.
  const running = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  const fenced = feed(running.state, [card({
    status: 'switching', runId: null, cancelable: true,
    fallbackReason: 'the executor was fenced mid-step',
  })], T0 + 15_000);
  assert.equal(fenced.cards[0].status, 'running', 'the display stays monotonic');
  assert.equal(fenced.cards[0].freshness, 'retained', 'the certainty does not');
  assert.equal(cancellationTarget(fenced.cards[0]), null);
  assert.equal(freshnessNotice(fenced.cards[0].freshness), 'Updating status…');
});

test('AT THE REAL POLL CADENCE the backend wins — the window must not self-refresh', () => {
  // THE BUG THIS EXISTS TO CATCH. The hold was a wall-clock window measured from
  // the LAST poll, so at a 15s cadence with a 20s window the elapsed time was
  // ~15s on every tick and the window never closed. Every fenced executor
  // fallback (running → switching_executor, a real backwards step written by
  // 0177) was then frozen as "Running" indefinitely: the fallback reason never
  // rendered, and a request the backend called cancellable showed no control.
  //
  // A single 60s jump passes either way. Only polling like the component polls
  // can tell the two apart.
  const POLL_MS = 15_000;
  let state = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0).state;
  const seen: string[] = [];
  for (let tick = 1; tick <= 8; tick += 1) {
    const result = feed(state, [card({
      status: 'switching', runId: null, cancelable: true,
      fallbackReason: 'the executor was fenced mid-step',
    })], T0 + tick * POLL_MS);
    seen.push(String(result.cards[0].status));
    state = result.state;
  }
  assert.ok(seen.includes('switching'),
    `the backend must win within a bounded number of polls; saw ${seen.join(' → ')}`);
  const settled = seen.indexOf('switching');
  assert.ok(settled <= 3, `and within ~2 polls, not ${settled}`);
  assert.equal(seen.at(-1), 'switching', 'and it must STAY won, not oscillate');
});

test('the executor-fallback card carries its reason and its cancel control once accepted', () => {
  let state = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0).state;
  const fallback = card({
    status: 'switching', runId: null, cancelable: true,
    fallbackReason: 'the executor was fenced mid-step',
  });
  let last = feed(state, [fallback], T0);
  for (const at of [T0 + 15_000, T0 + 30_000, T0 + 45_000]) last = feed(last.state, [fallback], at);
  assert.equal(last.cards[0].status, 'switching');
  assert.equal(last.cards[0].fallbackReason, 'the executor was fenced mid-step',
    'the reason the user needs is on the card the user sees');
  assert.deepEqual(cancellationTarget(last.cards[0]), { requestId: REQ },
    'a frozen card also froze cancellation off');
});

test('a fallback_blocked request is terminal: no hold, and never cancellable', () => {
  const blocked = feed(emptyContinuityState(),
    [card({ status: 'fallback_blocked', cancelable: true })], T0);
  assert.equal(blocked.cards.length, 1);
  assert.equal(cancellationTarget(blocked.cards[0]), null,
    'replaying a consequential step could duplicate an external side effect');
  const gone = feed(blocked.state, [], T0 + 1_000);
  assert.deepEqual(gone.releasedKeys, [REQ], 'and it is an end, so it is not held open');
});

test('a SINGLE lower report is a flicker and never repaints', () => {
  // The counterpart to the cadence test above: one disagreeing poll, however
  // late it lands, is not evidence of a step back. Only SUSTAINED disagreement
  // is — which is why the window is measured from the first disagreement rather
  // than from the last poll.
  const state = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0).state;
  const late = feed(state, [card({ status: 'queued', runId: null })], T0 + 60_000);
  assert.equal(late.cards[0].status, 'running');
});

test('a persistent lower state wins, and progress forward is immediate', () => {
  // REGRESSION_TOLERANCE_POLLS consecutive disagreeing polls are tolerated as a
  // flicker; the next one is the backend telling us something.
  let state = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0).state;
  for (const at of [T0 + 15_000, T0 + 30_000]) {
    const held = feed(state, [card({ status: 'queued', runId: null })], at);
    assert.equal(held.cards[0].status, 'running', 'inside the window the higher state stands');
    state = held.state;
  }
  const won = feed(state, [card({ status: 'queued', runId: null })], T0 + 45_000);
  assert.equal(won.cards[0].status, 'queued', 'past it, the backend is the truth');

  const forward = feed(won.state, [card({ status: 'running', runId: RUN })], T0 + 60_000);
  assert.equal(forward.cards[0].status, 'running', 'moving forward is never held back');
});

test('both hold windows are BOUNDED — an unbounded one is an indefinite lie', () => {
  assert.ok(Number.isFinite(CONTINUITY_GRACE_MS) && CONTINUITY_GRACE_MS > 0 && CONTINUITY_GRACE_MS <= 120_000,
    `a card may not be held indefinitely; got ${CONTINUITY_GRACE_MS}`);
  assert.ok(Number.isInteger(REGRESSION_TOLERANCE_POLLS)
    && REGRESSION_TOLERANCE_POLLS > 0 && REGRESSION_TOLERANCE_POLLS <= 4,
    `a higher state may not outrank the backend indefinitely; got ${REGRESSION_TOLERANCE_POLLS}`);
});

test('a terminal always wins immediately, however it ranks', () => {
  const running = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  const cancelledish = feed(running.state, [card({ status: 'failed', runId: RUN, isTerminal: true })], T0 + 1_000);
  assert.equal(cancelledish.cards[0].status, 'failed');
});

// ── fail closed ──────────────────────────────────────────────────────────────
test('unknown or malformed lifecycle data cannot invent a tracked card', () => {
  const result = feed(emptyContinuityState(), [
    null as never,
    'nonsense' as never,
    card({ status: 'teleporting' }),          // unrankable
    card({ requestId: null, runId: null }),   // unidentifiable
  ], T0);
  assert.equal(result.state.entries.size, 0, 'nothing unusable enters the cache');
  assert.ok(result.cards.every((c) => c.continuityKey.startsWith('untracked:')));
  assert.ok(result.cards.every((c) => cancellationTarget(c) === null));
});

test('a duplicated identity within one response yields one card', () => {
  const result = feed(emptyContinuityState(), [
    card({ status: 'queued' }),
    card({ status: 'running' }),
  ], T0);
  assert.equal(result.cards.length, 1, 'the first authoritative row wins; the rest are ignored');
  assert.equal(result.cards[0].status, 'queued');
});

test('a card that loses its requestId does not fork into a second card', () => {
  const bound = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  const unbound = feed(bound.state, [{ ...card({ status: 'running', runId: RUN }), requestId: null }], T0 + 15_000);
  assert.equal(unbound.cards.length, 1, 'the established identity holds');
  assert.equal(unbound.cards[0].continuityKey, REQ);
});

test('a held card keeps its position in the list rather than jumping', () => {
  const three = feed(emptyContinuityState(), [
    card({ requestId: OTHER_REQ, status: 'running', runId: RUN }),
    card({ requestId: REQ, status: 'queued' }),
    card({ requestId: '33333333-3333-3333-3333-333333333333', status: 'starting' }),
  ], T0);
  assert.deepEqual(three.cards.map((c) => c.continuityKey),
    [OTHER_REQ, REQ, '33333333-3333-3333-3333-333333333333']);
  const middleOmitted = feed(three.state, [
    card({ requestId: OTHER_REQ, status: 'running', runId: RUN }),
    card({ requestId: '33333333-3333-3333-3333-333333333333', status: 'starting' }),
  ], T0 + 15_000);
  assert.deepEqual(middleOmitted.cards.map((c) => c.continuityKey),
    [OTHER_REQ, REQ, '33333333-3333-3333-3333-333333333333'],
    'the held card stays where the user last saw it');
  assert.equal(middleOmitted.cards[1].freshness, 'retained');
});

// ── the primitives, directly ─────────────────────────────────────────────────
test('identity never falls back to the workflow slug', () => {
  assert.equal(continuityKey(card()), REQ);
  assert.equal(continuityKey(card({ requestId: null, runId: RUN })), RUN);
  assert.equal(continuityKey({ skillSlug: 'clean-cut', status: 'queued' }), null);
  assert.equal(continuityKey(null), null);
});

test('the ladder is ordered and terminals sit at the top', () => {
  const order = ['installing_media_support', 'preparing_inputs', 'queued', 'selecting',
    'picked_up', 'starting', 'switching', 'verifying', 'running', 'needs_attention', 'finished'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(statusRank(order[i])! >= statusRank(order[i - 1])!,
      `${order[i - 1]} must not outrank ${order[i]}`);
  }
  assert.equal(statusRank('teleporting'), null);
  for (const terminal of ['finished', 'built', 'failed', 'start_failed', 'claim_expired']) {
    assert.ok(isTerminalStatus(terminal), `${terminal} is an end`);
  }
  for (const live of ['running', 'queued', 'preparing_inputs', 'waiting_approval', 'needs_attention']) {
    assert.ok(!isTerminalStatus(live), `${live} is not an end`);
  }
});

// ── a destructive dialog is bound to an identity, and dies with it ───────────
//
// The release path is what matters here and it needs the grace window to expire,
// which a rendered test at a 10ms cadence cannot reach — so the rule is graded
// where release IS deterministic.

test('a confirm dialog resolves to the card it named, held or fresh', () => {
  const first = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0);
  assert.equal(resolveConfirmTarget(first.cards, REQ)?.continuityKey, REQ);

  // Held through an omission: still the same card, still the same dialog.
  const held = feed(first.state, [], T0 + 1_000);
  assert.equal(resolveConfirmTarget(held.cards, REQ)?.freshness, 'retained');
});

test('a confirm dialog whose card was RELEASED resolves to nothing', () => {
  let state = feed(emptyContinuityState(), [card({ status: 'running', runId: RUN })], T0).state;
  const released = feed(state, [], T0 + CONTINUITY_GRACE_MS);
  assert.deepEqual(released.releasedKeys, [REQ]);
  assert.equal(resolveConfirmTarget(released.cards, REQ), null,
    'nothing to confirm — and the key must be retired, or the dialog springs back '
    + 'unasked when the same request returns');

  // …and when it does return, a stale key must not resurrect a destructive dialog.
  state = released.state;
  const returned = feed(state, [card({ status: 'running', runId: RUN })], T0 + CONTINUITY_GRACE_MS + 1_000);
  assert.equal(returned.cards.length, 1);
  assert.equal(resolveConfirmTarget(returned.cards, REQ)?.continuityKey, REQ,
    'the card is back — but only a key the user set may open a dialog for it');
});

test('a confirm dialog never approximates a target', () => {
  const two = feed(emptyContinuityState(), [
    card({ status: 'running', runId: RUN }),
    card({ requestId: OTHER_REQ, runId: null, status: 'queued' }),
  ], T0);
  assert.equal(resolveConfirmTarget(two.cards, 'no-such-key'), null,
    'an unmatched key resolves to nothing, never to the first card at hand');
  assert.equal(resolveConfirmTarget(two.cards, null), null);
  assert.equal(resolveConfirmTarget(null, REQ), null);
  assert.equal(resolveConfirmTarget(two.cards, OTHER_REQ)?.continuityKey, OTHER_REQ);
});

// ── the attended-continue handoff, and its cost ─────────────────────────────
//
// An attended continue's run is bound to no request — six attempts to infer
// which continue produced which run were each wrong, so the backend no longer
// guesses. Its bridge card is keyed by requestId; the run card that replaces it
// is keyed by runId. The reducer's runIndex only maps a run id a card actually
// carries, and a bridge carries none, so the handoff crosses keys.
//
// The cost is therefore a BOUNDED DUPLICATE, not a gap: the bridge is held for
// the grace window while the run card shows beside it, then released. Asserted
// here so it stays a known, bounded property rather than drifting.
//
// The alternative — letting the run card inherit the bridge's key — would make
// the handoff seamless but would hand one request's slot to another request's
// run, which is the thing this whole change exists to prevent. A transient
// duplicate that self-heals is the better trade, and it never hides work.

test('the attended-continue handoff overlaps, and never gaps', () => {
  const bridge = card({ requestId: REQ, runId: null, status: 'running', bytesRead: null, totalBytes: null });
  const runCard = card({ requestId: null, runId: RUN, status: 'running', bytesRead: null, totalBytes: null });

  const before = feed(emptyContinuityState(), [bridge], T0);
  assert.equal(before.cards.length, 1);
  assert.equal(before.cards[0].continuityKey, REQ);

  // The backend retires the bridge the moment the run is on screen.
  const during = feed(before.state, [runCard], T0 + 1_000);
  assert.equal(during.cards.length, 2, 'overlap, never a gap — the work is always visible');
  const keys = during.cards.map((c) => c.continuityKey).sort();
  assert.deepEqual(keys, [REQ, RUN].sort());
  const held = during.cards.find((c) => c.continuityKey === REQ);
  assert.equal(held?.freshness, 'retained', 'the bridge is held, and says so');
  assert.equal(cancellationTarget(held as never), null, 'a held bridge offers nothing destructive');
  const live = during.cards.find((c) => c.continuityKey === RUN);
  assert.equal(live?.freshness, 'fresh');
  assert.equal(live?.requestId, null, 'the run claims no request — that is the point');

  // …and the overlap is bounded by the grace window, not indefinite.
  const after = feed(during.state, [runCard], T0 + CONTINUITY_GRACE_MS + 1_000);
  assert.equal(after.cards.length, 1, 'the bridge is released once the grace expires');
  assert.equal(after.cards[0].continuityKey, RUN);
  assert.deepEqual(after.releasedKeys, [REQ]);
});
