import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { loadNeedsYou } from '@/lib/needs-you';
import { getReviewQueue, reviewQueueWarning } from '@/lib/review';
import { readMyWorkflows } from '@/lib/workflow-catalog';
import { reviewQueueForArea } from '@/lib/training-review-routing';
import { settleWithin } from '@/lib/landing';
import { workAttentionBadge, type ShellNavigationState } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

/** Background shell read only. No page waits for the roster/review services. */
export async function GET() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ ok: false }, { status: 401 });
  const within = <T,>(read: Promise<T>) => settleWithin<T | null>(read, 10_000, null);
  // The owner roster changes far less often than run attention. Cache successful
  // reads per authenticated account; never cache a failed read as "no agents".
  const ownership = unstable_cache(async () => {
    const result = await readMyWorkflows(session.access_token);
    if (result.status !== 'ready' || result.unavailableEntries) throw new Error('owner_roster_unavailable');
    return result;
  }, ['shell-owner-roster', session.user.id], { revalidate: 300 })();
  const [needs, reviews, owned] = await Promise.all([
    within(loadNeedsYou(supabase)),
    within(getReviewQueue()),
    within(ownership),
  ]);
  const ownershipKnown = owned?.status === 'ready';
  const canTrain = ownershipKnown && owned.workflows.some((agent) => agent.source === 'generated')
    ? true : ownershipKnown && !owned.unavailableEntries ? false : null;
  const workReviews = reviews && owned ? reviewQueueForArea(reviews, owned, 'work') : reviews;
  const complete = !!needs && !needs.partial && !needs.truncated
    && !!workReviews && reviewQueueWarning(workReviews) === null
    && ownershipKnown && !owned.unavailableEntries;
  const emptyNeeds = { needGrant: [], missed: [], signIns: [], stalled: [], attentionItems: [] };
  const state: ShellNavigationState = {
    canTrain,
    work: needs || workReviews?.live
      ? workAttentionBadge(needs ?? emptyNeeds, workReviews?.items ?? [], complete) : null,
  };
  const unavailableSources = [
    ...(needs ? needs.unavailableSources : ['needs_you_timeout']),
    ...(!workReviews ? ['review_queue_timeout'] : Object.entries(workReviews.sources).filter(([, status]) => status === 'unavailable').map(([name]) => name)),
    ...(!ownershipKnown ? ['owner_roster'] : []),
  ];
  return NextResponse.json({ ok: true, ...state, unavailableSources, knownAttentionCount: needs?.total ?? null, knownWorkReviewCount: workReviews?.items.length ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
}
