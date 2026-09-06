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
 *   Complete         → open the result. No retry, because there is nothing to
 *                      retry — see below.
 *
 * THE FOURTH STATE, AND WHY IT WAS MISSING (2026-08-23). This panel had no way to
 * say a revision FINISHED. The backend read fell through to "an attempt that
 * ended" and answered `retryable`, so a continuation that had delivered nine
 * artifacts and a final MP4 rendered as "Ready to retry — the previous attempt is
 * confirmed finished". Every word of that was technically true about the PROCESS
 * and completely wrong about the WORK, and the button under it would have paid to
 * do the whole revision again. An attempt ending is evidence about a process; a
 * request closing is not proof of delivery. Only independently recorded delivery
 * evidence can make this surface report a revised result.
 *
 * TWO THINGS IT MUST NEVER DO, both of which the old surface got wrong by
 * omission:
 *
 *   • Show "Queued" optimistically. The queued state is set ONLY from a
 *     successful response, never from having clicked. A refused retry that
 *     rendered as queued would be the same lie the guard exists to prevent,
 *     moved into the UI.
 *   • Lose the user's note. A refusal keeps every character they typed; the
 *     note field is never cleared except on a real success.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { classifyRunRequestRefusal, type RunRequestRefusal } from '@/lib/run-request-refusal';

export type RecoveryState = 'running' | 'unverifiable' | 'retryable' | 'queued' | 'cancelled' | 'settling' | 'completed' | 'not_review_retry';

