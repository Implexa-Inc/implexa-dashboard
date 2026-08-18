/**
 * <OutcomeProductionTrace /> — one chronological account of the whole
 * production, across every agent.
 *
 * Each per-agent section answers "what did THIS agent do". This answers the
 * question no single agent can: in what order did the production actually
 * happen, including the moments that belong to neither agent alone — the plan,
 * the dispatches, an engine reroute, an output becoming validated evidence, the
 * receipt.
 *
 * Every row is a persisted, timestamped fact the backend read from a table, and
 * each carries the agent it belongs to. Nothing is inferred from what the page
 * is currently rendering — which is why an unknown event type renders its raw
 * name rather than being dropped: a trace that silently omits what it does not
 * recognise is a trace that lies.
 */

import { traceLabel, ENGINE_LABELS, type ProductionTraceEntry } from '@/lib/outcome-production-detail';

function clock(iso: string): string {
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleTimeString() : iso;
}

/**
 * The one line of detail a row is allowed, drawn only from typed fields the
 * backend put there. Deliberately never a template over free text.
 */
function detailLine(entry: ProductionTraceEntry): string | null {
  const d = entry.detail as Record<string, unknown>;
  if (entry.type === 'child_engine_selected') {
    const actual = typeof d.actualEngine === 'string' ? ENGINE_LABELS[d.actualEngine as 'claude' | 'codex'] : null;
    const requested = typeof d.requestedEngine === 'string' ? ENGINE_LABELS[d.requestedEngine as 'claude' | 'codex'] : null;
    if (!actual) return null;
    if (d.failover === true && requested && requested !== actual) {
      const why = typeof d.failoverReason === 'string' && d.failoverReason ? ` — ${d.failoverReason}` : '';
      return `${requested} was requested; executed with ${actual}${why}`;
    }
    return `executed with ${actual}`;
  }
  if (entry.type === 'child_artifact_validated') {
    const name = typeof d.artifactName === 'string' ? d.artifactName : 'output';
    const digest = typeof d.digestPrefix === 'string' ? ` · ${d.digestPrefix}` : '';
    return `${name}${digest}`;
  }
  if (entry.type === 'child_settled') {
    const label = typeof d.outcomeLabel === 'string' ? d.outcomeLabel : null;
    const credits = typeof d.actualCredits === 'number' ? ` · ${d.actualCredits} credits` : '';
    return label ? `${label}${credits}` : null;
  }
  if (entry.type === 'child_dispatch_released' || entry.type === 'child_budget_reserved') {
    if (typeof d.reason === 'string' && d.reason) return d.reason;
    if (typeof d.budgetCredits === 'number') return `${d.budgetCredits} credits reserved`;
    return typeof d.outcomeLabel === 'string' ? d.outcomeLabel : null;
  }
  if (entry.type === 'receipt_recorded') {
    return typeof d.finalStatus === 'string' ? d.finalStatus : null;
  }
  return null;
}

export default function OutcomeProductionTrace({
  trace,
  truncated = false,
}: {
  trace: ProductionTraceEntry[];
  truncated?: boolean;
}) {
  if (!trace.length) return null;
  return (
    <section aria-label="Production trace" className="card p-5">
      <h2 className="text-sm font-semibold text-ink-100">Production trace</h2>
      <p className="text-xs text-ink-500 mt-0.5">
        Every recorded step of this production, across all agents, in the order it happened.
      </p>
      <ol className="mt-4 space-y-2">
        {trace.map((entry, index) => {
          const detail = detailLine(entry);
          return (
            <li key={`${entry.at}:${entry.type}:${entry.ordinal ?? 'parent'}:${index}`} className="flex items-start gap-3 text-xs">
              <span className="font-mono text-ink-600 shrink-0 tabular-nums">{clock(entry.at)}</span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  entry.ordinal === null
                    ? 'bg-ink-800 text-ink-400'
                    : 'bg-brand-500/15 text-brand-600 dark:text-brand-300'
                }`}
              >
                {entry.ordinal === null ? 'Production' : `Agent ${entry.ordinal + 1}`}
              </span>
              <span className="min-w-0">
                <span className="text-ink-100">{traceLabel(entry)}</span>
                {detail && <span className="text-ink-400"> — {detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {truncated && (
        <p className="mt-3 text-[11px] text-ink-500">
          This production recorded more events than shown here; the oldest are omitted.
        </p>
      )}
    </section>
  );
}
