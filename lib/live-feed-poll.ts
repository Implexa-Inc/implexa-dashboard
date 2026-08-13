/**
 * lib/live-feed-poll.ts — ONE shared poller for GET /api/v2/scheduled-skills/live.
 *
 * Browser-side singleton. Every subscriber (each mounted <AgentActions/>, on
 * any surface) receives the same feed items from the same fetch — the agent
 * page renders <AgentActions/> twice (header + Setup tab), which used to mean
 * two independent 5-second intervals each doing its own getSession(). Now:
 * one timer, one getSession() per tick, however many subscribers.
 *
 * Cadence and pause rules are the pure functions in lib/live-feed-backoff.ts:
 * 5s while a run is live, backing off to 90s when idle, fully paused (no
 * fetch) while the tab is hidden or the user is typing. `notifyRunActivity()`
 * snaps the cadence back to 5s the moment a run is queued anywhere.
 *
 * The last unsubscribe stops the timer — nothing polls on pages without a
 * subscriber.
 */

// '@/lib/...' specifiers, NOT relative paths: the render harness
// (lib/test/render.ts) swaps exactly these two module ids for its stubs. A
// relative import silently bypasses that alias and bundles the REAL Supabase
// browser client into jsdom, whose token auto-refresh timer then keeps the
// test process alive forever.
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import {
  LIVE_POLL_BASE_MS,
  LIVE_POLL_PAUSED_RECHECK_MS,
  nextLiveFeedDelay,
  shouldPauseLivePolling,
} from '@/lib/live-feed-backoff';

export type LiveFeedItem = { skillSlug?: string; status?: string };
type Subscriber = (items: LiveFeedItem[]) => void;

const subscribers = new Set<Subscriber>();
let timer: ReturnType<typeof setTimeout> | null = null;
let delayMs: number = LIVE_POLL_BASE_MS;

function stop() {
  if (timer) { clearTimeout(timer); timer = null; }
}

function schedule(ms: number) {
  stop();
  timer = setTimeout(tick, ms);
}

async function tick() {
  timer = null;
  if (!subscribers.size) return;
  // A paused tick (hidden tab / user typing) skips the network entirely and
  // re-checks soon — it neither advances the backoff nor delivers stale items.
  if (shouldPauseLivePolling(typeof document !== 'undefined' ? document : null)) {
    schedule(LIVE_POLL_PAUSED_RECHECK_MS);
    return;
  }
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const res = await callBackend('/api/v2/scheduled-skills/live', { jwt: session?.access_token });
    const items: LiveFeedItem[] = Array.isArray(res?.items) ? res.items : [];
    const sawLive = items.some((c) => c.status === 'queued' || c.status === 'running');
    delayMs = nextLiveFeedDelay(delayMs, sawLive);
    for (const cb of [...subscribers]) {
      try { cb(items); } catch { /* one bad subscriber must not starve the rest */ }
    }
  } catch {
    // Transient failure: keep the current cadence and try again.
  }
  if (subscribers.size) schedule(delayMs);
}

/**
 * Subscribe to the shared feed. Starting a subscription resets the cadence to
 * the 5s base (a fresh page = fresh interest). Returns the unsubscribe.
 */
export function subscribeLiveFeed(cb: Subscriber): () => void {
  subscribers.add(cb);
  delayMs = LIVE_POLL_BASE_MS;
  if (!timer) schedule(delayMs);
  return () => {
    subscribers.delete(cb);
    if (!subscribers.size) stop();
  };
}

/** A run was just queued somewhere — snap the cadence back to the 5s base. */
export function notifyRunActivity() {
  delayMs = LIVE_POLL_BASE_MS;
  if (subscribers.size) schedule(delayMs);
}
