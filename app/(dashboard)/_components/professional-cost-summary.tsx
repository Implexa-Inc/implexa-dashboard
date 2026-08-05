'use client';

/**
 * <ProfessionalCostSummary /> — the three numbers that must never blur into one,
 * and the two counts that must never blur into each other.
 *
 * THE MONEY
 *   Expected      — what the requested takes spend if nothing is repaired.
 *   Repair reserve— contingent. Authorized, priced, and possibly never spent.
 *   Hard maximum  — expected + reserve. THIS is what an approval authorizes, and
 *                   it is the figure the approval control asks the user to confirm.
 *
 * THE COUNTS
 *   Coverage — B-roll moments on the finished timeline. One per moment. Always.
 *   Takes    — paid generations. More takes give more CHOICE for the same
 *              moments; they add no coverage. Three takes of one 3-second moment
 *              is still three seconds of footage.
 *
 * `source` is load-bearing copy, not decoration. Before a preview the figures are
 * this build's own arithmetic over the pinned rate catalog, and they say so.
 * After a preview they are the backend's compiled numbers, verbatim.
 */

import type { TimelineCost } from '@/lib/professional-v2-timeline';
import { coverageSummary } from '@/lib/professional-v2-timeline';

type Props = {
  cost: TimelineCost;
  source: 'local-estimate' | 'backend-compiled';
};

export default function ProfessionalCostSummary({ cost, source }: Props) {
  const authoritative = source === 'backend-compiled';
  return (
    <section
      aria-label="Cost and coverage"
      className="rounded-lg border border-ink-800 bg-ink-950/60 p-4"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {authoritative ? 'Compiled by Implexa' : 'Estimate — not yet compiled'}
      </p>

      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-400">Expected</dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink-100">{cost.expectedCredits} credits</dd>
          <p className="mt-0.5 text-[11px] text-ink-500">{cost.variantTaskCount} take{cost.variantTaskCount === 1 ? '' : 's'} generated up front.</p>
        </div>
        <div>
          <dt className="text-xs text-ink-400">Repair reserve</dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink-100">{cost.repairReserveCredits} credits</dd>
          <p className="mt-0.5 text-[11px] text-ink-500">
            {cost.repairTaskCount === 0
              ? 'No reserve — nothing contingent is authorized.'
              : `${cost.repairTaskCount} contingent repair${cost.repairTaskCount === 1 ? '' : 's'}, spent only if the Judge fails a take.`}
          </p>
        </div>
        <div>
          <dt className="text-xs text-ink-400">Hard maximum</dt>
          <dd className="mt-0.5 text-lg font-semibold text-amber-200">{cost.maximumCredits} credits</dd>
          <p className="mt-0.5 text-[11px] text-ink-500">Expected + reserve. This is the ceiling an approval authorizes.</p>
        </div>
      </dl>

      <p className="mt-3 border-t border-ink-800 pt-3 text-xs text-ink-300">{coverageSummary(cost)}</p>

      <p className="mt-2 text-[11px] leading-snug text-ink-500">
        {authoritative
          ? 'These are the figures Implexa compiled for this exact plan. Nothing here is calculated in your browser.'
          : 'These figures are this build’s own arithmetic over the pinned provider rate. Preview the plan to get Implexa’s compiled figures — those are the ones an approval uses, and if the two disagree the plan cannot be approved.'}
      </p>
    </section>
  );
}
