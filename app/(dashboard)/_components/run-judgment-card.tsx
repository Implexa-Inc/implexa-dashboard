export type RunJudgment = {
  verdict: 'pass' | 'repair' | 'blocked' | 'uncertain';
  summary: string;
  criteria_results?: Array<{ criterion?: string; met?: boolean | null; evidence?: string | null; reason?: string | null }> | null;
  evidence_refs?: string[] | null;
  paths_taken?: string[] | null;
  next_action?: string | null;
  repair_prompt?: string | null;
  worker_executor?: string | null;
  worker_model?: string | null;
  judge_executor?: string | null;
  judge_model?: string | null;
  deterministic_verification?: string | null;
  created_at?: string | null;
};

const STYLE: Record<RunJudgment['verdict'], { label: string; border: string; text: string; bg: string }> = {
  pass:      { label: 'Passed review', border: 'border-emerald-500/30', text: 'text-emerald-300', bg: 'bg-emerald-500/5' },
  repair:    { label: 'Repair recommended', border: 'border-amber-500/35', text: 'text-amber-300', bg: 'bg-amber-500/5' },
  blocked:   { label: 'Blocked', border: 'border-orange-500/35', text: 'text-orange-300', bg: 'bg-orange-500/5' },
  uncertain: { label: 'Couldn’t confirm', border: 'border-ink-700', text: 'text-ink-300', bg: 'bg-ink-900/40' },
};

export function RunJudgmentCard({ judgment }: { judgment: RunJudgment | null }) {
  if (!judgment) return null;
  const s = STYLE[judgment.verdict] || STYLE.uncertain;
  const criteria = Array.isArray(judgment.criteria_results) ? judgment.criteria_results : [];
  const details = criteria.length || judgment.paths_taken?.length || judgment.evidence_refs?.length;
  return (
    <section className={`mb-6 rounded-xl border ${s.border} ${s.bg} px-4 py-4`} aria-label="Implexa Judge result">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-ink-100">Implexa Judge</h2>
            <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>
          </div>
          <p className="text-sm text-ink-300 mt-2 leading-relaxed whitespace-pre-wrap">{judgment.summary}</p>
        </div>
        <span className="flex-none text-[10px] uppercase tracking-wide text-ink-500">AI review</span>
      </div>

      {judgment.next_action && judgment.verdict !== 'pass' && (
        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Best next step</div>
          <p className="text-sm text-ink-200 whitespace-pre-wrap">{judgment.next_action}</p>
        </div>
      )}

      {judgment.repair_prompt && judgment.verdict === 'repair' && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-brand-400 hover:text-brand-300">Show repair instructions</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-ink-950/70 border border-ink-800 px-3 py-2.5 text-xs text-ink-300 font-sans">{judgment.repair_prompt}</pre>
        </details>
      )}

      {judgment.verdict === 'repair' && judgment.repair_prompt && (
        <p className="mt-2 text-[11px] text-ink-500">These repair instructions are prefilled in “Continue this run” below. Review them before you queue anything.</p>
      )}

      {!!details && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-ink-400 hover:text-ink-200">Evidence and criteria</summary>
          <div className="mt-2 space-y-2 text-xs text-ink-400">
            {criteria.map((c, i) => (
              <div key={`${c.criterion || 'criterion'}-${i}`} className="flex gap-2">
                <span className={c.met === true ? 'text-emerald-400' : c.met === false ? 'text-amber-400' : 'text-ink-500'}>{c.met === true ? '✓' : c.met === false ? '○' : '?'}</span>
                <span><span className="text-ink-300">{c.criterion || 'Criterion'}</span>{c.evidence ? ` — ${c.evidence}` : c.reason ? ` — ${c.reason}` : ''}</span>
              </div>
            ))}
            {!!judgment.paths_taken?.length && <div><span className="text-ink-300">Paths taken:</span> {judgment.paths_taken.join(' · ')}</div>}
            {!!judgment.evidence_refs?.length && <div><span className="text-ink-300">Evidence:</span> {judgment.evidence_refs.join(' · ')}</div>}
          </div>
        </details>
      )}

      <p className="mt-3 text-[11px] text-ink-500">
        {judgment.judge_executor ? `${judgment.judge_executor}${judgment.judge_model ? ` · ${judgment.judge_model}` : ''}` : 'Fresh review session'}
        {judgment.worker_executor ? ` reviewed work from ${judgment.worker_executor}${judgment.worker_model ? ` · ${judgment.worker_model}` : ''}` : ''}.
        {' '}This model review is separate from evidence-based “Verified complete.”
      </p>
    </section>
  );
}
