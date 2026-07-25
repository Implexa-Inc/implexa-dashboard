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

/**
 * The state a recurring <SchedulePicker> should OPEN with when editing an
 * existing routine — parsed from its stored `cron_expression`, so the editor
 * reflects the real schedule instead of a hard-coded 09:00/daily default (the
 * "shows 9am while the agent runs at noon" bug). Deliberately handles ONLY the
 * cron shapes the picker itself emits (see buildNl in activation-card):
 *   0 H * * *     → every day at H
 *   0 H * * 1-5   → every weekday at H
 *   0 H * * D     → weekly on day D at H   (0=Sun … 6=Sat)
 *   0 * * * *     → every hour
 * Anything else (a hand-written cron the picker can't represent) returns null,
 * and the caller falls back to the plain defaults — editing still works, it just
 * isn't pre-filled, which is strictly better than showing a WRONG pre-fill.
 */
export type PickerState = { freq: 'day' | 'weekday' | 'week' | 'hour'; time: string; weekday: number };

export function cronToPickerState(cron: string | null | undefined): PickerState | null {
  if (!cron || typeof cron !== 'string') return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [min, hr, dom, mon, dow] = parts;
  // Only the picker's own shapes: minute-of-hour fixed, day-of-month + month wild.
  if (dom !== '*' || mon !== '*') return null;
  // Hourly: minute wild (or 0) with a wild hour — the picker has no minute control.
  if (hr === '*') return { freq: 'hour', time: '09:00', weekday: 1 };
  const h = Number(hr);
  const m = Number(min);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) return null;
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (dow === '1-5') return { freq: 'weekday', time, weekday: 1 };
  if (/^[0-6]$/.test(dow)) return { freq: 'week', time, weekday: Number(dow) };
  if (dow === '*') return { freq: 'day', time, weekday: 1 };
  return null; // a dow list/range the picker can't express
}
