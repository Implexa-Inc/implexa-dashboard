/**
 * The finished Work item: ONE accountable result for the whole production —
 * artifacts, provenance, review state, and the plan receipt.
 *
 * Server-renderable and pure: everything shown is a field of the
 * ProductionReceipt the backend settled. The outcome type is TYPED
 * (success/partial/failure) and displayed as the backend stated it — a
 * partial is a partial, never dressed up as a success, and unknown
 * verification states render as their own words, never converted to a claim.
 */

import type { ProductionReceipt } from '@/lib/outcome-production';

const OUTCOME_COPY: Record<ProductionReceipt['outcome']['type'], { label: string; className: string }> = {
  success: { label: 'Delivered', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  partial: { label: 'Partially delivered', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  failure: { label: 'Not delivered', className: 'bg-red-500/15 text-red-300 border-red-500/30' },
};

export default function OutcomeWorkItem({ receipt }: { receipt: ProductionReceipt }) {
  const outcome = OUTCOME_COPY[receipt.outcome.type];
  const { budget } = receipt;

  return (
    <section aria-label="Work item" className="card p-6">
      <div className="flex items-center gap-2.5">
        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${outcome.className}`}>
          {outcome.label}
        </span>
        <span className="text-xs text-ink-500">Work item {receipt.workItemId.slice(0, 8)}</span>
      </div>
      {receipt.outcome.detail && (
        <p className="text-sm text-ink-300 mt-2">{receipt.outcome.detail}</p>
      )}

      <h3 className="text-sm font-semibold text-ink-50 mt-5">Artifacts</h3>
      {receipt.artifacts.length === 0 ? (
        <p className="text-sm text-ink-400 mt-1">This production settled without artifacts.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {receipt.artifacts.map((artifact) => (
            <li key={artifact.id} className="border border-ink-800 rounded-lg px-4 py-3">
              <span className="text-sm text-ink-100">{artifact.name}</span>
              <span className="block text-xs text-ink-500 mt-0.5" title="SHA-256 digest of the artifact bytes">
                {artifact.kind} · digest {artifact.digest.slice(0, 16)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-sm font-semibold text-ink-50 mt-6">Provenance</h3>
      <ol className="mt-2 space-y-1.5">
        {receipt.selectedPath.map((step) => (
          <li key={step.agentVersionId} className="text-sm text-ink-300">
            {step.order + 1}. {step.agentName} <span className="text-ink-500">v{step.versionNumber}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-ink-500 mt-2">
        Selected by {receipt.scorerVersion} (weights {receipt.weightSetDigest.slice(0, 12)}) · plan {receipt.planDigest.slice(0, 12)}
      </p>

      <h3 className="text-sm font-semibold text-ink-50 mt-6">Plan receipt</h3>
      <dl className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-400">Actual cost</dt>
          <dd className="text-ink-100">{budget.spentCredits.toLocaleString()} credits</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-400">Still reserved</dt>
          <dd className="text-ink-100">{budget.reservedCredits.toLocaleString()} credits</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-400">Budget ceiling</dt>
          <dd className="text-ink-100">{budget.maxBudgetCredits.toLocaleString()} credits</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-400">Total time</dt>
          <dd className="text-ink-100">{receipt.durationSeconds === null ? 'Not recorded' : `${Math.round(receipt.durationSeconds / 60)} min`}</dd>
        </div>
      </dl>

      <ul className="mt-3 space-y-1.5">
        {receipt.childReceipts.map((child) => (
          <li key={child.requestId || child.runId || `step:${child.order}`} className="text-xs text-ink-400">
            Step {child.order + 1}: {child.costCredits.toLocaleString()} credits ·
            {' '}verification: <span className="text-ink-300">{child.verification.replace(/_/g, ' ')}</span> ·
            {' '}judge: <span className="text-ink-300">{child.judge.replace(/_/g, ' ')}</span>
          </li>
        ))}
      </ul>

      <p className="text-sm text-ink-300 mt-6 border-t border-ink-800 pt-4">
        Review: <span className="text-ink-100">{receipt.review.state.replace(/_/g, ' ')}</span>
      </p>
    </section>
  );
}
