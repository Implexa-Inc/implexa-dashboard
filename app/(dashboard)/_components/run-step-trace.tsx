/**
 * <RunStepTrace /> — the presentational half of a run's free-text step trace.
 *
 * The counterpart to <RunStepsList>: where that answers "which of the steps are
 * done", this answers "what did it last SAY", which is the only thing that tells
 * you WHERE a run got stuck. Both the run permalink and each Production node
 * render it from the same column (skill_runs.progress.history, migration 0080),
 * so it lives here once rather than being written twice and drifting.
 *
 * Pure and presentational. `stalled` is passed in rather than derived: the run
 * page knows it from run liveness and the Production page from the parent's own
 * account of the node, and neither should be re-deciding it inside a renderer.
 */

export type TraceListEntry = { at: string; step?: string | null; note?: string | null };

function rel(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function RunStepTrace({
  entries,
  live = false,
  attention = false,
  stalled = false,
  compact = false,
  heading = 'Step trace',
  action = null,
}: {
  entries: TraceListEntry[];
  live?: boolean;
  /** The last entry is where something needs the user — tint it amber. */
  attention?: boolean;
  stalled?: boolean;
  compact?: boolean;
  heading?: string | null;
  action?: React.ReactNode;
}) {
  if (!entries?.length) return null;
  return (
    <div className={compact ? '' : 'mb-6 rounded-lg border border-ink-800 bg-ink-950/40 p-4'}>
      {heading !== null && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-ink-300">{heading}</span>
          {live && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-sky-700 dark:text-sky-300 bg-sky-500/15 rounded px-1.5 py-0.5">live</span>
          )}
          {action}
        </div>
      )}
      <ol className={compact ? 'space-y-1.5' : 'space-y-2'}>
        {entries.map((e, i) => {
          const isLast = i === entries.length - 1;
          const dot = isLast && attention
            ? 'bg-amber-500 dark:bg-amber-400'
            : isLast && live
              ? 'bg-sky-500 dark:bg-sky-400'
              : 'bg-ink-600';
          return (
            <li key={`${e.at}:${i}`} className={`flex items-start gap-2.5 ${compact ? 'text-xs' : 'text-sm'}`}>
              <span className={`mt-[7px] h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {e.step && <span className="font-mono text-xs text-ink-500 mr-1.5">{e.step}</span>}
                <span className="text-ink-200">{e.note || 'progress'}</span>
                <span className="text-ink-600 text-xs ml-2">{rel(e.at)}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {stalled && (
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-3 leading-relaxed">
          Stuck here. This is the last step it reported before it stopped making progress.
        </p>
      )}
    </div>
  );
}
