/**
 * The owner's outcome productions on /work — the way back to work that is
 * already running.
 *
 * Without this list a production is reachable only from the redirect that
 * started it: navigate away, and the running work, its budget, and its single
 * stop control are unreachable. Work is where "what is being produced" is
 * answered, so it is where they belong.
 *
 * Pure and server-renderable. It claims nothing the loader did not read: an
 * unreadable list says so (and is NOT the same as having no productions), and
 * the empty state is only claimed when the list was fully readable.
 */

import Link from 'next/link';
import { formatMinor, type Production } from '@/lib/outcome-production';
import type { OutcomeProductionListLoad } from '@/lib/outcome-production-load';

const STATE_LABELS: Record<string, string> = {
  running: 'Running',
  blocked: 'Blocked',
  cancelled: 'Stopped',
  completed: 'Completed',
  failed: 'Failed',
};

function stateClass(state: string): string {
  if (state === 'running') return 'bg-brand-500/15 text-brand-300 border-brand-500/30';
  if (state === 'blocked' || state === 'failed') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (state === 'completed') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  return 'bg-ink-800 text-ink-300 border-ink-700';
}

function Row({ production }: { production: Production }) {
  const { budget } = production;
  return (
    <li>
      <Link
        href={`/runs/productions/${production.id}`}
        className="block border border-ink-800 rounded-lg px-4 py-3 hover:border-ink-600 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm text-ink-100 line-clamp-2">{production.goal}</span>
          <span className={`flex-none rounded-full border px-2.5 py-0.5 text-xs font-medium ${stateClass(production.state)}`}>
            {STATE_LABELS[production.state] || production.state}
          </span>
        </div>
        <span className="block text-xs text-ink-500 mt-1.5">
          {production.progress.completedNodes} of {production.progress.totalNodes} steps ·{' '}
          {formatMinor(budget.spentCents, budget.currency)} spent
        </span>
      </Link>
    </li>
  );
}

export default function OutcomeProductionsList({ load }: { load: OutcomeProductionListLoad }) {
  if (load.status === 'unavailable') {
    return (
      <section role="status" aria-label="Productions unavailable" className="card p-5 border-amber-500/40 mb-6">
        <p className="text-sm text-amber-300">
          We can’t show your outcome productions right now — this is not the same as having none.
        </p>
        <p className="text-xs text-ink-500 mt-1">{load.reason}</p>
      </section>
    );
  }

  // Nothing to say beats an empty box on a page that already has three lists.
  if (load.productions.length === 0) return null;

  const active = load.productions.filter((p) => !p.settled);
  return (
    <section aria-label="Outcome productions" className="mb-6">
      <h2 className="text-sm font-semibold text-ink-50">
        Productions
        {active.length > 0 && <span className="text-ink-400 font-normal"> · {active.length} running</span>}
      </h2>
      <ul className="mt-2 space-y-2">
        {load.productions.map((production) => <Row key={production.id} production={production} />)}
      </ul>
    </section>
  );
}
