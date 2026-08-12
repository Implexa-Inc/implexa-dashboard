/**
 * lib/landing.ts — composing the state-aware landing snapshot from the
 * AUTHORITATIVE read models, and from nothing else.
 *
 * WHAT WAS WRONG BEFORE. /start derived "does anything need me?" from two raw
 * `skill_runs` predicates: `review_status = 'pending' or run_state = 'stalled'`,
 * and `run_state in (queued, running)`. That is a third read authority invented
 * in a page, and it is blind to most of what actually needs a human:
 *
 *   - Judge blocks and typed held runs (`NeedsYou.attentionItems`)
 *   - ungranted permissions (`needGrant`)
 *   - signed-out connections (`signIns`)
 *   - failed and never-armed schedules (`missed`)
 *   - everything the review queue knows that a `review_status` column does not
 *   - and, worst, every PARTIAL or TRUNCATED state in all of the above
 *
 * A user with a Judge-blocked run and a signed-out Google account would have
 * been sent to Agents, told by omission that nothing needed them. That is the
 * silent-stop failure the Needs-you and Review models exist to prevent, and it
 * must not be reintroduced one layer up.
 *
 * So the snapshot is composed from the three models that own these facts:
 *
 *   lib/needs-you.ts  loadNeedsYou   — grants, sign-ins, schedules, stalls,
 *                                     Judge blocks, held runs, partial/truncated
 *   lib/review.ts     getReviewQueue — the review queue and its per-source states
 *   lib/live-feed-server.ts  getLiveFeed — what is in flight right now
 *
 * THIS FILE IS PURE, and the models arrive as arguments — the same split as
 * lib/agents-feed-core.ts, and for the same reason: `lib/needs-you.ts` pulls
 * `server-only`, which does not resolve under node:test, and the honesty rules
 * below are exactly what needs executable tests. The async wrapper that supplies
 * the real models lives in lib/landing-load.ts.
 */

import { anySignal, type LandingSnapshot, type Signal } from './navigation';
import { reviewQueueWarning, type ReviewQueue } from './review';
// TYPE-ONLY: erased at runtime by the type stripper, so this module never loads
// needs-you.ts (and therefore never touches `server-only`) during tests.
import type { NeedsYou } from './needs-you';

/**
 * Live statuses that mean a job is IN FLIGHT (DESIGN.md §4.3 rule 2). Mirrors
 * the lifecycle vocabulary running-agents.tsx renders.
 */
export const LIVE_IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'selecting', 'picked_up', 'starting', 'switching', 'resuming', 'running', 'verifying',
]);

/**
 * Live statuses that mean a job is WAITING ON THE HUMAN. These belong to rule 1,
 * not rule 2 — and they are read here as well as from Needs-you deliberately:
 * the feeds refresh independently, and the only cost of both seeing the same
 * fact is landing on Work, which is the safe direction.
 */
export const LIVE_NEEDS_YOU_STATUSES: ReadonlySet<string> = new Set([
  'waiting_approval', 'needs_attention', 'fallback_blocked', 'start_failed',
  'claim_expired', 'failed', 'action_available',
]);

/** The narrow slices of each model the rule actually reads. */
export type NeedsYouSummary    = Pick<NeedsYou, 'total' | 'partial' | 'truncated'>;
export type ReviewQueueSummary = Pick<ReviewQueue, 'items' | 'sources' | 'truncated' | 'live'>;
export type LiveSummary =
  | { status: 'ready'; items: ReadonlyArray<{ status?: string | null }> }
  | { status: 'unavailable'; reason: string };

/**
 * What each model looks like when it could not be read at all — used by
 * lib/landing-load.ts when a model throws.
 *
 * These are the "we could not see this" shapes, NOT the "there is nothing"
 * shapes, and they live here so the fail-closed contract is a tested fact
 * rather than three literals inline in a catch block. `partial: true`,
 * `live: false` and `status: 'unavailable'` are each what makes the
 * corresponding signal `unknown`.
 */
export const UNREADABLE_NEEDS: NeedsYouSummary    = { total: 0, partial: true, truncated: false };
export const UNREADABLE_QUEUE: ReviewQueueSummary = { items: [], sources: {}, truncated: false, live: false };
export const UNREADABLE_LIVE:  LiveSummary        = { status: 'unavailable', reason: 'load_failed' };

/**
 * How long the landing may wait for any one model before calling it unreadable.
 *
 * /start now sits in the sign-in path, and the review queue alone allows itself
 * 20s for a cold database. Waiting that long to decide which page to open would
 * make logging in feel broken. A model that misses this deadline is `unknown`,
 * which lands on Work — the same answer as any other unreadable source, and the
 * safe direction.
 */
export const LANDING_READ_DEADLINE_MS = 3500;

/**
 * Resolve `p`, or `fallback` if it has not settled within `ms`. A rejection also
 * yields `fallback`, so callers get the unreadable shape either way.
 *
 * Pure (modulo the timer) and exported so the deadline behaviour is testable
 * without waiting on a real backend.
 */
export function settleWithin<T>(p: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const finish = (v: T) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => finish(fallback), ms);
    // Do not keep a serverless invocation alive purely for this timer.
    (timer as unknown as { unref?: () => void }).unref?.();
    Promise.resolve(p).then(finish, () => finish(fallback));
  });
}

/**
 * Compose the snapshot. Every input may answer `unknown`, and `unknown` never
 * decays to `no`: Agents is only reachable when all three models positively
 * said there is nothing.
 */
export function landingSnapshot(
  needs: NeedsYouSummary,
  queue: ReviewQueueSummary,
  live:  LiveSummary,
): LandingSnapshot {
  return {
    needsDecision: anySignal(needsYouSignal(needs), reviewSignal(queue), liveSignal(live, LIVE_NEEDS_YOU_STATUSES)),
    inProgress:    liveSignal(live, LIVE_IN_FLIGHT_STATUSES),
  };
}

/**
 * A non-zero total is decisive even when the read was partial — we know work is
 * there. Zero over a partial or truncated read is `unknown`, never `no`.
 */
function needsYouSignal(n: NeedsYouSummary): Signal {
  if (n.total > 0) return 'yes';
  return n.partial || n.truncated ? 'unknown' : 'no';
}

/**
 * `reviewQueueWarning` is already the model's own "this list cannot be trusted
 * as complete" test — it covers an unreachable endpoint, truncation, and any
 * individual source reporting `unavailable` (while treating `disabled` as
 * configuration, not failure). Reusing it keeps one definition of a trustworthy
 * queue instead of a second opinion here.
 */
function reviewSignal(q: ReviewQueueSummary): Signal {
  if (q.items.length > 0) return 'yes';
  return reviewQueueWarning(q) === null ? 'no' : 'unknown';
}

function liveSignal(live: LiveSummary, statuses: ReadonlySet<string>): Signal {
  if (live.status !== 'ready') return 'unknown';
  return live.items.some((c) => statuses.has(String(c?.status ?? ''))) ? 'yes' : 'no';
}
