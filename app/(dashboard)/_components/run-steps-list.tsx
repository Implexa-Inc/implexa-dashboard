/**
 * <RunStepsList /> — the presentational half of an agent's step checklist.
 *
 * WHY IT IS ITS OWN COMPONENT. This list is rendered on two surfaces now: the
 * run permalink, where <RunStepChecklist> polls the backend and feeds it, and
 * the Production page, where the server read model already carries each node's
 * steps. Two implementations of "which steps are done" is how the same run ends
 * up looking finished on one page and stuck on the other, so there is one
 * renderer and both surfaces hand it the SAME typed rows.
 *
 * The prop type is the intersection both models satisfy — skill_runs.steps_state
 * (migration 0089) and production.nodes[].execution.steps are the same fact from
 * the same column, projected twice.
 *
 * Pure and presentational: no polling, no fetching, no router. The Production
 * page passes `compact` for its per-node sections, which changes density only —
 * never which steps are shown or what they are called.
 */

export type StepListStatus = 'pending' | 'running' | 'done' | 'failed';
export type StepListItem = { index: number; label?: string | null; status: StepListStatus };

// Per-status glyph + tint. running = spinner (it's the live one), done = check,
// failed = ✕, pending = hollow dot.
export function StepIcon({ status }: { status: StepListStatus }) {
  if (status === 'running') {
    return <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-sky-500/25 border-t-sky-500 animate-spin" aria-hidden="true" />;
  }
  if (status === 'done') {
    return <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center text-[9px] font-bold" aria-hidden="true">✓</span>;
  }
  if (status === 'failed') {
    return <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 grid place-items-center text-[9px] font-bold" aria-hidden="true">✕</span>;
  }
  return <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-ink-700" aria-hidden="true" />;
}

export function stepSummary(steps: StepListItem[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.status === 'done').length, total: steps.length };
}

export default function RunStepsList({
  steps,
  live = false,
  compact = false,
  heading = 'Steps',
  /** Rendered inside the header row — e.g. the trace's manual refresh. */
  action = null,
}: {
  steps: StepListItem[];
  live?: boolean;
  compact?: boolean;
  heading?: string | null;
  action?: React.ReactNode;
}) {
  if (!steps?.length) return null;
  const { done, total } = stepSummary(steps);
  return (
    <div className={compact ? '' : 'mb-6 rounded-lg border border-ink-800 bg-ink-950/40 p-4'}>
      {heading !== null && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-ink-300">{heading}</span>
          {live && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-sky-700 dark:text-sky-300 bg-sky-500/15 rounded px-1.5 py-0.5">live</span>
          )}
          <span className="text-[11px] text-ink-500 ml-auto">{done}/{total} done</span>
          {action}
        </div>
      )}
      <ol className={compact ? 'space-y-1.5' : 'space-y-2'}>
        {steps.map((s) => (
          <li key={s.index} className={`flex items-center gap-2.5 ${compact ? 'text-xs' : 'text-sm'}`}>
            <StepIcon status={s.status} />
            <span className="text-[11px] font-mono text-ink-600 shrink-0">{s.index}/{total}</span>
            <span className={s.status === 'pending' ? 'text-ink-500 truncate' : 'text-ink-100 truncate'}>
              {s.label || `Step ${s.index}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
