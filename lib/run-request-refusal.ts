/**
 * Typed refusals for a Review Room continuation retry.
 *
 * THE UX FAILURE THIS REPLACES (2026-08-11). A continuation died when Codex's
 * Computer Use probe returned state_unknown, and the retry was refused. All the
 * user saw was one grey sentence beside a text box:
 *
 *   "Implexa cannot safely verify that the previous revision process ended.
 *    This revision was not queued."
 *
 * That sentence is TRUE, and it was the correct refusal. It is also a dead end:
 * it reads identically to "it is still running", it offers nothing to do, and
 * the only affordance on screen — the note box — is the one thing that cannot
 * help. The user had already restarted ChatGPT/Codex; nothing told them that was
 * the right move, or that it was now worth trying again.
 *
 * So a refusal is modelled as three things the UI must be able to tell apart:
 *
 *   still_running  — something IS working. Wait; do not retry.
 *   unverifiable   — we cannot prove the previous process ended. NOT a failure
 *                    of nerve and NOT a "try again" — there is a specific action
 *                    (restart the executor, then retry) that produces the proof.
 *   terminal       — this revision is finished or was cancelled. Retrying is
 *                    the wrong question; start new work.
 *
 * plus `transient` for a service that is updating, and `unknown` for anything
 * unrecognised, which stays generic on purpose: a raw SQL or RPC message must
 * never become product copy.
 */

export type RefusalKind = 'still_running' | 'unverifiable' | 'terminal' | 'transient' | 'unknown';

export type RefusalAction =
  | { type: 'wait' }
  | { type: 'restart_executor_then_retry'; executorLabel: string }
  | { type: 'start_new_work' }
  | { type: 'none' };

export interface RunRequestRefusal {
  reason: string;
  kind: RefusalKind;
  /** One sentence stating what is true. Never speculative, never an apology. */
  message: string;
  /** What the user can do about it, if anything. */
  action: RefusalAction;
  /** The refused request, when the backend named it — the address recovery needs. */
  requestId: string | null;
  /** Whether an explicit recovery attempt is worth offering at all. */
  recoverable: boolean;
}

const COPY: Record<string, { kind: RefusalKind; message: string; action: RefusalAction }> = {
  review_continuation_still_running: {
    kind: 'still_running',
    message: 'The previous revision is still running. Nothing was queued — wait for it to finish.',
    action: { type: 'wait' },
  },
  review_continuation_live_state_unknown: {
    kind: 'unverifiable',
    // States the fact, then the one action that changes it. The old copy stopped
    // at the fact, which is why it read as a dead end.
    message: 'Implexa cannot yet verify that the previous revision process ended, so nothing was queued. '
      + 'Fully quit and reopen the executor — that lets Implexa confirm the old process is gone — then retry.',
    action: { type: 'restart_executor_then_retry', executorLabel: 'ChatGPT / Codex' },
  },
  review_continuation_not_terminal: {
    kind: 'still_running',
    message: 'The previous revision has not finished yet. Nothing was queued — wait for it to reach a safe state.',
    action: { type: 'wait' },
  },
  review_continuation_cancelled: {
    kind: 'terminal',
    message: 'That Review Room revision was cancelled and cannot be restarted. Submit a new revision from Review Room.',
    action: { type: 'start_new_work' },
  },
  review_submission_already_reported: {
    kind: 'terminal',
    message: 'That Review Room revision already finished. Start a new continuation for any further changes.',
    action: { type: 'start_new_work' },
  },
  review_submission_not_retryable: {
    kind: 'terminal',
    message: 'That Review Room revision is closed and cannot be retried. Start a new continuation for any further changes.',
    action: { type: 'start_new_work' },
  },
  review_submission_unavailable: {
    kind: 'terminal',
    message: 'The original review submission for this revision is no longer available. Submit a new revision from Review Room.',
    action: { type: 'start_new_work' },
  },
  review_retry_schema_unavailable: {
    kind: 'transient',
    message: 'Review Room retry is temporarily unavailable while the service updates. Try again shortly.',
    action: { type: 'none' },
  },
  review_continuation_context_changed: {
    kind: 'transient',
    message: 'Something else changed this revision while Implexa was queueing it. Nothing was queued — try again.',
    action: { type: 'none' },
  },
};

function refusalBody(error: unknown): { reason: string; requestId: string | null } | null {
  if (!error || typeof error !== 'object' || !('body' in error)) return null;
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object') return null;
  const raw = body as { reason?: unknown; requestId?: unknown };
  const reason = typeof raw.reason === 'string' ? raw.reason : '';
  if (!reason) return null;
  return { reason, requestId: typeof raw.requestId === 'string' ? raw.requestId : null };
}

/**
 * Classify a backend refusal. Returns null when the failure is not a typed
 * refusal at all — a transport error, an unparseable body — so the caller keeps
 * its own generic copy rather than inventing a diagnosis.
 */
export function classifyRunRequestRefusal(error: unknown): RunRequestRefusal | null {
  const parsed = refusalBody(error);
  if (!parsed) return null;
  const known = COPY[parsed.reason];
  if (!known) {
    return {
      reason: parsed.reason,
      kind: 'unknown',
      // Deliberately says nothing about WHY. An unrecognised reason string is
      // not something to paraphrase for a user.
      message: 'Implexa could not queue this revision. Nothing was started.',
      action: { type: 'none' },
      requestId: parsed.requestId,
      recoverable: false,
    };
  }
  return {
    reason: parsed.reason,
    kind: known.kind,
    message: known.message,
    action: known.action,
    requestId: parsed.requestId,
    // Only an unverifiable attempt has a recovery path, and only when the
    // backend named the request. Everything else is either live work or
    // finished work, and offering a button for those would be a lie.
    recoverable: known.kind === 'unverifiable' && !!parsed.requestId,
  };
}

/**
 * Translate a refusal into one honest sentence. Kept for the call sites that
 * only have room for a line of text; unknown failures stay generic, because raw
 * SQL/RPC messages must not become product UI.
 */
export function runRequestRefusalCopy(error: unknown, fallback: string): string {
  const classified = classifyRunRequestRefusal(error);
  if (!classified || classified.kind === 'unknown') return fallback;
  return classified.message;
}
