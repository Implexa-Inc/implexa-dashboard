import Link from 'next/link';
import { JudgeReviewRetry } from './judge-review-retry';
import { judgeRepairState } from '@/lib/judge-repair-state';
import JudgeFeedbackControls from './judge-feedback-controls';
import { ManagerRepairCheckpointRetry } from './manager-repair-checkpoint-retry';

export type RunJudgment = {
  id?: string;
  verdict: 'pass' | 'repair' | 'blocked' | 'uncertain';
  feedback?: 'accurate' | 'not_accurate' | null;
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
  repair_round?: number | null;
  repair_limit?: number | null;
  created_at?: string | null;
  creative_grade?: { contractVersion: 'creative-grade.v1' | 'creative-grade.v2'; overallBand: string; overallScore?: number | null; summary: string;
    calibration: 'uncalibrated'; relativePath: string; artifactSha256: string; rubricDigest: string;
    dimensions: Array<{id: string; band: string; score?: number | null; explanation: string;
      gaps: Array<{timestampMs: number; observation: string; suggestion: string}>}>;
    coverage: {durationMs: number; timestampsMs: number[]; limitations: string; continuousPlaybackVerified: false};
  } | null;
};

export type JudgeRepairRequest = {
  id?: string | null;
  status?: string | null;
  lifecycle_state?: string | null;
  run_id?: string | null;
  created_at?: string | null;
};

const STYLE: Record<RunJudgment['verdict'], { label: string; border: string; text: string; bg: string }> = {
  pass:      { label: 'Passed review', border: 'border-emerald-500/30', text: 'text-state-ok', bg: 'bg-emerald-500/5' },
  repair:    { label: 'Repair needed', border: 'border-amber-500/35', text: 'text-state-needs', bg: 'bg-amber-500/5' },
  blocked:   { label: 'Blocked', border: 'border-orange-500/35', text: 'text-state-needs', bg: 'bg-orange-500/5' },
  uncertain: { label: 'Couldn’t confirm', border: 'border-ink-700', text: 'text-ink-300', bg: 'bg-ink-900/40' },
};

