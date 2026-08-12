/**
 * /start — the state-aware default landing.
 *
 * Home is gone from primary navigation because it owned no unique object
 * (DESIGN.md §4.1). What replaced it is a RULE, not a page: the Implexa logo
 * resolves here, and here resolves to the domain that actually has something
 * for you (§4.3).
 *
 *   1. something needs input or a review decision  → Work
 *   2. something is actively running               → Work
 *   3. otherwise                                   → Agents
 *
 * The rule itself is `resolveDefaultLanding` in lib/navigation, kept pure so it
 * is testable and so the shell invents no state of its own. This file only
 * supplies the snapshot.
 *
 * A count we could not read stays `null` and is NOT treated as zero — an
 * unreadable queue must never resolve to "nothing needs you, go browse agents".
 * `resolveDefaultLanding` sends an unknown snapshot to Work, which is the
 * surface that can explain what it could not see.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveDefaultLanding } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

/** Live states that mean "a job is in flight" (lib/run-state vocabulary). */
const IN_PROGRESS_STATES = ['queued', 'running'] as const;

export default async function StartPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // RLS-scoped head counts — no rows fetched, just the two numbers the rule needs.
  const [needsDecision, inProgress] = await Promise.all([
    countOrNull(() =>
      supabase.from('skill_runs').select('id', { count: 'exact', head: true })
        .or('review_status.eq.pending,run_state.eq.stalled')),
    countOrNull(() =>
      supabase.from('skill_runs').select('id', { count: 'exact', head: true })
        .in('run_state', IN_PROGRESS_STATES as unknown as string[])),
  ]);

  // Outside the try/catch below on purpose: redirect() signals by throwing, and
  // swallowing that would render an empty page instead of navigating.
  redirect(resolveDefaultLanding({ needsDecision, inProgress }));
}

/**
 * `null` on any failure — including a column the deployed schema does not have
 * yet. The caller treats null as "unknown", never as zero.
 */
async function countOrNull(
  q: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  try {
    const { count, error } = await q();
    if (error) return null;
    return typeof count === 'number' ? count : null;
  } catch {
    return null;
  }
}
