'use client';

/**
 * <ReviewContinuationRecovery /> — the recovery affordance for a Review Room
 * revision whose executor died before it did anything.
 *
 * WHAT WENT WRONG (2026-08-11). A revision's Codex process died on its mandatory
 * Computer Use probe (state_unknown), the retry was refused, and the whole of
 * the product's answer was one grey sentence next to a text box:
 *
 *   "Implexa cannot safely verify that the previous revision process ended.
 *    This revision was not queued."
 *
 * True, correct, and useless. It reads the same as "it is still running", it
 * names no action, and the only control on screen is a note field that cannot
 * possibly help. The user had ALREADY restarted ChatGPT/Codex — the exact thing
 * that would have produced the missing proof — and nothing told them so, or that
 * it was now worth trying again.
 *
 * This component says which of three situations is true, and offers only the
 * action that fits:
 *
 *   Still running    → wait. No retry button at all.
 *   Unable to verify → "Restart Codex, then retry". The restart is the user's;
 *                      the proof is the Desktop's; the retry is one click.
 *   Ready to retry   → retry now.
 *
 * TWO THINGS IT MUST NEVER DO, both of which the old surface got wrong by
 * omission:
 *
 *   • Show "Queued" optimistically. The queued state is set ONLY from a
 *     successful response, never from having clicked. A refused retry that
 *     rendered as queued would be the same lie the guard exists to prevent,
 *     moved into the UI.
 *   • Lose the user's note. A refusal keeps every character they typed in the
 *     surrounding composer; nothing here clears it.
 *
 * AND ONE MORE, ADDED FOR REV-COR04: the retry body carries NO note, structurally.
 * This endpoint re-queues the IMMUTABLE submitted round — the copy below promises
 * the feedback is "reused exactly as you submitted them" — so live composer text
 * riding along would resurrect a stale instruction into a round that claims to be
 * an exact replay. A surface composing a NEW instruction sends it on its own create
 * path; it never arrives here.
 */

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { classifyRunRequestRefusal, type RunRequestRefusal } from '@/lib/run-request-refusal';

export type RecoveryState = 'running' | 'unverifiable' | 'retryable' | 'queued' | 'cancelled' | 'not_review_retry';

interface RecoveryPayload {
  ok: boolean;
  state: RecoveryState;
  legacy?: boolean;
  attempt?: {
    launchAttemptId?: string;
    executor?: string | null;
    endedAt?: string;
    exitClassification?: string | null;
    consequentialWorkStarted?: boolean;
  } | null;
}

const EXECUTOR_LABEL: Record<string, string> = { codex: 'ChatGPT / Codex', claude: 'Claude' };

/** Present tense, no speculation, and visibly different per state. */
const HEADLINE: Record<RecoveryState, string> = {
  running: 'This revision is still running',
  unverifiable: 'Couldn’t verify the previous revision',
  retryable: 'Ready to retry',
  queued: 'Queued',
  cancelled: 'This revision was cancelled',
  not_review_retry: '',
};

