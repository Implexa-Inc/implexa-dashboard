import Link from 'next/link';
import RetryButton from './retry-button';
import type {MyWorkflowsRead,MyWorkflowCard} from '@/lib/workflow-catalog';

export default function TrainingAgentPicker({ owned,recordingId }: { owned: MyWorkflowCard[];recordingId?:string }) {
  // Ownership is the whole gate here: a renter sees the empty state, an owner
  // sees their agents. There is no mode toggle (DESIGN.md §4.2).
  const bySlug = new Map<string, MyWorkflowCard>();
  for (const agent of owned) {
    const current = bySlug.get(agent.slug);
    if (!current || (agent.source === 'generated' && current.source !== 'generated')) bySlug.set(agent.slug, agent);
  }

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
        {[...bySlug.values()].map((a) => (
          <li key={a.slug} className="transition-colors hover:bg-ink-900/30">
            <Link
              href={`/training/${encodeURIComponent(a.slug)}${recordingId?`?annotateRecording=${encodeURIComponent(recordingId)}`:''}`}
              className="flex items-center justify-between gap-5 rounded-lg px-4 py-6 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
            >
              <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-950/40 text-emerald-200/80">✦</span><span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-100">{a.name.trim() || a.slug}</span>
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

/**
 * An unreadable roster is not an empty roster. Showing "Build your first agent"
 * to an owner whose feed just failed would tell them their work does not exist.
 */
export function TrainingFeedUnavailable({ reason }: { reason: Extract<MyWorkflowsRead, {status:'unavailable'}>['reason'] }) {
  return (
    <div role="status" className="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-10 text-center">
      <p className="text-sm text-ink-300">We can&apos;t show your agents right now.</p>
      <p className="mt-1 text-xs text-ink-500">{reason === 'timeout' ? 'The agent lookup took too long.' : reason === 'no_session' ? 'Your session is unavailable.' : 'The agent lookup could not be completed.'} This is not the same as having none.</p>
      <RetryButton />
    </div>
  );
}

