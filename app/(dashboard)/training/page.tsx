/**
 * /training — the third primary domain.
 *
 * Training answers (DESIGN.md §10.1): *how is an agent I own becoming more
 * competent, and what evidence supports its claims?*
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT SHOW. Review-derived evidence, tests,
 * benchmarks, model/tool comparisons, version impact, progress, uncertainty and
 * the publishable resume are Phase E, and every one of them depends on a
 * backend evidence contract that does not exist yet. DESIGN.md §14 is explicit
 * that no design phase begins while its backend contract is absent, and §2.1
 * principle 8 forbids collapsing separate trust signals into one unexplained
 * number — so this page renders the entry point and says plainly what is not
 * measured yet. An invented competence score would be worse than an empty page.
 *
 * What it does own today: the honest owner/renter split (§4.2 — a builder is
 * simply a user who owns at least one agent, with no mode toggle anywhere), and
 * a single route for the domain so the navigation model is real rather than
 * aspirational.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyAgents, type MyAgent } from '@/lib/agents-home';

export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const feed = await getMyAgents();

  return (
    <div className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Training</h1>
          <p className="text-ink-300 text-sm mt-1">
            How the agents you own are getting better at their job.
          </p>
        </header>

        {feed.status !== 'ready' ? <FeedUnavailable /> : <OwnedAgents feed={feed} />}
      </div>
    </div>
  );
}

/**
 * An unreadable roster is not an empty roster. Showing "Build your first agent"
 * to an owner whose feed just failed would tell them their work does not exist.
 */
function FeedUnavailable() {
  return (
    <div role="status" className="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-10 text-center">
      <p className="text-sm text-ink-300">We can&apos;t show your agents right now.</p>
      <p className="mt-1 text-xs text-ink-500">This is not the same as having none — try again shortly.</p>
    </div>
  );
}

function OwnedAgents({ feed }: { feed: { active: MyAgent[]; needsActivation: MyAgent[]; drafts: MyAgent[] } }) {
  // Ownership is the whole gate here: a renter sees the empty state, an owner
  // sees their agents. There is no mode toggle (DESIGN.md §4.2).
  const owned = [...feed.active, ...feed.needsActivation, ...feed.drafts];

  if (owned.length === 0) {
    return (
      <section className="card text-center py-12">
        <p className="text-ink-100 font-medium">You don&apos;t own an agent yet.</p>
        <p className="text-ink-400 text-sm mt-1">
          Training is where an agent you own accumulates evidence from the work you review.{' '}
          <Link href="/workflows" className="text-brand-500 hover:underline">Build your first agent</Link>.
        </p>
      </section>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {owned.map((a) => (
          <li key={a.slug} className="rounded-lg border border-ink-800 bg-ink-900/40 transition-colors hover:border-ink-700">
            <Link
              href={`/workflows/${a.slug}`}
              className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink-100">{a.name}</span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  {a.mode === 'on_demand' ? 'On-demand' : (a.scheduleNl || 'Scheduled')}
                </span>
              </span>
              <span className="shrink-0 text-xs text-ink-400">Open agent →</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* The honest gap. Named specifically rather than as a vague "coming soon",
          because each item is a separate evidence channel that must never be
          collapsed into one score once it does exist. */}
      <p className="mt-6 text-xs text-ink-500">
        Review-derived evidence, tests and benchmarks, version history, and progress toward a
        publishable resume are not available yet. Until they are, this page shows the agents you
        own and nothing it cannot prove.
      </p>
    </>
  );
}