export default function ReviewContinuationRecovery({
  requestId,
  refusal = null,
  onQueued,
}: {
  requestId: string;
  /** The typed refusal that brought the user here, if any. */
  refusal?: RunRequestRefusal | null;
  onQueued?: (result: { alreadyQueued: boolean; submissionId?: string }) => void;
}) {
  const [state, setState] = useState<RecoveryState | null>(null);
  const [detail, setDetail] = useState<RecoveryPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ONLY ever set from a successful response. This is the whole no-false-Queued
  // rule, and it is one variable so it cannot drift.
  const [queued, setQueued] = useState(false);
  // A primitive, so the effect's dependency is a value rather than an object
  // identity that changes on every parent render.
  const refusalKind = refusal?.kind ?? null;

  // The Supabase client is created INSIDE each call, and `load` depends only on
  // the request id. Holding `createClient()` in the component body and listing
  // it (or the refusal object) as an effect dependency gives a fresh identity on
  // every render, so the mount effect re-fires forever — a render loop that this
  // component, of all components, must not have: it is the surface a user
  // reaches when something has already gone wrong.
  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const result: RecoveryPayload = await callBackend(
        `/api/v2/me/run-requests/${encodeURIComponent(requestId)}/recovery-state`,
        { jwt: session?.access_token },
      );
      if (result && result.ok) { setState(result.state); setDetail(result); }
    } catch {
      // A failed read must not invent a state. Fall back to whatever the refusal
      // already told us, which is a fact we actually have.
      setState((prev) => prev ?? (refusalKind === 'unverifiable' ? 'unverifiable' : null));
    }
  }, [requestId, refusalKind]);

  useEffect(() => { load(); }, [load]);

  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const result = await callBackend(
        `/api/v2/me/run-requests/${encodeURIComponent(requestId)}/recover-review-continuation`,
        // NO NOTE, EVER (REV-COR04): this retries the immutable submitted round
        // exactly, so nothing composed since may ride along and contradict it.
        { jwt: session?.access_token, method: 'POST', body: {} },
      );
      // Queued is set HERE and nowhere else.
      setQueued(true);
      setState('queued');
      onQueued?.({
        alreadyQueued: result?.reviewRetry?.alreadyQueued === true,
        submissionId: result?.reviewRetry?.submissionId,
      });
    } catch (e) {
      const classified = classifyRunRequestRefusal(e);
      setError(classified ? classified.message : 'Implexa could not queue this revision. Nothing was started.');
      // Re-read rather than guess: the refusal may itself be the news that the
      // old attempt is now provably over, or newly running again.
      await load();
    } finally {
      setBusy(false);
    }
  }

  const resolved: RecoveryState | null = queued ? 'queued' : state;
  if (!resolved || resolved === 'not_review_retry') return null;

  const executorLabel = EXECUTOR_LABEL[detail?.attempt?.executor || ''] || 'ChatGPT / Codex';
  const tone = resolved === 'queued'
    ? 'border-success-600/40 bg-success-600/5'
    : resolved === 'running'
      ? 'border-ink-700 bg-ink-900/40'
      : 'border-amber-600/40 bg-amber-600/5';

  return (
    <div className={`mt-3 rounded-lg border p-4 ${tone}`} data-recovery-state={resolved}>
      <div className="text-sm font-semibold text-ink-100">{HEADLINE[resolved]}</div>

      {resolved === 'running' && (
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          A revision process is working on this feedback right now. Nothing new was queued.
          This page updates when it finishes.
        </p>
      )}

      {resolved === 'unverifiable' && (
        <>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            If the revisions were not applied in the previous run, you can retry this revision.
          </p>
          <ol className="mt-3 space-y-1.5 text-xs text-ink-300">
            <li>
              <span className="text-ink-500 mr-1.5">1.</span>
              Fully quit <span className="text-ink-100">{executorLabel}</span> and open it again.
              Implexa Desktop then confirms the old process is gone.
            </li>
            <li>
              <span className="text-ink-500 mr-1.5">2.</span>
              Come back here and retry. Your feedback, files and marked-up frames are reused
              exactly as you submitted them — you don’t re-enter anything.
            </li>
          </ol>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={retry}
              disabled={busy}
              className="btn-success text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Retry revision'}
            </button>
            <button
              type="button"
              onClick={load}
              disabled={busy}
              className="btn-outline text-xs px-3 py-1.5 disabled:opacity-50"
            >
              Check again
            </button>
          </div>
        </>
      )}

      {resolved === 'retryable' && (
        <>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            The previous attempt is confirmed finished
            {detail?.attempt?.consequentialWorkStarted === false ? ' and made no edits' : ''}.
            Retrying reuses your original review exactly — same feedback, same marked-up frames.
          </p>
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            className="btn-success mt-3 text-xs px-3 py-1.5 disabled:opacity-50"
          >
            {busy ? 'Queuing…' : 'Retry revision'}
          </button>
        </>
      )}

      {resolved === 'cancelled' && (
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          Cancelling is final. Submit a new revision from Review Room when you’re ready.
        </p>
      )}

      {resolved === 'queued' && (
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          Queued with your original review submission. The updated result lands in your inbox.
        </p>
      )}

      {/* The refusal that brought the user here stays visible while it is still
          the newest thing we know, so the panel never silently replaces a
          specific answer with a general one. */}
      {(error || (refusal && resolved !== 'queued' && !error)) && (
        <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error || refusal?.message}</p>
      )}
    </div>
  );
}
