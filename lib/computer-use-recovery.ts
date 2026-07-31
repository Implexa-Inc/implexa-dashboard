/**
 * lib/computer-use-recovery.ts — the Computer Use repair affordances
 * (COMPUTER_USE_HEALTH_AND_RECOVERY_SPEC_2026-07-30 Sec.5).
 *
 * THIS MODULE DOES NOT IMPLEMENT THE DESKTOP IPC, and does not pretend it exists.
 *
 * The spec's Desktop A ships the health/restart bridge; this surface is Backend B's
 * side of it, which must "feature-detect older desktop versions" (Sec.15). So every
 * action here is *detected* on `window.implexaDesktop` and returns a disabled
 * affordance with an honest reason when the bridge is absent. A button that looks
 * live and silently no-ops is worse than one that says the app needs updating —
 * the user would conclude the restart failed rather than that it never ran.
 *
 * These are OPERATIONAL recovery actions. They are deliberately NOT review issues
 * and must never be rendered as review work (spec Sec.2): an agent whose screen
 * capture died has not delivered a result the user should judge.
 */

export type RecoveryCause =
  | 'helper_unhealthy'
  | 'permission_missing'
  | 'target_app_unavailable'
  | 'unknown';

export type RecoveryActionKind = 'restart_control' | 'open_permissions' | 'try_another_engine';

export type RecoveryAction = {
  kind: RecoveryActionKind;
  label: string;
  /** Primary for this cause (spec Sec.5.1)? */
  primary: boolean;
  enabled: boolean;
  /** Why it is unavailable — shown instead of a dead button. */
  disabledReason: string | null;
};

type Bridge = {
  computerUseRestart?: () => Promise<unknown>;
  computerUseCheck?: () => Promise<unknown>;
  computerUseOpenPermissions?: () => Promise<unknown>;
};
type WindowWithBridge = Window & { implexaDesktop?: Bridge };

function bridge(win?: unknown): Bridge | undefined {
  const w = (win ?? (typeof window !== 'undefined' ? window : undefined)) as WindowWithBridge | undefined;
  return w?.implexaDesktop;
}

/** Does this desktop build expose the health/restart IPC at all? */
export function recoverySupported(win?: unknown): boolean {
  const b = bridge(win);
  return typeof b?.computerUseRestart === 'function' || typeof b?.computerUseCheck === 'function';
}

export const UPDATE_REQUIRED = 'Update Implexa to repair computer control from here.';
const BROWSER_ONLY = 'Computer control can only be repaired from the Implexa desktop app.';

/**
 * The affordances for a cause, in the spec's priority order.
 *
 * "Try another engine" is the one action that does NOT need the desktop bridge — it is
 * a routing choice the backend owns — so it stays enabled even on an old build. That
 * asymmetry is the point: the user keeps a way forward when repair is unavailable.
 */
export function recoveryActions(cause: RecoveryCause, opts: {
  inDesktop: boolean;
  supported: boolean;
  alternateEngineReady?: boolean;
}): RecoveryAction[] {
  const { inDesktop, supported, alternateEngineReady = false } = opts;
  const reason = !inDesktop ? BROWSER_ONLY : (!supported ? UPDATE_REQUIRED : null);
  const bridged = (kind: RecoveryActionKind, label: string, primary: boolean): RecoveryAction => ({
    kind, label, primary, enabled: reason === null, disabledReason: reason,
  });

  const actions: RecoveryAction[] = [
    bridged('restart_control', 'Restart computer control', cause === 'helper_unhealthy'),
    bridged('open_permissions', 'Open permissions', cause === 'permission_missing'),
    {
      kind: 'try_another_engine',
      label: 'Try another engine',
      primary: cause === 'target_app_unavailable',
      // Routing, not a local repair — available even when the desktop cannot help.
      enabled: alternateEngineReady,
      disabledReason: alternateEngineReady ? null : 'No other engine is ready right now.',
    },
  ];
  // Primary first, then the spec's listed order.
  return actions.sort((a, b) => Number(b.primary) - Number(a.primary));
}

/**
 * Invoke a repair. Returns a discriminated result — never throws, and never reports
 * success it did not observe.
 *
 * `unsupported` is distinct from `failed`: the first means this build has no such
 * capability (so the fix is updating the app), the second means we asked and it did
 * not work (so the fix is something else). Collapsing them sends the user to the
 * wrong remedy.
 */
export async function runRecovery(kind: RecoveryActionKind, win?: unknown): Promise<
  { status: 'ok' } | { status: 'unsupported' } | { status: 'failed'; error: string }
> {
  const b = bridge(win);
  const fn = kind === 'restart_control' ? b?.computerUseRestart
    : kind === 'open_permissions' ? b?.computerUseOpenPermissions
    : undefined;
  if (typeof fn !== 'function') return { status: 'unsupported' };
  try {
    const res = (await fn()) as { ok?: boolean; error?: string } | undefined;
    // An explicit ok:false is a real refusal; anything else that returned is treated
    // as done, because the desktop owns the outcome and we must not invent one.
    if (res && res.ok === false) return { status: 'failed', error: String(res.error || 'The desktop could not complete that.') };
    return { status: 'ok' };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : 'The desktop could not complete that.' };
  }
}

/**
 * One collapsed sentence (spec Sec.5.1: "Technical detail is collapsed"), and never a
 * suggestion to download or repair an external artifact when no provider job was
 * submitted.
 */
export function recoverySummary(cause: RecoveryCause): string {
  switch (cause) {
    case 'helper_unhealthy':
      return 'Computer Use screen capture stopped responding.';
    case 'permission_missing':
      return 'Implexa is missing a macOS permission it needs to control this computer.';
    case 'target_app_unavailable':
      return 'The app this agent needs to control is not available right now.';
    default:
      return 'Computer control is not working right now.';
  }
}
