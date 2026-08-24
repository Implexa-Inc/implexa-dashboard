'use client';

import {
  canStartPlan, formatMinor,
  type NoEligible, type OutcomeIntent, type OutcomePlan, type PlanOutcome,
} from '@/lib/outcome-production';
import type { RunInputProgress } from './run-attachments';
import RunInputVerificationProgress from './run-input-verification-progress';

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

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nodePurpose(node: OutcomePlan['nodes'][number], final: boolean) {
  const outputs = node.agent?.output_types || [];
  if (final) return `Delivers the final ${outputs.map(humanize).join(' and ') || 'outcome'}.`;
  return `Creates ${outputs.map(humanize).join(' and ') || 'the working material'} for the next agent.`;
}

function inputSummary(node: OutcomePlan['nodes'][number], plan: OutcomePlan) {
  const required = node.agent?.required_input_types || [];
  if (required.length === 0) return 'No required input';
  const producedEarlier = new Map<string, number>();
  for (const earlier of plan.nodes.slice(0, node.ordinal)) {
    for (const output of earlier.agent?.output_types || []) producedEarlier.set(output, earlier.ordinal + 1);
  }
  const unresolved = new Set(plan.unresolved_missing_assets.map((item) => item.kind));
  return required.map((input) => {
    const sourceStep = producedEarlier.get(input);
    if (sourceStep) return `${humanize(input)} (from step ${sourceStep})`;
    if (unresolved.has(input)) return `${humanize(input)} (you provide)`;
    return `${humanize(input)} (provided)`;
  }).join(', ');
}

