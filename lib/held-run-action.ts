// held-run-action.ts — the structured decision for a run held by Implexa.
//
// `review_status='pending'` alone is insufficient: it has historically represented
// both a finished, deliver-only draft and an approval gate before remaining agent
// work. Markdown is evidence for the legacy case only; the run's canonical
// `steps_state` decides whenever it is available.

import type { RunStep } from './run-state';

export type HeldRunPrimaryAction = 'answer' | 'continue' | 'approve_finish' | 'mark_done';

export function hasRemainingRunWork(stepsState: RunStep[] | null | undefined): boolean {
  return Array.isArray(stepsState)
    && stepsState.some((step) => step.status === 'pending' || step.status === 'running');
}

export function deriveHeldRunPrimaryAction({
  reviewStatus,
  holdKind,
  stepsState,
  hasDeferredWorkSignal,
}: {
  reviewStatus: 'pending' | 'needs_input';
  holdKind?: 'approval_before_action' | 'review_delivered_result' | 'needs_input' | null;
  stepsState?: RunStep[] | null;
  /** Legacy fallback for runs that predate the structured checklist. */
  hasDeferredWorkSignal: boolean;
}): HeldRunPrimaryAction {
  // The persisted contract wins. A plan may end at the gate (as the video audit
  // did), so an all-done checklist is not proof that no more work is authorized.
  if (holdKind === 'approval_before_action') return 'continue';
  if (holdKind === 'review_delivered_result') return 'mark_done';
  if (holdKind === 'needs_input') return 'answer';

  // Compatibility only for rows written before migration 0139.
  if (reviewStatus === 'needs_input') return 'answer';
  if (hasRemainingRunWork(stepsState)) return 'continue';
  if (hasDeferredWorkSignal) return 'approve_finish';
  return 'mark_done';
}
