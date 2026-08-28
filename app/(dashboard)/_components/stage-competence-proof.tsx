import {
  competenceEmptyCopy,
  competenceSupplyLabel,
  stageSkillStatus,
  type StageCompetenceProof,
} from '@/lib/run-competence-proof';

export default function StageCompetenceProof({ proof }: { proof: StageCompetenceProof }) {
  const empty = competenceEmptyCopy(proof);
  return (
    <section className="mb-6 rounded-lg border border-sky-500/25 bg-sky-500/[0.04] p-4" aria-label="Skills executed and stage competence">
      <h2 className="text-sm font-semibold text-ink-100">Skills executed / stage competence</h2>
      <p className="mt-1 text-xs text-ink-500">
        Frozen bindings and executor handling receipts are separate facts. This proof is independent of learned rules.
      </p>
      {empty ? (
        <p className={`mt-2 text-xs ${proof.contextStatus === 'unavailable' ? 'text-amber-300' : 'text-ink-500'}`}>{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {proof.bindings.map((skill) => {
            const status = stageSkillStatus(skill, proof);
            const receipt = proof.receipts.find((item) => item.skillId === skill.skillId);
            return (
              <li key={skill.skillId} className="rounded-md border border-ink-800 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink-100">{skill.source}/{skill.slug}</p>
                  <span className={`text-[11px] ${status.tone === 'positive' ? 'text-emerald-300' : status.tone === 'warning' ? 'text-amber-300' : 'text-ink-400'}`}>
                    {status.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-400">
                  Binding frozen for stage{skill.stages.length === 1 ? '' : 's'} {skill.stages.join(', ')} · {competenceSupplyLabel(proof)} · sha256 {skill.contentDigest.slice(0, 12)}…
                </p>
                <p className="mt-1 text-xs text-ink-500">{status.detail}</p>
                {typeof receipt?.evidenceBinding?.kind === 'string' && receipt.evidenceBinding.kind !== 'none' && (
                  <p className="mt-1 text-[11px] text-ink-500">
                    Evidence: {receipt.evidenceBinding.kind} {typeof receipt.evidenceBinding.id === 'string' ? receipt.evidenceBinding.id.slice(0, 12) : ''}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-ink-500">Applied is an executor handling report, not proof of quality or causation.</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
