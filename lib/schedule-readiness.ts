/**
 * Named bridge for the desktop-owned schedule-readiness check. Scheduling must
 * succeed independently of this UX: an old desktop or a normal browser cannot
 * turn a successful backend mutation into an error.
 */

export type ScheduleReadinessStatus = {
  status: 'ready' | 'action_required' | 'unsupported';
  reason?: string | null;
  summary?: string;
  onBattery?: boolean;
  acSleepMinutes?: number | null;
  acDisplaySleepMinutes?: number | null;
  screenMaySleep?: boolean;
  checkedAt?: string;
  prompted?: boolean;
  openedSettings?: boolean;
};

export type ScheduleReadinessBridge = {
  scheduleReadinessStatus?: () => Promise<ScheduleReadinessStatus>;
  ensureScheduleReadiness?: () => Promise<ScheduleReadinessStatus>;
  openSchedulePowerSettings?: () => Promise<{ ok: boolean; error?: string }>;
};

export function getScheduleReadinessBridge(): ScheduleReadinessBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { implexaDesktop?: ScheduleReadinessBridge }).implexaDesktop ?? null;
}

export async function ensureScheduleReadinessAfterSave(
  bridge: ScheduleReadinessBridge | null = getScheduleReadinessBridge(),
): Promise<ScheduleReadinessStatus | null> {
  if (!bridge?.ensureScheduleReadiness) return null;
  try {
    return await bridge.ensureScheduleReadiness();
  } catch {
    // The schedule itself already saved. Readiness UX must fail soft and remain
    // recoverable from the persistent Routines card.
    return null;
  }
}