function PlanBody({ intent, plan, onStart, onProvideInput, starting, providingInput, startError, verificationProgress, cancelingVerification, onCancelVerification, runInstructions, onRunInstructionsChange, instructionsDirty, instructionsError, onApplyRunInstructions }: {
  intent: OutcomeIntent;
  plan: OutcomePlan;
  onStart: () => void;
  onProvideInput: (kind: string) => void;
  starting: boolean;
  providingInput: boolean;
  startError: string | null;
  verificationProgress?: RunInputProgress | null;
  cancelingVerification?: boolean;
  onCancelVerification?: () => void;
  runInstructions: string;
  onRunInstructionsChange: (value: string) => void;
  instructionsDirty: boolean;
  instructionsError: string | null;
  onApplyRunInstructions: () => void;
}) {
  const startable = canStartPlan(plan) && !instructionsDirty && !instructionsError;
  const ceiling = intent.consequential_action_ceiling;
  return (
    <section aria-label="Recommended plan" className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-50">Recommended {plan.nodes.length === 1 ? 'agent' : 'agent chain'}</h3>
          <p className="text-xs text-ink-400 mt-1">
            {plan.nodes.length === 1 ? 'One agent can deliver this outcome.' : `${plan.nodes.length} agents will work in this order.`}
          </p>
        </div>
        <span className="text-[11px] text-ink-500" title="The immutable Backend plan identity echoed at Start.">
          {plan.scorer_version} · plan {plan.digest.slice(0, 12)}
        </span>
      </div>

      <ol className="mt-4 space-y-3" aria-label="Agent chain">
        {plan.nodes.map((node) => (
          <li key={node.workflow_version_id} className="border border-ink-800 rounded-lg p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-medium text-ink-100">
                {node.ordinal + 1}. {node.agent?.name || node.slug || `Agent ${node.workflow_id.slice(0, 8)}`}
              </div>
              <span className="text-xs text-ink-400">{node.budget_credits.toLocaleString()} credits</span>
            </div>
            <p className="text-sm text-ink-300 mt-2">
              {nodePurpose(node, node.ordinal === plan.nodes.length - 1)}
            </p>
            {node.agent && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
                <p className="text-ink-400"><span className="text-ink-200">Needs:</span> {inputSummary(node, plan)}</p>
                <p className="text-ink-400"><span className="text-ink-200">Produces:</span> {node.agent.output_types.map(humanize).join(', ')}</p>
              </div>
            )}
            <p className="text-[11px] text-ink-500 mt-3">
              Up to {Math.round(node.max_duration_ms / 60000)} min · {node.max_retries} {node.max_retries === 1 ? 'retry' : 'retries'} · {node.max_invocations.toLocaleString()} invocations maximum
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

      <div className="mt-4 rounded-lg border border-ink-800 p-4">
        <label htmlFor="outcome-run-instructions" className="text-sm font-medium text-ink-200">
          Run instructions <span className="font-normal text-ink-500">(optional)</span>
        </label>
        <p className="text-xs text-ink-500 mt-1">Add direction for this production only. It will be bound into the plan and sent to every agent in the chain.</p>
        <textarea
          id="outcome-run-instructions"
          value={runInstructions}
          onChange={(event) => onRunInstructionsChange(event.target.value)}
          disabled={providingInput || starting}
          rows={3}
          maxLength={2000}
          placeholder="e.g. Keep the final video 16:9, use cinematic pacing, and cite sourced visuals."
          className="mt-2 w-full rounded-lg bg-ink-900 border border-ink-700 px-3 py-2.5 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-ink-500 disabled:opacity-50"
        />
        {instructionsError && <p role="status" className="mt-2 text-xs text-red-400">{instructionsError}</p>}
        {!instructionsError && instructionsDirty && plan.unresolved_missing_assets.length > 0 && (
          <p className="mt-2 text-xs text-amber-300">These instructions will be bound when you add the required input.</p>
        )}
        {!instructionsError && instructionsDirty && plan.unresolved_missing_assets.length === 0 && (
          <button type="button" onClick={onApplyRunInstructions} className="mt-2 rounded-lg border border-ink-600 px-3 py-2 text-xs font-medium text-ink-200 hover:border-ink-400">
            Apply instructions to plan
          </button>
        )}
        {!instructionsDirty && runInstructions.trim() && <p className="mt-2 text-xs text-emerald-300">Included in this plan.</p>}
      </div>

      {plan.unresolved_missing_assets.length > 0 && (
        <div role="status" aria-label="Missing inputs" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">What you’ll provide before starting</p>
          <p className="text-xs text-ink-400 mt-1">The recommendation is complete; these inputs only gate execution.</p>
          {plan.unresolved_missing_assets.map((item) => (
            <div key={`${item.kind}-${item.description}`} className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-300">{item.description}</p>
              <button
                type="button"
                onClick={() => onProvideInput(item.kind)}
                disabled={providingInput || !!instructionsError}
                className="rounded-lg border border-amber-500/50 px-3 py-2 text-xs font-medium text-amber-200 hover:border-amber-400 disabled:opacity-50"
              >
                {providingInput ? 'Verifying…' : `Add ${humanize(item.kind)}`}
              </button>
            </div>
          ))}
          {verificationProgress && onCancelVerification && (
            <RunInputVerificationProgress progress={verificationProgress} canceling={!!cancelingVerification} onCancel={onCancelVerification} />
          )}
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

export default function OutcomePlanCard({ outcome, onStart, onProvideInput, starting, providingInput, startError, verificationProgress, cancelingVerification, onCancelVerification, runInstructions, onRunInstructionsChange, instructionsDirty, instructionsError, onApplyRunInstructions }: {
  outcome: PlanOutcome;
  onStart: () => void;
  onProvideInput: (kind: string) => void;
  starting: boolean;
  providingInput: boolean;
  startError: string | null;
  verificationProgress?: RunInputProgress | null;
  cancelingVerification?: boolean;
  onCancelVerification?: () => void;
  runInstructions: string;
  onRunInstructionsChange: (value: string) => void;
  instructionsDirty: boolean;
  instructionsError: string | null;
  onApplyRunInstructions: () => void;
}) {
  if (outcome.kind === 'no_eligible') return <NoEligiblePanel noEligible={outcome.noEligible} />;
  if (outcome.kind === 'no_match') {
    return <section role="status" aria-label="No matching outcome" className="card p-5 border-amber-500/40"><h3 className="text-sm font-semibold text-amber-300">No matching outcome</h3><p className="text-sm text-ink-300 mt-1">{outcome.message}</p></section>;
  }
  if (outcome.kind === 'needs_input') {
    return <section role="status" aria-label="Input required" className="card p-5 border-amber-500/40"><h3 className="text-sm font-semibold text-amber-300">One input is still needed</h3><p className="text-sm text-ink-300 mt-1">{outcome.question}</p><p className="text-xs text-ink-500 mt-3">Add a verified artifact above and label it as {outcome.missingInputTypes.join(' or ')}. Nothing was started.</p></section>;
  }
  if (outcome.kind !== 'plan') return null;
  return <PlanBody intent={outcome.intent} plan={outcome.plan} onStart={onStart} onProvideInput={onProvideInput} starting={starting} providingInput={providingInput} startError={startError} verificationProgress={verificationProgress} cancelingVerification={cancelingVerification} onCancelVerification={onCancelVerification} runInstructions={runInstructions} onRunInstructionsChange={onRunInstructionsChange} instructionsDirty={instructionsDirty} instructionsError={instructionsError} onApplyRunInstructions={onApplyRunInstructions} />;
}
