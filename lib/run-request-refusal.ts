const COPY: Record<string, string> = {
  review_continuation_still_running:
    'The previous revision is still running or shutting down. Wait a moment, then try again.',
  review_continuation_live_state_unknown:
    'Implexa cannot safely verify that the previous revision process ended. This revision was not queued.',
  review_continuation_not_terminal:
    'The previous revision has not reached a safe retry state yet. Wait a moment, then try again.',
  review_continuation_cancelled:
    'That Review Room revision was cancelled and cannot be restarted. Submit a new revision from Review Room.',
  review_submission_already_reported:
    'That Review Room revision already finished. Start a new continuation for any additional changes.',
  review_retry_schema_unavailable:
    'Review Room retry is temporarily unavailable while the service updates. Try again shortly.',
};

/**
 * Translate the backend's typed retry refusal into an honest user action. Unknown
 * backend failures stay generic: raw SQL/RPC messages must not become product UI.
 */
export function runRequestRefusalCopy(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object' || !('body' in error)) return fallback;
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object') return fallback;
  const reason = typeof (body as { reason?: unknown }).reason === 'string'
    ? (body as { reason: string }).reason
    : '';
  return COPY[reason] || fallback;
}
