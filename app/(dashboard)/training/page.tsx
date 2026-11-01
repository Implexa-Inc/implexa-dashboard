import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readMyWorkflows, type MyWorkflowCard, type MyWorkflowsRead } from '@/lib/workflow-catalog';
import RetryButton from '../_components/retry-button';

export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const feed = await readMyWorkflows(session.access_token);

  return (
    <div className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[.18em] text-ink-500">Your trainer workspace</p><h1 className="text-3xl font-medium tracking-tight text-ink-50">What would you like to train?</h1>
          <p className="text-ink-300 text-sm mt-1">
            Teach through a result, a conversation, or a demonstration.
          </p>
        </header>

        {feed.status !== 'ready' ? <FeedUnavailable reason={feed.reason} /> : <OwnedAgents owned={feed.workflows} />}
      </div>
    </div>
  );
}

/**
 * An unreadable roster is not an empty roster. Showing "Build your first agent"
 * to an owner whose feed just failed would tell them their work does not exist.
 */
function FeedUnavailable({ reason }: { reason: Extract<MyWorkflowsRead, {status:'unavailable'}>['reason'] }) {
  return (
    <div role="status" className="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-10 text-center">
      <p className="text-sm text-ink-300">We can&apos;t show your agents right now.</p>
      <p className="mt-1 text-xs text-ink-500">{reason === 'timeout' ? 'The agent lookup took too long.' : reason === 'no_session' ? 'Your session is unavailable.' : 'The agent lookup could not be completed.'} This is not the same as having none.</p>
      <RetryButton />
    </div>
  );
}

function OwnedAgents({ owned }: { owned: MyWorkflowCard[] }) {
  // Ownership is the whole gate here: a renter sees the empty state, an owner
  // sees their agents. There is no mode toggle (DESIGN.md §4.2).

  if (owned.length === 0) {
    return (
      <section className="card text-center py-12">
        <p className="text-ink-100 font-medium">You don&apos;t own an agent yet.</p>
        <p className="text-ink-400 text-sm mt-1">
          Training is where an agent you own accumulates evidence from the work you review.{' '}
          <Link href="/create?from=training" className="text-brand-500 hover:underline">Build your first agent</Link>.
        </p>
      </section>
    );
  }

  return (
    <>
      <ul className="divide-y divide-ink-800">
        {owned.map((a) => (
          <li key={a.slug} className="transition-colors hover:bg-ink-900/30">
            <Link
              href={`/training/${a.slug}`}
              className="flex items-center justify-between gap-5 rounded-lg px-4 py-6 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
            >
              <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-950/40 text-emerald-200/80">✦</span><span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-100">{a.name}</span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  {a.is_scheduled ? 'Scheduled' : 'On-demand'}
                </span>
              </span>
              <span className="shrink-0 text-xs text-ink-400">Train agent →</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-7 flex items-center gap-3 text-sm text-ink-500">Starting with something new?<Link href="/create?from=training" className="text-ink-200 underline underline-offset-4 hover:text-brand-400">Build a new agent →</Link></p>
    </>
  );
}
