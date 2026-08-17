'use client';

/**
 * The production monitor: ONE parent, first — its state, budget, progress,
 * and blockers — with child activity expandable underneath and exactly one
 * stop control.
 *
 * The parent is the accountable unit (spec: "One parent production/Work item
 * owns plan, budget, status, artifacts, receipts, review, cancellation, and
 * final outcome"), so the page never leads with child runs, never renders an
 * "AI team" tableau, and never offers per-child stop buttons — stopping is a
 * parent decision that the backend propagates to every child grant.
 *
 * All figures are the backend's verbatim. Refresh re-reads the server; this
 * component performs no client-side reconciliation.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from './modal';
import { shouldPollProduction, type Production } from '@/lib/outcome-production';

/**
 * How often an unsettled production re-reads itself.
 *
 * Without this the page is a snapshot from load: the parent keeps saying
 * "Running · $19.00 spent · 1 of 2 steps" while children finish and real money
 * moves, and a user watching it would reasonably conclude the work is stuck.
 * router.refresh() re-runs the server component, so the JWT stays server-side
 * and there is no second client read path to keep honest.
 */
const REFRESH_MS = 10_000;

const STATE_LABELS: Record<string, string> = {
  planning: 'Planning',
  ready: 'Ready',
  running: 'Running',
  cancelled: 'Stopped',
  succeeded: 'Completed',
  partial: 'Partially delivered',
  failed: 'Failed',
};

function stateBadgeClass(state: string): string {
  if (state === 'running') return 'bg-brand-500/15 text-brand-300 border-brand-500/30';
  if (state === 'planning' || state === 'ready') return 'bg-brand-500/15 text-brand-300 border-brand-500/30';
  if (state === 'succeeded') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (state === 'failed' || state === 'partial') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  return 'bg-ink-800 text-ink-300 border-ink-700';
}

export default function OutcomeProductionMonitor({ production }: { production: Production }) {
  const router = useRouter();
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  const poll = shouldPollProduction(production);
  useEffect(() => {
    if (!poll) return undefined;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [poll, router]);

  async function stopProduction() {
    setStopping(true);
    setStopError(null);
    try {
      const res = await fetch('/api/outcome-productions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', productionId: production.id }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body && body.ok === true) {
        setConfirmStop(false);
        router.refresh();
      } else {
        setStopError('We couldn’t confirm the stop. Refresh to see the production’s actual state.');
      }
    } catch {
      setStopError('We couldn’t confirm the stop. Refresh to see the production’s actual state.');
    } finally {
      setStopping(false);
    }
  }

  const { budget, progress } = production;

  return (
    <section aria-label="Production" className="card p-6">
      {/* Parent first — always. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${stateBadgeClass(production.state)}`}>
              {STATE_LABELS[production.state] || production.state}
            </span>
            {production.planDigest && <span className="text-xs text-ink-500">plan {production.planDigest.slice(0, 12)}</span>}
          </div>
          <h2 className="text-lg font-semibold text-ink-50 mt-2">{production.goal}</h2>
        </div>
        {production.canCancel && (
          <button
            type="button"
            aria-label="Stop this production"
            onClick={() => setConfirmStop(true)}
            className="flex-none rounded-lg border border-red-500/40 text-red-300 px-4 py-2 text-sm hover:bg-red-500/10 transition-colors"
          >
            Stop
          </button>
        )}
      </div>

      <dl className="mt-5 grid sm:grid-cols-3 gap-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">Budget</dt>
          <dd className="text-sm text-ink-100 mt-1">
            {budget.spentCredits.toLocaleString()} credits spent
            <span className="block text-xs text-ink-400">
              of {budget.reservedCredits.toLocaleString()} reserved · max {budget.maxBudgetCredits.toLocaleString()}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">Progress</dt>
          <dd className="text-sm text-ink-100 mt-1">
            {progress.completedNodes} of {progress.totalNodes} steps complete
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">Quality</dt>
          <dd className="text-sm text-ink-100 mt-1 capitalize">{production.quality}</dd>
        </div>
      </dl>

      {production.blockers.length > 0 && (
        <div role="status" aria-label="Blockers" className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">Waiting on you</p>
          <ul className="mt-1.5 space-y-1">
            {production.blockers.map((blocker, index) => (
              <li key={`${blocker.reasonCode}:${index}`} className="text-sm text-ink-300">{blocker.detail}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-6 group">
        <summary className="cursor-pointer text-sm text-ink-300 hover:text-ink-100 select-none">
          Activity ({production.children.length} {production.children.length === 1 ? 'step' : 'steps'})
        </summary>
        <ol className="mt-3 space-y-3">
          {production.children.map((child) => (
            <li key={child.requestId || `${child.agentVersionId}:${child.order}`} className="border border-ink-800 rounded-lg p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-ink-100">{child.order + 1}. {child.agentName}</span>
                <span className="text-xs text-ink-400 capitalize">{child.state}</span>
              </div>
              <p className="text-xs text-ink-500 mt-1.5">
                {child.spentCredits.toLocaleString()} of {child.budgetAllocationCredits.toLocaleString()} credits allocated
              </p>
              {child.blocker && (
                <p className="text-xs text-amber-300 mt-1.5">{child.blocker.detail}</p>
              )}
            </li>
          ))}
        </ol>
      </details>

      {stopError && <p role="status" className="mt-4 text-sm text-red-400">{stopError}</p>}

      <Modal
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Stop this production?"
        subtitle={<span className="text-sm text-ink-400">Every step stops, the reservation settles, and you keep whatever was already produced and verified.</span>}
      >
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => setConfirmStop(false)}
            className="rounded-lg border border-ink-700 text-ink-300 px-4 py-2 text-sm hover:border-ink-500"
          >
            Keep running
          </button>
          <button
            type="button"
            onClick={stopProduction}
            disabled={stopping}
            className="rounded-lg bg-red-500/90 text-ink-950 px-4 py-2 text-sm font-medium hover:bg-red-400 disabled:opacity-50"
          >
            {stopping ? 'Stopping…' : 'Stop production'}
          </button>
        </div>
      </Modal>
    </section>
  );
}
