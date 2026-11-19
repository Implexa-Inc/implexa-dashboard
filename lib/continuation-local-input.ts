type LocalInputState = { ok: boolean; applicable?: boolean; required?: boolean; label?: string };
type RecoveryResult = { ok: boolean; recovered?: number; canceled?: boolean; error?: string };

type LocalInputRecoveryBridge = {
  localInputReauthorizationState?: (runId: string) => Promise<LocalInputState>;
  reauthorizeRunInputs?: (runId: string) => Promise<RecoveryResult>;
  onRunInputProgress?: (callback: (progress: { bytesRead?: number; totalBytes?: number }) => void) => (() => void);
};

export function localInputBridge(): LocalInputRecoveryBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { implexaDesktop?: LocalInputRecoveryBridge }).implexaDesktop || null;
}

export function localInputRecoveryMessage(error?: string) {
  if (error === 'input_digest_mismatch') return 'That is not the original file. Choose the exact original source to continue.';
  if (error === 'local_input_wrong_machine') return 'Reconnect this file on the Mac that created the run.';
  return 'Could not verify the original source. Try again.';
}

export async function verifyContinuationSource(
  runId: string,
  onPhase?: (phase: 'checking' | 'reconnecting') => void,
): Promise<RecoveryResult> {
  const bridge = localInputBridge();
  if (!bridge?.localInputReauthorizationState) return { ok: true };

  onPhase?.('checking');
  const state = await Promise.resolve()
    .then(() => bridge.localInputReauthorizationState!(runId))
    .catch(() => null);
  // Desktop can speak for its own missing source authority. Web and other
  // machines still use the request router to reach the owner Mac.
  if (!state?.ok || state.applicable !== true || state.required !== true) return { ok: true };
  if (!bridge.reauthorizeRunInputs) return { ok: false, error: 'local_input_reauthorization_unavailable' };

  onPhase?.('reconnecting');
  try {
    const restored = await bridge.reauthorizeRunInputs(runId);
    if (restored?.ok === false) return restored;
    if (restored?.ok && Number(restored.recovered) > 0) return restored;
  } catch {
    return { ok: false, error: 'local_input_reauthorization_unavailable' };
  }
  return { ok: false, error: 'local_input_reauthorization_unavailable' };
}
