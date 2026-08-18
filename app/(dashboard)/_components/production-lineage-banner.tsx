/**
 * <ProductionLineageBanner /> — what a run permalink must say when the run
 * belongs to an outcome production.
 *
 * The incident this exists for: a two-agent production succeeded, both runs
 * verified complete, and a reader who followed the child link landed on a
 * QUEUED EXECUTION SHELL left behind when the node was rerouted to another
 * engine. The page said "This run stalled" and offered "Run again" — inviting a
 * duplicate of work that had already finished and already been paid for, while
 * the run that actually did the job sat one link away with validated artifacts.
 *
 * Three rules, in order of importance:
 *   1. A run inside a production always points at its parent. The production is
 *      the canonical view; this page is a diagnostic.
 *   2. A superseded shell says so IN THOSE WORDS and links to the authoritative
 *      run. It never presents itself as the node's outcome.
 *   3. A completed related run must never leave the reader with a primary
 *      "this run stalled" conclusion — hence `supersedesFailureNarrative`,
 *      which the run page uses to demote its own stalled copy.
 *
 * Every field is the backend's; this component decides nothing about lineage.
 */

import Link from 'next/link';
import type { ProductionLineage } from '@/lib/outcome-production-detail';

export { supersedesFailureNarrative } from './production-lineage-narrative';

/**
 * How the authoritative run finished, in one word.
 *
 * skill_runs carries TWO orthogonal axes and both are read here. `run_state`
 * is liveness; `status` is terminal QUALITY. A partial or failed delivery
 * still reads run_state='completed', so reporting liveness alone would tell
 * the reader their superseded attempt was replaced by a success that never
 * happened. Quality is checked FIRST, and is never promoted.
 */
function authoritativeOutcome(lineage: ProductionLineage): string {
  if (lineage.authoritativeRunState === 'failed' || lineage.authoritativeRunStatus === 'failed') return 'failed';
  if (lineage.authoritativeRunStatus === 'partial') return 'was only partially delivered';
  if (lineage.authoritativeRunState === 'stalled') return 'stalled';
  if (lineage.authoritativeRunState === 'completed') return 'completed';
  if (lineage.authoritativeRunState) return lineage.authoritativeRunState;
  return 'has the result';
}

export default function ProductionLineageBanner({ lineage }: { lineage: ProductionLineage | null }) {
  if (!lineage) return null;
  const productionHref = `/runs/productions/${lineage.productionId}`;
  const agent = lineage.agentName || `agent ${lineage.ordinal + 1}`;

  return (
    <div className="mb-4 space-y-3">
      {lineage.superseded && (
        <div
          role="status"
          aria-label="Superseded execution attempt"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
        >
          <p className="text-sm text-ink-100">
            <strong>This execution attempt was superseded by a related run.</strong>
          </p>
          <p className="text-xs text-ink-400 mt-1 leading-relaxed">
            It is not the result of this production step. Agent {lineage.ordinal + 1} — {agent} — was carried out by
            another run, which {authoritativeOutcome(lineage)}
            {lineage.nodeOutcomeLabel === 'succeeded' ? ' and produced the validated output' : ''}.
          </p>
          {lineage.authoritativeRunId && (
            <Link
              href={`/runs/${lineage.authoritativeRunId}`}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Open the run that actually ran this step <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      )}

      {/* Always shown — inside a production, the parent is the canonical view
          whether or not this particular run is the authoritative one. */}
      <div className="rounded-lg border border-ink-800 bg-ink-950/40 px-3 py-2.5">
        <p className="text-xs text-ink-400 leading-relaxed">
          Part of a production
          {lineage.productionGoal ? <> — <span className="text-ink-200">{lineage.productionGoal}</span></> : null}
          {' · '}agent {lineage.ordinal + 1} of the plan
        </p>
        <Link
          href={productionHref}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          Open the production <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
