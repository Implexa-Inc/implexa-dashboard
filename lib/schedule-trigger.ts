/**
 * lib/schedule-trigger.ts — ONE home for what a scheduled_skills trigger means.
 *
 * WHY THIS FILE EXISTS (2026-07-20). Two dashboard types declared
 * `trigger_type?: 'cron' | 'watch' | 'until'` while the database has allowed
 * `('cron','watch','until','once','on_demand')` since migration 0073. TypeScript
 * was therefore asserting that `on_demand` COULD NOT EXIST — so no code was ever
 * forced to handle it, and the agent page happily offered a Pause button for
 * on-demand rows that can never fire. A type that under-describes reality is how
 * a UI lie gets past review.
 */

/** Exactly the values migration 0073 permits. Keep in step with the DB CHECK. */
export type TriggerType = 'cron' | 'watch' | 'until' | 'once' | 'on_demand';

type TriggerRow = {
  trigger_type?: string | null;
  cron_expression?: string | null;
  fire_at?: string | null;
};

/**
 * An `on_demand` row is an ACTIVATION ARTIFACT, not a routine: activation writes
 * one for every activated agent so the agent has a home row, with no clock, no
 * loop, and nothing that ever fires. It should never be presented as a schedule.
 */
export function isOnDemandRoutine(r: TriggerRow): boolean {
  return r.trigger_type === 'on_demand';
}

/**
 * Can the user meaningfully PAUSE this routine?
 *
 * Everything except on_demand is a real routine that runs by itself:
 *   • cron / once  → fired by the clock evaluator
 *   • watch / until → fired by a Claude /loop session, and they deliberately carry
 *     cron_expression = NULL (see _insertWorkflowWatchRoutine)
 *
 * That NULL is the trap. My first fix for the phantom-Pause bug required
 * `cron_expression || fire_at`, which hid Pause for ACTIVE watch/until routines —
 * a worse failure than the one it fixed, because those are genuinely running and
 * the user lost the only control that stops them. The honest rule is the narrow
 * one: only on_demand has nothing to pause.
 */
export function isPausableRoutine(r: TriggerRow): boolean {
  return !isOnDemandRoutine(r);
}
