import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { loadNeedsYou } from '@/lib/needs-you';
import { getLiveFeed } from '@/lib/live-feed-server';
import { LIVE_ATTENTION_STATUSES } from '@/lib/live-feed';
import { readMyWorkflows } from '@/lib/workflow-catalog';
import { settleWithin } from '@/lib/landing';
import { workAttentionBadge, type ShellNavigationState } from '@/lib/navigation';

export const dynamic = 'force-dynamic';
class NoTrainableAgent extends Error {}

/** Background shell read only. No page waits for the roster or attention services. */
export async function GET() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ ok: false }, { status: 401 });
  // getSession's embedded user is an unverified cookie hint. A cache hit must
  // be scoped by the identity verified against Auth, never by that hint.
  const verified = await settleWithin(supabase.auth.getUser(session.access_token), 3500, null);
  if (!verified) return NextResponse.json({ ok: false }, { status: 503 });
  const { data: { user }, error } = verified;
  if (error || !user) return NextResponse.json({ ok: false }, { status: 401 });
  const within = <T,>(read: Promise<T>) => settleWithin<T | null>(read, 8_000, null);
  // Cache positive ownership per verified account. Negative/failed reads are not
  // cached, so building a first agent never waits for a five-minute negative.
  const ownership = unstable_cache(async () => {
    const result = await readMyWorkflows(session.access_token);
    if (result.status !== 'ready' || result.unavailableEntries) throw new Error('owner_roster_unavailable');
    if (!result.workflows.some((agent) => agent.source === 'generated')) throw new NoTrainableAgent();
    return true; // Cache a boolean only, never the caller's private roster.
  }, ['shell-coach-owner', user.id], { revalidate: 300 })()
    .catch((reason) => reason instanceof NoTrainableAgent ? false : null);
  const [needs, live, owned] = await Promise.all([
    within(loadNeedsYou(supabase)),
    within(getLiveFeed()),
    within(ownership),
  ]);
  const ownershipKnown = typeof owned === 'boolean';
  const canTrain = owned;
  const complete = !!needs && !needs.partial && !needs.truncated
    && live?.status === 'ready';
  const emptyNeeds = { needGrant: [], missed: [], signIns: [], homeAttention: [] };
  const state: ShellNavigationState = {
    canTrain,
    work: needs || live?.status === 'ready'
      ? workAttentionBadge(needs ?? emptyNeeds, live?.status === 'ready' ? live.items : [], complete) : null,
  };
  const unavailableSources = [
    ...(needs ? needs.unavailableSources : ['needs_you_timeout']),
    ...(live?.status !== 'ready' ? ['live_runs'] : []),
    ...(!ownershipKnown ? ['owner_roster'] : []),
  ];
  return NextResponse.json({ ok: true, ...state, unavailableSources, knownSetupCount: needs ? needs.needGrant.length + needs.missed.length + needs.signIns.length : null, knownJudgeCount: needs?.homeAttention.length ?? null, knownLiveAttentionCount: live?.status === 'ready' ? live.items.filter((item) => LIVE_ATTENTION_STATUSES.has(String(item.status))).length : null }, { headers: { 'Cache-Control': 'private, no-store' } });
}
