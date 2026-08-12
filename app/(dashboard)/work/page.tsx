/**
 * /work — the canonical Work domain.
 *
 * Work answers one question (DESIGN.md §8.1): *what outcome is being produced,
 * what needs me, and what was delivered?* It is the destination that absorbs
 * three surfaces that used to compete for that answer:
 *
 *   /review    → the **Ready for review** filter (Review is not a destination)
 *   /inbox     → the **Delivered** filter (Results is not a destination)
 *   Home's Today feed → the **Needs you** filter
 *
 * Both legacy routes redirect here with their query string intact, so a result
 * notification pointing at `/inbox?run=<id>` still opens that result.
 *
 * WHAT THIS PAGE DOES NOT DO. It does not group work by a canonical Work-item
 * identity, does not render revision lineage, and does not open a Work
 * workspace: that identity contract is Phase B and is owned by the backend
 * (DESIGN.md §14 — "No design phase begins while its corresponding backend
 * contract is absent"). Every list below is rendered by the SAME component the
 * old surface used, from the SAME loader, so this change moves where a fact is
 * read, never what it claims. Rows still open the existing run and review
 * destinations.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadInboxItems } from '@/lib/inbox';
import { loadNeedsYou } from '@/lib/needs-you';
import { attentionWarning } from '@/lib/attention';
import { getReviewQueue, reviewQueueWarning } from '@/lib/review';
import { getMyAgents } from '@/lib/agents-home';
import { parseWorkView, WORK_VIEW_LABELS } from '@/lib/navigation';
import TodayFeed from '../_components/today-feed';
import { RunAttentionBanner, type AttentionItem } from '../_components/run-attention-banner';
import InboxList from '../inbox/inbox-list';
import WorkFilterTabs from './_components/work-filter-tabs';
import ReadyForReviewList from './_components/ready-for-review-list';

export const dynamic = 'force-dynamic';

export default async function WorkPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const view = parseWorkView(searchParams?.view);

  // The review queue is read on EVERY view because the Ready-for-review count is
  // what replaced the old Review navigation entry — a filter whose count only
  // appears once you are already looking at it is not a queue.
  const queue = await getReviewQueue();
  // Only claim a number when the queue was fully readable. reviewQueueWarning()
  // is non-null whenever a source was unavailable or the list was truncated.
  const reviewCount = reviewQueueWarning(queue) === null ? queue.items.length : null;

  return (
    <div className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Work</h1>
          <p className="text-ink-300 text-sm mt-1">
            What your agents are producing, what needs you, and what they delivered.
          </p>
        </header>

        <WorkFilterTabs current={view} reviewCount={reviewCount} />

        {view === 'needs'     && <NeedsYouView />}
        {view === 'review'    && <ReviewView queue={queue} />}
        {view === 'delivered' && <DeliveredView />}
      </div>
    </div>
  );
}

/**
 * Needs you — missing input, decisions, approvals, and recoverable blockers.
 * <TodayFeed> is unchanged and remains the ONLY thing allowed to claim the
 * all-clear, because it is the only component that can see both the live alert
 * count and the server-known setup count.
 */
async function NeedsYouView() {
  const supabase = createClient();
  const needsYou = await loadNeedsYou(supabase);
  return (
    <TodayFeed
      data={needsYou}
      warning={attentionWarning({ partial: needsYou.partial, truncated: needsYou.truncated, live: !needsYou.partial })}
    />
  );
}

async function ReviewView({ queue }: { queue: Awaited<ReturnType<typeof getReviewQueue>> }) {
  // Agent NAME is the primary identity (the slug is an implementation detail the
  // user never chose). Falls back to the slug rather than rendering "undefined".
  const myAgents = await getMyAgents();
  const nameBySlug = new Map(
    [
      ...(myAgents.status === 'ready' ? myAgents.active : []),
      ...(myAgents.status === 'ready' ? myAgents.needsActivation : []),
      ...(myAgents.status === 'ready' ? myAgents.drafts : []),
    ].map((a) => [a.slug, a.name] as const),
  );
  return <ReadyForReviewList queue={queue} nameBySlug={nameBySlug} />;
}

/**
 * Delivered — the work your agents produced, newest first. Same loader and same
 * list component as the old Results page; `basePath` keeps the `?run=` deep
 * link syncing to /work so a shared or notified result URL stays stable.
 *
 * <RunAttentionBanner> is carried over from /inbox deliberately. A result that
 * did not finish cleanly must be impossible to miss from whichever entry point
 * the user arrived through, and a deep link into Delivered does not pass
 * through Needs you.
 */
async function DeliveredView() {
  const supabase = createClient();
  const items = await loadInboxItems(supabase, 40);
  const attentionItems: AttentionItem[] = items.map((it) => ({
    id: it.id, name: it.name, info: it.state, ran_at: it.ran_at,
  }));

  if (items.length === 0) {
    return (
      <section className="card text-center py-12" aria-label={WORK_VIEW_LABELS.delivered}>
        <p className="text-ink-100 font-medium">No results yet.</p>
        <p className="text-ink-400 text-sm mt-1">
          When your agents run, the work they produce shows up here.{' '}
          <Link href="/workflows" className="text-brand-500 hover:underline">Build an agent</Link>.
        </p>
      </section>
    );
  }
  return (
    <>
      <RunAttentionBanner items={attentionItems} />
      <InboxList initialItems={items} basePath="/work" />
    </>
  );
}
