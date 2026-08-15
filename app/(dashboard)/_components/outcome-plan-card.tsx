'use client';

/**
 * The server-prepared plan, rendered for a decision — the "show me before you
 * spend" step of the outcome surface on /create.
 *
 * Everything here is the backend's verbatim: selected agent versions, reasons,
 * estimate ranges, budget allocations, missing setup, and required approvals.
 * Nothing is ranked, summed, or recomputed client-side, and no raw scorer
 * value is displayed — reasons and reason codes are the inspection surface.
 * Start is offered only for a prepared plan with zero missing setup and every
 * approval explicitly acknowledged, and the caller must echo the plan id +
 * digest verbatim so the backend can refuse a stale plan.
 */

import { useState } from 'react';
import {
  canStartPlan, formatDurationRange, formatMinor, formatMinorRange,
  type NoEligible, type OutcomePlan, type PlanOutcome,
} from '@/lib/outcome-production';

function NoEligiblePanel({ noEligible }: { noEligible: NoEligible }) {
  return (
    <section role="status" aria-label="No eligible agent" className="card p-5 border-amber-500/40">
      <h3 className="text-sm font-semibold text-amber-300">No eligible agent for this outcome</h3>
      <p className="text-sm text-ink-300 mt-1">{noEligible.message}</p>
      {noEligible.exclusions.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {noEligible.exclusions.map((x) => (
            <li key={`${x.agentName}-${x.reasonCode}`} className="text-xs text-ink-400">
              <span className="text-ink-200">{x.agentName}</span> — {x.detail}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-500 mt-3">
        Nothing was started and nothing will run. Adjust the outcome, budget, or quality and plan again.
      </p>
    </section>
  );
}

function PlanBody({ plan, onStart, starting, startError }: {
  plan: OutcomePlan;
  onStart: () => void;
  starting: boolean;
  startError: string | null;
}) {
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<number>>(new Set());
  const startable = canStartPlan(plan);
  const allApproved = plan.approvals.every((_, i) => acknowledged.has(i));

  return (
    <section aria-label="Proposed plan" className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink-50">Proposed plan</h3>
        <span className="text-[11px] text-ink-500" title="The immutable identity of this plan. Start echoes it verbatim so a changed plan can never start as this one.">
          {plan.scorerVersion} · plan {plan.digest.slice(0, 12)}
        </span>
      </div>

      <ol className="mt-4 space-y-4">
        {plan.nodes.map((node) => (
          <li key={node.agentVersionId} className="border border-ink-800 rounded-lg p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-medium text-ink-100">
                {node.order}. {node.agentName} <span className="text-ink-500 font-normal">v{node.versionNumber}</span>
              </div>
              <div className="text-xs text-ink-400 whitespace-nowrap">
                {formatMinorRange(node.estimatedCostCentsRange, plan.currency)} · {formatDurationRange(node.estimatedDurationSecondsRange)}
              </div>
            </div>
            <p className="text-xs uppercase tracking-wide text-ink-500 mt-3">Why this agent</p>
            <ul className="mt-1 space-y-1">
              {node.reasons.map((reason) => (
                <li key={reason} className="text-xs text-ink-300">{reason}</li>
              ))}
            </ul>
            <p className="text-xs text-ink-500 mt-2">
              Budget allocation: {formatMinor(node.budgetAllocationCents, plan.currency)}
            </p>
          </li>
        ))}
      </ol>

      <p className="text-sm text-ink-300 mt-4">
        Estimated total {formatMinorRange(plan.totalEstimatedCostCentsRange, plan.currency)}
        <span className="text-ink-500"> · your maximum {formatMinor(plan.maxBudgetCents, plan.currency)}</span>
      </p>

      {plan.missingSetup.length > 0 && (
        <div role="status" aria-label="Missing setup" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">Finish setup before this plan can start</p>
          <ul className="mt-2 space-y-2">
            {plan.missingSetup.map((item) => (
              <li key={item.item} className="text-xs text-ink-300">
                {item.item}
                <span className="block text-ink-400 mt-0.5">{item.ownerAction}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {startable && (
        <fieldset className="mt-4 border-t border-ink-800 pt-4">
          <legend className="sr-only">Required approvals</legend>
          {plan.approvals.map((approval, i) => (
            <label key={approval.kind} className="flex items-start gap-2.5 text-sm text-ink-200 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={acknowledged.has(i)}
                onChange={(e) => {
                  const next = new Set(acknowledged);
                  if (e.target.checked) next.add(i); else next.delete(i);
                  setAcknowledged(next);
                }}
              />
              <span>
                {approval.description}
                <span className="block text-xs text-ink-500 mt-0.5">
                  Ceiling: {formatMinor(approval.ceilingCents, plan.currency)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {startError && <p role="status" className="mt-3 text-sm text-red-400">{startError}</p>}

      {startable && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onStart}
            disabled={!allApproved || starting}
            className="rounded-lg bg-brand-500 text-ink-950 px-6 py-3 text-sm font-medium hover:bg-brand-400 transition-colors disabled:opacity-50"
          >
            {starting ? 'Starting…' : 'Start production'}
          </button>
          <p className="text-xs text-ink-500 mt-2">
            Starts exactly this server-prepared plan — {plan.nodes.length === 1 ? 'one agent' : 'two agents in sequence'}, never more.
          </p>
        </div>
      )}
    </section>
  );
}

export default function OutcomePlanCard({ outcome, onStart, starting, startError }: {
  outcome: PlanOutcome;
  onStart: () => void;
  starting: boolean;
  startError: string | null;
}) {
  if (outcome.kind === 'no_eligible') return <NoEligiblePanel noEligible={outcome.noEligible} />;
  return <PlanBody plan={outcome.plan} onStart={onStart} starting={starting} startError={startError} />;
}
