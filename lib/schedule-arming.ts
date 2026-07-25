/**
 * lib/schedule-arming.ts — "will anything actually fire this schedule?"
 *
 * THE BUG THIS FILE EXISTS TO PREVENT (founder-hit, 2026-07-24). Home decided a
 * schedule was broken with `status === 'active' && !claude_task_id`. That was
 * right when every schedule was a NATIVE Claude routine armed through the
 * SessionStart reconcile. It stopped being right when the Implexa-owned scheduler
 * shipped: `scheduler_owner='implexa'` rows are fired by the BACKEND cron
 * evaluator and are deliberately never armed as native routines
 * (scheduled-skill.service: "implexa-owned fires via backend cron — never arm a
 * native routine"), so their `claude_task_id` is null permanently and BY DESIGN.
 *
 * The result was a Home row that was:
 *   • false     — "it hasn't started running yet" about a schedule firing fine,
 *   • misleading — "keep the Claude app open" is irrelevant to a backend fire, and
 *   • UNCLEARABLE — nothing the user could ever do would set that column.
 *
 * The mirror-image half was just as bad: gating "overdue" on `claude_task_id`
 * meant an implexa-owned schedule that genuinely STOPPED firing could never be
 * reported at all — a false all-clear on exactly the rows the backend now owns.
 *
 * Pure predicates, one home, so the two halves can never drift apart again.
 */

export type ArmingRow = {
  status: string;
  claude_task_id: string | null;
  /** 'implexa' = backend cron evaluator; anything else (incl. null) = native Claude routine. */
  scheduler_owner?: string | null;
};

/** The backend cron evaluator owns this row; there is no native routine to arm. */
export function isImplexaOwned(r: ArmingRow): boolean {
  return r.scheduler_owner === 'implexa';
}

/**
 * Something will actually fire this: an implexa-owned row (backend cron), or a
 * native routine that has been armed (has its Claude task id).
 */
export function isArmed(r: ArmingRow): boolean {
  return isImplexaOwned(r) || !!r.claude_task_id;
}

/**
 * Activated but NEVER ARMED — setup is genuinely incomplete and the user has a
 * real action to take. NATIVE ROUTINES ONLY: an implexa-owned row is never
 * "unarmed", it is fired by the backend.
 */
export function isNeverArmed(r: ArmingRow): boolean {
  return r.status === 'active' && !r.claude_task_id && !isImplexaOwned(r);
}
