/**
 * lib/landing-load.ts — the I/O half of the state-aware landing snapshot.
 *
 * Split from lib/landing.ts (which holds the pure rules) for the same reason
 * lib/agents-feed-core.ts is split from lib/agents-home.ts: `needs-you.ts`
 * carries `server-only` transitively, which does not resolve outside a Next
 * build, and the honesty rules are exactly what needs executable tests.
 *
 * This file adds NO judgement of its own. It reads the three authoritative
 * models and hands them to `landingSnapshot`.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LandingSnapshot } from './navigation';
import {
  landingSnapshot, settleWithin, LANDING_READ_DEADLINE_MS,
  UNREADABLE_NEEDS, UNREADABLE_QUEUE, UNREADABLE_LIVE,
} from './landing';
import { loadNeedsYou } from './needs-you';
import { getReviewQueue } from './review';
import { getLiveFeed } from './live-feed-server';

/**
 * Read all three models concurrently and compose.
 *
 * A model that throws — or misses the deadline — is treated as UNREADABLE, not
 * as empty. Each fallback is the "we could not see this" shape, never the
 * "there is nothing" shape, so a landing decision can degrade to "open Work"
 * and can never degrade to a false all-clear.
 */
export async function loadLandingSnapshot(supabase: SupabaseClient): Promise<LandingSnapshot> {
  const within = <T>(p: PromiseLike<T>, fallback: T) => settleWithin(p, LANDING_READ_DEADLINE_MS, fallback);
  const [needs, queue, live] = await Promise.all([
    within(loadNeedsYou(supabase), UNREADABLE_NEEDS),
    within(getReviewQueue(), UNREADABLE_QUEUE),
    within(getLiveFeed(), UNREADABLE_LIVE),
  ]);
  return landingSnapshot(needs, queue, live);
}
