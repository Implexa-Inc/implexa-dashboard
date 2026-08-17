/**
 * <EngineTruthBadge /> — which engine actually ran a node, and whether that is
 * what was asked for.
 *
 * The rule this component exists to hold: a run is labelled Codex or Claude
 * ONLY from `actualEngine`, which the backend reads from the execution context
 * the executing process itself registered. A request's pin, a workflow default,
 * or a queued shell that never executed are NOT evidence of what ran — when
 * nothing actually ran, this says "not started", never a confident engine name.
 *
 * When the three facts disagree it shows all of them plus the router's own
 * words, because "pinned Codex, ran on Claude" is the fact that made a real
 * production unreadable: the failover run was the one that worked, and the page
 * was still describing the node by its pin.
 *
 * Sibling of <EngineOverrideBanner> on the run page — same underlying columns,
 * a compact badge rather than a full-width banner.
 */

import type { ExecutionEngine } from '@/lib/outcome-production-detail';
import { ENGINE_LABELS } from '@/lib/outcome-production-detail';

export function EngineTruthBadge({
  requestedEngine,
  selectedExecutor,
  actualEngine,
  failover,
  failoverReason,
  compact = false,
}: {
  requestedEngine: ExecutionEngine | null;
  selectedExecutor: ExecutionEngine | null;
  actualEngine: ExecutionEngine | null;
  failover: boolean;
  failoverReason: string | null;
  compact?: boolean;
}) {
  // Nothing has executed. Saying "Codex" here — from a pin alone — is exactly
  // the claim that made a stalled shell look like a real Codex run.
  if (!actualEngine) {
    if (!requestedEngine && !selectedExecutor) return null;
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/60 px-2.5 py-0.5 text-xs text-ink-400"
        title="No engine has reported executing this step yet. The engine below is what was requested, not what ran."
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ink-600" aria-hidden="true" />
        Not started
        <span className="text-ink-500">
          · requested {ENGINE_LABELS[(selectedExecutor || requestedEngine)!]}
        </span>
      </span>
    );
  }

  const tone = failover
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    : 'border-ink-700 bg-ink-900/60 text-ink-300';

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}
        title={failover
          ? `Requested ${requestedEngine ? ENGINE_LABELS[requestedEngine] : 'auto'}, executed on ${ENGINE_LABELS[actualEngine]}.`
          : `Executed on ${ENGINE_LABELS[actualEngine]}.`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
        Ran on {ENGINE_LABELS[actualEngine]}
      </span>
      {failover && requestedEngine && requestedEngine !== actualEngine && (
        <span className="text-xs text-ink-500">
          requested {ENGINE_LABELS[requestedEngine]}
          {selectedExecutor && selectedExecutor !== requestedEngine && selectedExecutor !== actualEngine
            ? ` · routed to ${ENGINE_LABELS[selectedExecutor]}` : ''}
        </span>
      )}
      {failover && failoverReason && !compact && (
        <span className="basis-full text-xs text-ink-400 leading-relaxed">{failoverReason}</span>
      )}
    </span>
  );
}
