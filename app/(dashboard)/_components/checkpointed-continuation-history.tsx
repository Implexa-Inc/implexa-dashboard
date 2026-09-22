export type CheckpointedContinuationItem = {
  checkpointId: string;
  checkpointDigest: string;
  intentId: string;
  requestId: string;
  sourceAttemptId: string;
  sourceFence: number;
  continuationAttemptId: string | null;
  continuationFence: number;
  continuationNumber: number;
  lastCompletedStage: number;
  nextStage: number;
  materializationState: 'verified' | 'refused' | 'pending';
  attemptLifecycleState: 'process_ended' | 'process_started' | 'ended_before_process_start' | 'attempt_opened' | 'pending_attempt';
  materializationDigest: string | null;
  attemptExitClassification: string | null;
};

export type CheckpointedContinuationHistory =
  | { status: 'available'; items: CheckpointedContinuationItem[] }
  | { status: 'unavailable'; reason: string };

const short = (value: string | null) => value ? `${value.slice(0, 8)}…` : 'pending';
const materializationState = (value: CheckpointedContinuationItem['materializationState']) => ({
  verified: 'Preserved files verified',
  refused: 'Preserved-file verification refused',
  pending: 'Preserved-file verification pending',
}[value]);
const attemptState = (value: CheckpointedContinuationItem['attemptLifecycleState']) => ({
  process_ended: 'Continuation process ended',
  process_started: 'Continuation process started',
  ended_before_process_start: 'Continuation ended before process start',
  attempt_opened: 'Continuation attempt opened',
  pending_attempt: 'Waiting for the continuation attempt',
}[value]);

export default function CheckpointedContinuationHistoryCard({ history }:
  { history: CheckpointedContinuationHistory }) {
  if (history.status === 'available' && history.items.length === 0) return null;
  if (history.status === 'unavailable') {
    return <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <p className="text-sm font-medium text-ink-100">Continuation history could not be checked</p>
      <p className="mt-1 text-xs text-ink-400">The run itself is unchanged. Refresh to check its preserved-work history again.</p>
    </div>;
  }
  return <section className="mb-6 rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-4" aria-label="Checkpointed continuation history">
    <h2 className="text-sm font-semibold text-ink-100">Preserved-work continuations</h2>
    <p className="mt-1 text-xs text-ink-400">Technical continuations resume automatically; they do not need your input. This shows durable attempt state; Desktop verifies preserved files locally before launch.</p>
    <ol className="mt-3 space-y-3">
      {history.items.map((item) => <li key={item.intentId} className="rounded-md border border-ink-800 bg-ink-950/40 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-300">
          <span className="font-medium text-ink-100">Continuation {item.continuationNumber}</span>
          <span>step {item.lastCompletedStage} → {item.nextStage}</span>
          <span>{materializationState(item.materializationState)}</span>
          <span>{attemptState(item.attemptLifecycleState)}</span>
        </div>
        <div className="mt-2 grid gap-1 font-mono text-[11px] text-ink-500 sm:grid-cols-2">
          <span title={item.checkpointDigest}>checkpoint {short(item.checkpointId)}</span>
          <span title={item.requestId}>request {short(item.requestId)}</span>
          <span>fence {item.sourceFence} → {item.continuationFence}</span>
          <span title={item.sourceAttemptId}>source {short(item.sourceAttemptId)}</span>
          <span title={item.continuationAttemptId || undefined}>continuation {short(item.continuationAttemptId)}</span>
          {item.materializationDigest && <span title={item.materializationDigest}>materialization {short(item.materializationDigest)}</span>}
        </div>
        {item.attemptExitClassification && <p className="mt-2 text-amber-700 dark:text-amber-300">Attempt exit: {item.attemptExitClassification}</p>}
      </li>)}
    </ol>
  </section>;
}