interface RecoveryPayload {
  ok: boolean;
  state: RecoveryState;
  reason?: string | null;
  legacy?: boolean;
  /** Set on `completed`: the CHILD run that carries the revised deliverable. */
  runId?: string | null;
  completedAt?: string | null;
  deliveryVerified?: boolean;
  artifactId?: string | null;
  failureReason?: string | null;
  executorDiagnostic?: { source: 'executor_message'; finalMessage: string; truncated: boolean } | null;
  attempt?: {
    launchAttemptId?: string;
    executor?: string | null;
    endedAt?: string;
    exitClassification?: string | null;
    consequentialWorkStarted?: boolean;
    terminalOutcome?: string | null;
    ackDeadline?: string | null;
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
  completed: 'This revision is complete',
  settling: 'Revised delivery is not yet verified',
  not_review_retry: '',
};

// One read at the proof boundary, then three bounded retries for a delayed
// expiry sweep or transient transport failure. Manual refresh remains available
// after this budget; an open Review tab must never poll forever.
const LAUNCH_WINDOW_REFRESH_RETRIES_MS = [1_000, 3_000, 10_000] as const;

export default function ReviewContinuationRecovery({
  requestId,
  refusal = null,
  note = '',
  onQueued,
  onCompleted,
  onAmendCancelled,
  onAnswer,
}: {
  requestId: string;
  /** The typed refusal that brought the user here, if any. */
  refusal?: RunRequestRefusal | null;
  /** The user's feedback, carried through so a retry never asks for it again. */
  note?: string;
  onQueued?: (result: { alreadyQueued: boolean; submissionId?: string }) => void;
  onAmendCancelled?: () => void | Promise<void>;
  onAnswer?: () => void | Promise<void>;
  /**
   * The revision FINISHED. Told to the parent so the surrounding screen can stop
   * claiming a revision is queued — a panel that quietly knows better while the
   * block around it says "Revision queued" is two answers on one screen.
   */
  onCompleted?: (result: { runId: string | null; completedAt: string | null }) => void;
}) {
  const [state, setState] = useState<RecoveryState | null>(null);
  const [detail, setDetail] = useState<RecoveryPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const answerFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const amendmentFlight = useRef(false);
  // ONLY ever set from a successful response. This is the whole no-false-Queued
  // rule, and it is one variable so it cannot drift.
  const [queued, setQueued] = useState(false);
  // A primitive, so the effect's dependency is a value rather than an object
  // identity that changes on every parent render.
  const refusalKind = refusal?.kind ?? null;
  // Held in a ref so a parent that re-creates the callback on every render cannot
  // re-fire the mount effect. This panel, of all panels, must not render-loop: it
  // is what a user reaches when something has already gone wrong.
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);

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
      if (result && result.ok) {
        // Old servers reported completion from request closure alone. Do not let
        // that response hide recovery or notify the parent of invented delivery.
        const verified = result.deliveryVerified === true && !!result.runId && !!result.artifactId;
        setState(result.state === 'completed' && !verified ? 'settling' : result.state);
        setDetail(result);
        if (result.state === 'completed' && verified) {
          onCompletedRef.current?.({ runId: result.runId || null, completedAt: result.completedAt || null });
        }
      }
    } catch {
      // A failed read must not invent a state. Fall back to whatever the refusal
      // already told us, which is a fact we actually have.
      setState((prev) => prev ?? (refusalKind === 'unverifiable' ? 'unverifiable' : null));
    }
  }, [requestId, refusalKind]);

  useEffect(() => { load(); }, [load]);

  // A claimed request can fail locally before an executor exists while its
  // bounded process-start lease is still open. The server correctly withholds
  // retry until that deadline; refresh automatically when the proof boundary
  // arrives so the user never has to guess when the same button will work.
  const ackDeadline = detail?.attempt?.ackDeadline || null;
  useEffect(() => {
    if (state !== 'running' || !ackDeadline) return undefined;
    const deadlineMs = Date.parse(ackDeadline);
    if (!Number.isFinite(deadlineMs)) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;
    const schedule = (delay: number) => {
      timer = setTimeout(async () => {
        await load();
        // A transient read failure or a delayed server sweep must not strand
        // the card. Retry with a finite backoff; React's effect cleanup flips
        // this before rescheduling once the response leaves the window state.
        const nextDelay = LAUNCH_WINDOW_REFRESH_RETRIES_MS[retry];
        retry += 1;
        if (!stopped && nextDelay != null) schedule(nextDelay);
      }, delay);
    };
    // Do not cap this to an earlier time: a future deadline is proof that retry
    // is unsafe until that exact boundary. Node/browser timers support roughly
    // 24 days, far beyond the server's bounded process-start lease.
    schedule(Math.max(250, Math.min(2_147_000_000, deadlineMs - Date.now() + 250)));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [state, ackDeadline, load]);

  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const result = await callBackend(
        `/api/v2/me/run-requests/${encodeURIComponent(requestId)}/recover-review-continuation`,
        { jwt: session?.access_token, method: 'POST', body: { note: note || undefined } },
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
  const launchWindowOpen = resolved === 'running'
    && detail?.reason === 'review_continuation_launch_window_open';
  const headline = launchWindowOpen ? 'Confirming the previous revision' : HEADLINE[resolved];

  const executorLabel = EXECUTOR_LABEL[detail?.attempt?.executor || ''] || 'ChatGPT / Codex';
  const tone = resolved === 'queued' || resolved === 'completed'
    ? 'border-success-600/40 bg-success-600/5'
    : resolved === 'running'
      ? 'border-ink-700 bg-ink-900/40'
      : 'border-amber-600/40 bg-amber-600/5';

  return (
    <div className={`mt-3 rounded-lg border p-4 ${tone}`} data-recovery-state={resolved}>
      <div className="text-sm font-semibold text-ink-100">{headline}</div>
      {['running', 'queued', 'retryable', 'settling'].includes(resolved) && (
        <button type="button" onClick={() => void load()} disabled={busy}
          className="btn-outline mt-2 text-xs px-3 py-1.5">Refresh attempt details</button>
      )}
      {detail?.executorDiagnostic?.source === 'executor_message'
        && typeof detail.executorDiagnostic.finalMessage === 'string'
        && ['retryable', 'settling', 'cancelled', 'unverifiable'].includes(resolved) && (
        <div className="mt-3 rounded border border-ink-700 p-3" aria-label="Executor message">
          <p className="text-xs font-semibold text-ink-200">Message from the previous executor</p>
          <blockquote className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-200">
            {Array.from(detail.executorDiagnostic.finalMessage).slice(0, 4000).join('')}
          </blockquote>
          {detail.executorDiagnostic.truncated && <p className="mt-1 text-xs text-ink-400">Message shortened.</p>}
          <p className="mt-2 text-xs text-ink-400">
            This message does not verify that the requested edits were completed.
            If it asks a question, answer in a new feedback draft. Your previous submission stays unchanged.
          </p>
          {onAnswer && <button type="button" onClick={async () => {
            if (answerFlightRef.current) return;
            answerFlightRef.current = true;
            setAnswerBusy(true);
            try { await onAnswer(); } finally { answerFlightRef.current = false; setAnswerBusy(false); }
          }} disabled={busy || answerBusy}
            className="btn-outline mt-2 text-xs px-3 py-1.5">{answerBusy ? 'Opening Review…' : 'Answer in Review'}</button>}
        </div>
      )}

      {resolved === 'running' && (
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          {launchWindowOpen
            ? 'Implexa is confirming whether the previous revision started. Nothing new was queued. Retry will become available automatically when this safety window closes.'
            : 'A revision process is working on this feedback right now. Nothing new was queued. Refresh attempt details to check for its result or latest message.'}
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

      {resolved === 'settling' && (
        <>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            Implexa has not confirmed a validated revised result.
            This does not mean your feedback was applied. No new attempt has been queued.
          </p>
          <button type="button" onClick={load} disabled={busy} className="btn-outline mt-3 text-xs px-3 py-1.5">
            Check again
          </button>
        </>
      )}

      {resolved === 'completed' && (
        <>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            A validated revised result is available. Open it to inspect the corrections;
            Judge and Manager proof are reported separately.
          </p>
          {detail?.runId ? (
            <a
              href={`/review/${encodeURIComponent(detail.runId)}`}
              className="btn-success mt-3 inline-block text-xs px-3 py-1.5"
            >
              Open the revised result
            </a>
          ) : null}
        </>
      )}

      {resolved === 'cancelled' && (
        <>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            This attempt is closed. You can carry its submitted feedback into a new draft.
            Sending that draft starts a new revision.
          </p>
          {onAmendCancelled && <button type="button" disabled={busy}
            onClick={async () => {
              if (amendmentFlight.current) return;
              amendmentFlight.current = true;
              setBusy(true); setError(null);
              try { await onAmendCancelled(); }
              catch { setError('Could not open the draft. Your submitted feedback is unchanged.'); }
              finally { amendmentFlight.current = false; setBusy(false); }
            }} className="btn-outline mt-3 text-xs px-3 py-1.5">
            {busy ? 'Opening draft…' : 'Open a new draft with this feedback'}
          </button>}
        </>
      )}

      {resolved === 'queued' && (
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          Queued with your original review submission. The updated result lands in your inbox.
        </p>
      )}

      {/* The refusal that brought the user here stays visible while it is still
          the newest thing we know, so the panel never silently replaces a
          specific answer with a general one. */}
      {(error || (refusal && resolved !== 'queued' && resolved !== 'completed' && !error)) && (
        <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error || refusal?.message}</p>
      )}
    </div>
  );
}
