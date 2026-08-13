/**
 * lib/live-feed-backoff.ts — the PURE decisions of the shared live-feed poller
 * (lib/live-feed-poll.ts). Alias-free so node:test imports it directly.
 *
 * The old shape: every mounted <AgentActions/> ran its OWN 5-second interval
 * forever (two instances on the agent page = two polls + two getSession()s per
 * 5s), through hidden tabs and while the user was typing. The new shape is one
 * shared poller whose cadence and pause behavior live here:
 *
 *   - ACTIVE (a queued/running card in the feed): stay at the 5s base — this
 *     is the label the user is watching.
 *   - IDLE: back off 5s → 10s → 20s → 45s → 90s and hold. Any activity signal
 *     (a live card reappears, the user queues a run, a new page subscribes)
 *     snaps back to 5s.
 *   - PAUSED (tab hidden, or the user is typing in an input/textarea/
 *     contenteditable): skip the fetch entirely and check again soon; a paused
 *     tick neither advances the backoff nor hits the network.
 */

export const LIVE_POLL_STEPS = [5000, 10000, 20000, 45000, 90000] as const;
export const LIVE_POLL_BASE_MS = LIVE_POLL_STEPS[0];
/** How often a PAUSED poller re-checks whether it may resume. */
export const LIVE_POLL_PAUSED_RECHECK_MS = 2000;

/**
 * The next delay after a completed fetch: live activity resets to base; an
 * idle result escalates one step and holds at the cap.
 */
export function nextLiveFeedDelay(currentMs: number, sawLiveCard: boolean): number {
  if (sawLiveCard) return LIVE_POLL_BASE_MS;
  const next = LIVE_POLL_STEPS.find((step) => step > currentMs);
  return next ?? LIVE_POLL_STEPS[LIVE_POLL_STEPS.length - 1];
}

/**
 * Whether a tick should skip its fetch. `doc` is the document (injectable for
 * tests): hidden tabs never poll, and neither does a page whose focused
 * element is a text input, textarea, or contenteditable — background label
 * refreshes are nonessential while the user is composing something.
 */
export function shouldPauseLivePolling(
  doc: { hidden?: boolean; activeElement?: { tagName?: string; isContentEditable?: boolean } | null } | null | undefined,
): boolean {
  if (!doc) return false;
  if (doc.hidden === true) return true;
  const el = doc.activeElement;
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}
