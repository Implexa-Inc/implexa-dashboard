import { managerVerificationLabel, type StageManagerProof } from '@/lib/run-manager-proof';

function tone(status: StageManagerProof['verificationStatus']): string {
  if (status === 'passed') return 'border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-300';
  if (status === 'failed') return 'border-rose-500/30 bg-rose-500/[0.07] text-rose-300';
  if (status === 'needs_you') return 'border-amber-500/40 bg-amber-500/[0.09] text-amber-300';
  if (status === 'incomplete' || status === 'unavailable') return 'border-amber-500/30 bg-amber-500/[0.07] text-amber-300';
  return 'border-ink-700 bg-ink-900/50 text-ink-400';
}

function stageLabel(stage: string): string {
  return stage.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function StageManagerProof({ proof }: { proof: StageManagerProof }) {
  return (
    <section className="mb-6 rounded-lg border border-violet-500/25 bg-violet-500/[0.04] p-4" aria-label="Manager verification proof">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-100">Manager verification</h2>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone(proof.verificationStatus)}`}>
          {managerVerificationLabel(proof)}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-500">
        Stage handling and independent evidence are shown separately from the original run status and Judge verdict.
      </p>

      {proof.status === 'unavailable' ? (
        <p className="mt-2 text-xs text-amber-300">Manager verification could not be loaded. No result is inferred.</p>
      ) : proof.status === 'none' ? (
        <p className="mt-2 text-xs text-ink-500">No Manager stage context was recorded for this run.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {proof.stages.map((stage) => (
            <li key={stage.stage} className="rounded-md border border-ink-800 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-100">{stageLabel(stage.stage)}</p>
                <span className="text-[11px] text-ink-400">
                  {stage.verificationStatus === 'passed'
                    ? `Verified ${stage.verifiedCriterionCount}/${stage.requiredCriterionCount}`
                    : stage.verificationStatus.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-400">
                {stage.decisionCount} decision{stage.decisionCount === 1 ? '' : 's'} selected · {stage.appliedCount} applied
                {stage.exceptionCount ? ` · ${stage.exceptionCount} inapplicable` : ''}
                {stage.unavailableCount ? ` · ${stage.unavailableCount} unavailable` : ''}
                {stage.refusedCount ? ` · ${stage.refusedCount} refused` : ''}
              </p>
              {stage.handlingStatus === 'not_recorded' && (
                <p className="mt-1 text-xs text-amber-300">Executor handling was not recorded; application is not inferred.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {proof.status === 'ready' && proof.verificationStatus === 'passed' && (
        <p className="mt-3 text-xs text-emerald-300">
          The complete frozen Manager criteria are verified. Earlier failed attempts and model judgments remain preserved as history.
        </p>
      )}
      {proof.status === 'ready' && proof.verificationStatus === 'needs_you' && (
        <p role="alert" className="mt-3 text-xs text-amber-300">
          A selected Manager decision with required evidence was not applied. Independent verification did not
          start, and no Judge result or successful Manager proof is inferred. Review the stage handling above.
        </p>
      )}
    </section>
  );
}