export function RunJudgmentCard({
  judgment, repairRequest = null, currentRunId, finalOutputSha256, reviewPending = false,
}: {
  judgment: RunJudgment | null;
  repairRequest?: JudgeRepairRequest | null;
  currentRunId?: string;
  finalOutputSha256?: string | null;
  reviewPending?: boolean;
}) {
  if (!judgment) return null;
  const scored = judgment.creative_grade?.contractVersion === 'creative-grade.v2';
  const total = judgment.creative_grade?.overallScore;
  const assessedScore = typeof total === 'number' && Number.isInteger(total) && total >= 0 && total <= 100;
  const s = STYLE[judgment.verdict] || STYLE.uncertain;
  const criteria = Array.isArray(judgment.criteria_results) ? judgment.criteria_results : [];
  const details = criteria.length || judgment.paths_taken?.length || judgment.evidence_refs?.length;
  const repairRound = Number(judgment.repair_round) || 0;
  const repairLimit = Number(judgment.repair_limit) || 2;
  const repair = judgeRepairState({
    verdict: judgment.verdict,
    repairRound,
    requestStatus: repairRequest?.status,
    requestRunId: repairRequest?.run_id,
    currentRunId,
    maxRounds: repairLimit,
  });
  const verdictLabel = judgment.verdict === 'pass' && judgment.creative_grade ? 'Technical delivery reviewed'
    : judgment.verdict !== 'repair' ? s.label
    : repair.phase === 'completed' ? 'Repaired'
    : repair.phase === 'queued' || repair.phase === 'running' ? 'Repairing'
    : 'Needs review';
  return (
    <section className={`mb-6 rounded-xl border ${s.border} ${s.bg} px-4 py-4`} aria-label="Tukido Judge result">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-ink-100">Tukido Judge</h2>
            <span className={`text-xs font-medium ${s.text}`}>{verdictLabel}</span>
          </div>
          <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink-300">Review notes</summary><p className="mt-2 leading-relaxed whitespace-pre-wrap text-ink-300">{judgment.summary}</p></details>
        </div>
        <span className="flex-none text-[10px] uppercase tracking-wide text-ink-500">AI review</span>
      </div>

      {judgment.verdict === 'uncertain' && judgment.id && currentRunId && finalOutputSha256 &&
        <JudgeReviewRetry key={judgment.id} runId={currentRunId} judgmentId={judgment.id}
          finalOutputSha256={finalOutputSha256} pending={reviewPending} />}

      {judgment.creative_grade && <details aria-label={scored ? 'Quality score' : 'Creative grade'} className="mt-4 rounded-lg border border-ink-700 p-3 space-y-2">
        <summary className="cursor-pointer text-sm font-medium text-ink-100">{scored
          ? assessedScore ? `Quality ${total}/100` : 'Quality not assessed'
          : `Creative grade: ${judgment.creative_grade.overallBand}`}</summary>
        <p className="text-xs text-ink-400">{scored ? 'One model review, not calibrated.' : 'Uncalibrated AI assessment.'} Separate from technical delivery; an open quality gap is not a failed run.</p>
        <p className="text-sm text-ink-200">{judgment.creative_grade.summary}</p>
        {judgment.creative_grade.dimensions.map(d => <details key={d.id} className="text-sm">
          <summary>{d.id.replaceAll('_', ' ')} — {scored ? typeof d.score === 'number' ? `${d.score}/100` : 'not assessed' : d.band}</summary>
          <p className="mt-1 text-ink-300">{d.explanation}</p>
          {d.gaps.map((g, i) => <p key={i} className="mt-2 text-ink-300">{(g.timestampMs / 1000).toFixed(1)}s: {g.observation} {g.suggestion}</p>)}
        </details>)}
        <p className="text-xs text-ink-400">Sampled stills at {judgment.creative_grade.coverage.timestampsMs.map(t => `${(t / 1000).toFixed(1)}s`).join(', ')}. {judgment.creative_grade.coverage.limitations}</p>
        <details className="text-xs text-ink-500"><summary>Review binding</summary>
          <p className="break-all">Output: {judgment.creative_grade.relativePath}<br />SHA-256: {judgment.creative_grade.artifactSha256}<br />Rubric: {judgment.creative_grade.rubricDigest}</p>
        </details>
      </details>}

      {judgment.next_action && judgment.verdict !== 'pass' && (
        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Best next step</div>
          <p className="text-sm text-ink-200 whitespace-pre-wrap">{judgment.next_action}</p>
        </div>
      )}

      {judgment.verdict === 'repair' && (
        <div className="mt-3 rounded-lg border border-violet-500/25 bg-violet-500/5 px-3 py-2.5 text-xs">
          {repair.phase === 'limit_reached' ? (
            <p className="text-state-needs">Automatic repair stopped after {repairLimit} passes. Review the remaining issue and continue manually below.</p>
          ) : repair.phase === 'queued' ? (
            <p className="text-state-review">Automatic repair pass {repair.nextRound} of {repairLimit} is queued.</p>
          ) : repair.phase === 'running' ? (
            <p className="text-state-review">Automatic repair pass {repair.nextRound} of {repairLimit} is running now. The updated result will be judged again.</p>
          ) : repair.phase === 'completed' && repair.repairedRunId ? (
            <p className="text-state-ok">Repair completed. <Link href={`/runs/${encodeURIComponent(repair.repairedRunId)}`} className="underline hover:text-state-ok">Open the repaired run and its fresh review →</Link></p>
          ) : (
            <p className="text-state-needs">Automatic repair could not be queued. The instructions remain available below so you can continue manually.</p>
          )}
        </div>
      )}

      {judgment.verdict === 'repair' && repairRequest?.id
        && repairRequest.status === 'done' && repairRequest.lifecycle_state === 'failed' && (
        <ManagerRepairCheckpointRetry requestId={repairRequest.id} />
      )}

      {(judgment.verdict === 'blocked' || judgment.verdict === 'uncertain') && (
        <div className="mt-3 rounded-lg border border-orange-500/25 bg-orange-500/5 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-state-needs mb-1">Human action required</div>
          <p className="text-xs text-ink-300">Tukido stopped the loop instead of guessing or repeating a consequential action. Review the reason above, then continue when ready.</p>
        </div>
      )}

      {judgment.repair_prompt && judgment.verdict === 'repair' && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-action-accent hover:text-action-accent">Show repair instructions</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-ink-950/70 border border-ink-800 px-3 py-2.5 text-xs text-ink-300 font-sans">{judgment.repair_prompt}</pre>
        </details>
      )}

      {judgment.verdict === 'repair' && judgment.repair_prompt && (repair.phase === 'limit_reached' || repair.phase === 'queue_failed') && (
        <p className="mt-2 text-[11px] text-ink-500">These repair instructions are also prefilled in “Continue this run” below as a manual fallback.</p>
      )}

      {!!details && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-ink-400 hover:text-ink-200">Evidence and criteria</summary>
          <div className="mt-2 space-y-2 text-xs text-ink-400">
            {criteria.map((c, i) => (
              <div key={`${c.criterion || 'criterion'}-${i}`} className="flex gap-2">
                <span className={c.met === true ? 'text-state-ok' : c.met === false ? 'text-state-needs' : 'text-ink-500'}>{c.met === true ? '✓' : c.met === false ? '○' : '?'}</span>
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
        {' '}This model review is separate from the evidence-based “Delivered” badge above.
      </p>

      {/* Calibration on EVERY verdict, not just blocks. A wrong `pass` is the most
          valuable signal observe mode can collect, and exposing feedback only on
          blocks would bias the calibration set toward the one verdict that already
          stops the loop. Needs the judgment id to target the row. */}
      {judgment.id && (
        <div className="mt-3 pt-3 border-t border-ink-800">
          <JudgeFeedbackControls judgmentId={judgment.id} initial={judgment.feedback ?? null} />
        </div>
      )}
    </section>
  );
}
