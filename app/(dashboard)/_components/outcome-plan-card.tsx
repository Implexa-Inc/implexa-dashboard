'use client';

import {
  canStartPlan, formatMinor,
  type NoEligible, type OutcomeIntent, type OutcomePlan, type PlanOutcome,
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
      <p className="text-xs text-ink-500 mt-3">Nothing was started and nothing will run.</p>
    </section>
  );
}

function PlanBody({ intent, plan, onStart, starting, startError }: {
  intent: OutcomeIntent;
  plan: OutcomePlan;
  onStart: () => void;
  starting: boolean;
  startError: string | null;
}) {
  const startable = canStartPlan(plan);
  const ceiling = intent.consequential_action_ceiling;
  return (
    <section aria-label="Recommended plan" className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink-50">Recommended plan</h3>
        <span className="text-[11px] text-ink-500" title="The immutable Backend plan identity echoed at Start.">
          {plan.scorer_version} · plan {plan.digest.slice(0, 12)}
        </span>
      </div>

      <ol className="mt-4 space-y-3" aria-label="Agent chain">
        {plan.nodes.map((node) => (
          <li key={node.workflow_version_id} className="border border-ink-800 rounded-lg p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-medium text-ink-100">
                {node.ordinal + 1}. {node.slug || `Agent ${node.workflow_id.slice(0, 8)}`}
              </div>
              <span className="text-xs text-ink-400">{node.budget_credits.toLocaleString()} credits</span>
            </div>
            <p className="text-xs text-ink-500 mt-2">
              {node.role.replaceAll('_', ' ')} · up to {Math.round(node.max_duration_ms / 60000)} min · {node.max_retries} {node.max_retries === 1 ? 'retry' : 'retries'} · {node.max_invocations.toLocaleString()} invocations maximum
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-lg border border-ink-800 p-4">
        <p className="text-xs uppercase tracking-wide text-ink-500">Ceilings</p>
        <ul className="mt-2 space-y-1 text-sm text-ink-300">
          <li>Planning budget: {plan.budget.max_budget_credits.toLocaleString()} credits</li>
          <li>Provider calls: {ceiling.max_provider_calls.toLocaleString()} maximum</li>
          <li>Consequential spend: {formatMinor(ceiling.max_spend_minor, ceiling.currency)} maximum</li>
          <li>Chain length: {plan.stop_conditions.max_nodes} nodes maximum, sequential only</li>
        </ul>
      </div>

      {plan.unresolved_missing_assets.length > 0 && (
        <div role="status" aria-label="Missing inputs" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">Add the missing input before this plan can start</p>
          {plan.unresolved_missing_assets.map((item) => (
            <p key={`${item.kind}-${item.description}`} className="text-xs text-ink-300 mt-2">{item.description}</p>
          ))}
        </div>
      )}

      {startError && <p role="status" className="mt-3 text-sm text-red-400">{startError}</p>}
      {startable && (
        <div className="mt-4">
          <button type="button" onClick={onStart} disabled={starting} className="rounded-lg bg-brand-500 text-ink-950 px-6 py-3 text-sm font-medium hover:bg-brand-400 transition-colors disabled:opacity-50">
            {starting ? 'Starting…' : 'Start production'}
          </button>
          <p className="text-xs text-ink-500 mt-2">Starts this Backend-prepared production with the plan digest shown above.</p>
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
  if (outcome.kind === 'no_match') {
    return <section role="status" aria-label="No matching outcome" className="card p-5 border-amber-500/40"><h3 className="text-sm font-semibold text-amber-300">No matching outcome</h3><p className="text-sm text-ink-300 mt-1">{outcome.message}</p></section>;
  }
  if (outcome.kind === 'needs_input') {
    return <section role="status" aria-label="Input required" className="card p-5 border-amber-500/40"><h3 className="text-sm font-semibold text-amber-300">One input is still needed</h3><p className="text-sm text-ink-300 mt-1">{outcome.question}</p><p className="text-xs text-ink-500 mt-3">Add a verified artifact above and label it as {outcome.missingInputTypes.join(' or ')}. Nothing was started.</p></section>;
  }
  if (outcome.kind !== 'plan') return null;
  return <PlanBody intent={outcome.intent} plan={outcome.plan} onStart={onStart} starting={starting} startError={startError} />;
}
