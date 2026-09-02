'use client';

/**
 * <RunActions /> — the ONE action surface for a held run, replacing the old pile
 * of ~10 controls (Approve & finish, continue-in-Claude, Open-Routines, Mark as
 * done, the always-open changes box, Hide-from-alerts, Dismiss-approval, the
 * explainer banner). The founder counted them and asked for the bare minimum.
 *
 * Three intents, three controls:
 *   • PRIMARY (context-aware): the agent has a deferred ship step (post/publish/
 *     render) → "Approve & finish" (queues a kind='continue' so the drainer ships
 *     it hands-off). No ship step (a draft you use yourself) → "Mark as done"
 *     (just closes it, no run). A needs-input run → the changes box IS the primary
 *     ("Send & continue"), since there's nothing to approve.
 *   • SECONDARY: "Request changes" → reveals the note + attach inline (only when
 *     asked for), then Continue & re-run (kind='continue' with the note).
 *   • QUIET: "Dismiss" (close without acting) + a "⋯ More" disclosure for the
 *     power-user escape hatches (continue live in Claude, open the routine).
 *
 * All API calls are the SAME ones the old components used — this is consolidation,
 * not new behavior: approve = run-requests{kind:continue}; mark done / dismiss =
 * /runs/:id/review{approved|dismissed}; changes = run-requests{kind:continue,note}.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { runRequestRefusalCopy, classifyRunRequestRefusal, type RunRequestRefusal } from '@/lib/run-request-refusal';
import ReviewContinuationRecovery from './review-continuation-recovery';
import { AttachFiles, composeNoteWithFiles, useRunAttachments } from './run-attachments';
import { deriveHeldRunPrimaryAction } from '@/lib/held-run-action';
import type { RunStep } from '@/lib/run-state';

const CLAUDE_CODE_MAX = 13000;
type LocalInputRecoveryBridge = {
  localInputReauthorizationState?: (runId: string) => Promise<{ ok: boolean; applicable?: boolean; required?: boolean; label?: string }>;
  reauthorizeRunInputs?: (runId: string) => Promise<{ ok: boolean; recovered?: number; canceled?: boolean; error?: string }>;
  onRunInputProgress?: (cb: (progress: { bytesRead?: number; totalBytes?: number }) => void) => (() => void);
};

function localInputBridge(): LocalInputRecoveryBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { implexaDesktop?: LocalInputRecoveryBridge }).implexaDesktop || null;
}

export default function RunActions({
  runId,
  agentName,
  reviewStatus,
  holdKind,
  hasShipStep,
  stepsState,
  claudeTaskId,
  skillSlug,
  approvalRecovery = false,
}: {
  runId: string;
  agentName: string;
  /** 'pending' = approve-ready hold · 'needs_input' = blocked on a question. */
  reviewStatus: 'pending' | 'needs_input';
  /** Persisted backend contract for what this hold authorizes; absent for legacy runs. */
  holdKind?: 'approval_before_action' | 'review_delivered_result' | 'needs_input' | null;
  /** Approving triggers a consequential step (post/publish/render) vs deliver-only. */
  hasShipStep: boolean;
  /** Canonical checklist. Any pending/running step means approval resumes agent work. */
  stepsState?: RunStep[] | null;
  claudeTaskId?: string | null;
  /** The agent's slug — enables the "also edit the agent for future runs" opt-in
   *  on the changes box (a permanent revise alongside the one-off continue). */
  skillSlug?: string | null;
  /** Historical brokered approval hold; requests the server-owned no-redo continuation. */
  approvalRecovery?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const needsInput = reviewStatus === 'needs_input';
  const primaryAction = deriveHeldRunPrimaryAction({
    reviewStatus,
    holdKind,
    stepsState,
    hasDeferredWorkSignal: hasShipStep,
  });
  const resumesWork = primaryAction === 'continue' || primaryAction === 'approve_finish';
  // Opt-in: bake the requested change into the agent (kind='revise') so it holds
  // for every future run, not just this re-run. Default off.
  const [editAgent, setEditAgent] = useState(false);

  // needs-input runs open the changes box by default (it IS the action); a normal
  // approve-ready hold keeps it collapsed behind "Request changes".
  const [showChanges, setShowChanges] = useState(needsInput);
  const [showMore, setShowMore] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);
  const [err, setErr] = useState<string | null>(null);
  // A Review Room revision that could not be queued is a STATE with an action,
  // not an error string. Keeping the typed refusal is what lets the recovery
  // panel offer "restart Codex, then retry" instead of a dead end.
  const [refusal, setRefusal] = useState<RunRequestRefusal | null>(null);
  const [note, setNote] = useState('');
  const [localRecovery, setLocalRecovery] = useState<'checking' | 'required' | 'verified' | 'ready' | 'unavailable'>(
    needsInput ? 'checking' : 'unavailable',
  );
  const [localRecoveryLabel, setLocalRecoveryLabel] = useState('original local file');
  const [verificationPercent, setVerificationPercent] = useState<number | null>(null);
  const { files, canAttach, canAttachFolder, attachFile, attachFolder, removeFile, error: attachError } = useRunAttachments();

  useEffect(() => {
    if (!needsInput) return;
    let live = true;
    const bridge = localInputBridge();
    if (!bridge?.localInputReauthorizationState) { setLocalRecovery('unavailable'); return; }
    bridge.localInputReauthorizationState(runId).then((result) => {
      if (!live) return;
      if (result.ok && result.applicable && result.required) {
        setLocalRecoveryLabel(result.label || 'original local file'); setLocalRecovery('required');
      } else if (result.ok && result.applicable) setLocalRecovery('ready');
      else setLocalRecovery('unavailable');
    }).catch(() => { if (live) setLocalRecovery('unavailable'); });
    return () => { live = false; };
  }, [needsInput, runId]);

  async function jwt() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  // PRIMARY for a ship agent: approve + let the drainer finish/ship hands-off.
  async function approveFinish() {
    if (busy) return;
    setBusy('approve'); setErr(null);
    try {
      await callBackend('/api/v2/me/run-requests', {
        jwt: await jwt(), method: 'POST',
        body: {
          kind: 'continue', runId, source: 'dashboard',
          ...(approvalRecovery ? { approvalRecovery: true } : {}),
        },
      });
      // Land the user on Active Agents so they SEE the new task spin up (parity
      // with Run-now) instead of a static "done" line they have to interpret.
      router.push('/workflows'); router.refresh();
    } catch {
      setErr('Could not approve. Try again.');
      setBusy(null);
    }
  }

  // PRIMARY for a deliver-only agent (or "Mark done" in More): just close it.
  async function markDone() {
    if (busy) return;
    setBusy('done'); setErr(null);
    try {
      await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/review`, {
        jwt: await jwt(), method: 'POST', body: { status: 'approved' },
      });
      router.push('/work'); router.refresh();
    } catch {
      setErr('Could not close it. Try again.'); setBusy(null);
    }
  }

  // SECONDARY: continue with the user's changes / missing inputs.
  async function continueWithChanges() {
    const composed = composeNoteWithFiles(note, files);
    if (busy || (!note.trim() && files.length === 0)) return;
    setBusy('changes'); setErr(null); setRefusal(null);
    try {
      await callBackend('/api/v2/me/run-requests', {
        jwt: await jwt(), method: 'POST',
        body: { kind: 'continue', runId, note: composed, source: 'dashboard' },
      });
      // Opt-in: also bake the change into the agent (kind='revise') so future runs
      // do it too, not just this re-run. Best-effort — the continue is already
      // queued, so a revise hiccup never loses the re-run.
      if (editAgent && skillSlug && note.trim()) {
        try {
          await fetch('/api/agents/revise', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slug: skillSlug, note: note.trim() }),
          });
        } catch { /* continue queued; the edit can be retried from "Edit this agent" */ }
      }
      // Land on Active Agents so the new run's loader is visible (parity with Run).
      router.push('/workflows'); router.refresh();
    } catch (error) {
      const classified = classifyRunRequestRefusal(error);
      // Hand a recoverable refusal to the panel, which owns both the copy and
      // the action. The note stays in state untouched — a refusal must never
      // cost the user their feedback.
      if (classified?.recoverable) { setRefusal(classified); setErr(null); setBusy(null); return; }
      setErr(runRequestRefusalCopy(error, 'Could not queue the changes. Try again.')); setBusy(null);
    }
  }

  async function reconnectAndContinue() {
    if (busy) return;
    const bridge = localInputBridge();
    if (!bridge?.reauthorizeRunInputs) return;
    setBusy('reconnect'); setErr(null); setRefusal(null); setVerificationPercent(null);
    const unsubscribe = bridge.onRunInputProgress?.((progress) => {
      const read = Number(progress.bytesRead || 0); const total = Number(progress.totalBytes || 0);
      if (total > 0) setVerificationPercent(Math.min(100, Math.floor((read / total) * 100)));
    });
    try {
      if (localRecovery !== 'verified') {
        const recovered = await bridge.reauthorizeRunInputs(runId);
        if (!recovered.ok) {
          if (!recovered.canceled) setErr(recovered.error === 'input_digest_mismatch'
            ? 'That is not the original file—the bytes do not match the approved run.'
            : recovered.error === 'local_input_wrong_machine'
              ? 'Reconnect this file on the Mac that created the run.'
              : 'Could not verify the original local file. Try again.');
          setBusy(null); return;
        }
        // A transient queue refusal must not make an 8GB source hash again.
        // The exact authority now lives in Desktop memory until app exit.
        setLocalRecovery('verified');
      }
      await callBackend('/api/v2/me/run-requests', {
        jwt: await jwt(), method: 'POST',
        body: {
          kind: 'continue', runId, source: 'dashboard',
          note: 'The original typed local input has been reauthorized on Desktop. Preserve every completed step and the approved plan; continue from the first pending step.',
        },
      });
      router.push('/workflows'); router.refresh();
    } catch (error) {
      const classified = classifyRunRequestRefusal(error);
      if (classified?.recoverable) setRefusal(classified);
      else setErr('The file was verified, but the continuation could not be queued. Try again.');
      setBusy(null);
    } finally { unsubscribe?.(); }
  }

  // QUIET: dismiss — close without acting (the gated step won't run).
  async function dismiss() {
    setBusy('dismiss'); setErr(null);
    try {
      await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/review`, {
        jwt: await jwt(), method: 'POST', body: { status: 'dismissed' },
      });
      router.push('/work'); router.refresh();
    } catch {
      setErr('Could not dismiss. Try again.'); setBusy(null);
    }
  }

  function continueInClaude() {
    const prompt =
      `Continue my Implexa agent "${agentName}". Its latest run (${runId}) produced a deliverable I've approved. ` +
      `Pick up where it paused at the human-approval gate: execute only the steps held behind my approval (e.g. publish/ship the approved option), don't redo the whole job.`;
    window.location.href = `claude://code/new?q=${encodeURIComponent(prompt.slice(0, CLAUDE_CODE_MAX))}`;
  }

  const primaryLabel = primaryAction === 'answer'
    ? 'Answer & continue'
    : primaryAction === 'continue'
      ? 'Continue the work'
      : primaryAction === 'approve_finish'
        ? 'Approve & finish'
        : 'Mark as done';

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      {/* One-line context, not a paragraph. */}
      <p className="text-sm text-ink-200">
        {needsInput
          ? <>This run <span className="text-ink-50 font-medium">needs your input</span> to finish.</>
          : resumesWork
            ? <>Ready for your approval. <span className="text-ink-400">Continuing resumes the remaining work hands-off — nothing happens until you do.</span></>
            : <>Ready. <span className="text-ink-400">Use it as you like, then mark it done.</span></>}
      </p>

      {/* Actions row */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {/* PRIMARY */}
        {needsInput ? (
          // needs-input: the changes box below is the action; the primary lives there.
          <span className="text-xs text-ink-500">
            {localRecovery === 'required' || localRecovery === 'verified'
              ? 'Reconnect the original input below ↓' : 'Add what it needs below ↓'}
          </span>
        ) : resumesWork ? (
          <button type="button" onClick={approveFinish} disabled={!!busy}
            className="btn-success text-sm px-4 py-2 disabled:opacity-60">
            {busy === 'approve' ? 'Approving…' : primaryLabel}
          </button>
        ) : (
          <button type="button" onClick={markDone} disabled={!!busy}
            className="btn-success text-sm px-4 py-2 disabled:opacity-60">
            {busy === 'done' ? 'Closing…' : primaryLabel}
          </button>
        )}

        {/* SECONDARY: request changes (hidden until asked, and not needed when the
            changes box is already the primary for needs-input). */}
        {!needsInput && (
          <button type="button" onClick={() => setShowChanges((v) => !v)} disabled={!!busy}
            className="btn-outline text-sm px-3.5 py-2 disabled:opacity-60">
            {showChanges ? 'Hide changes' : 'Request changes'}
          </button>
        )}

        {/* QUIET: dismiss + more */}
        <span className="ml-auto inline-flex items-center gap-4 text-xs">
          {confirmDismiss ? (
            <span className="inline-flex items-center gap-2 text-ink-400">
              {resumesWork ? "Dismiss without finishing?" : 'Dismiss this?'}
              <button type="button" onClick={dismiss} disabled={!!busy}
                className="font-medium text-rose-600 dark:text-rose-300 hover:underline disabled:opacity-50">
                {busy === 'dismiss' ? 'Dismissing…' : 'Yes'}
              </button>
              <button type="button" onClick={() => setConfirmDismiss(false)} className="text-ink-500 hover:text-ink-300">No</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDismiss(true)} disabled={!!busy}
              className="text-ink-500 hover:text-ink-200 transition-colors">
              Dismiss
            </button>
          )}
          <button type="button" onClick={() => setShowMore((v) => !v)}
            className="text-ink-500 hover:text-ink-200 transition-colors" aria-label="More options">⋯</button>
        </span>
      </div>

      {needsInput && localRecovery === 'checking' && (
        <p className="mt-3 text-xs text-ink-500">Checking the original local input…</p>
      )}
      {needsInput && (localRecovery === 'required' || localRecovery === 'verified') && (
        <div className="mt-3 rounded-md border border-amber-700/50 bg-amber-950/20 p-3">
          <p className="text-sm text-ink-100">Reconnect the original file to continue from the approved plan.</p>
          <p className="mt-1 text-xs text-ink-400">Implexa verifies the exact bytes locally. It does not upload or copy the source.</p>
          <button type="button" onClick={reconnectAndContinue} disabled={!!busy}
            className="btn-success mt-3 text-sm px-4 py-2 disabled:opacity-50">
            {busy === 'reconnect'
              ? localRecovery === 'verified' ? 'Continuing…'
                : `Verifying${verificationPercent === null ? '…' : `… ${verificationPercent}%`}`
              : localRecovery === 'verified' ? 'Continue from approved plan'
                : `Reconnect ${localRecoveryLabel} & continue`}
          </button>
        </div>
      )}

      {/* CHANGES box (revealed). A missing broker authority owns the primary
          surface; generic attachments cannot restore a typed local binding. */}
      {showChanges && localRecovery !== 'checking' && localRecovery !== 'required' && localRecovery !== 'verified' && (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            placeholder={needsInput ? 'Answer its question or add the missing inputs…' : 'What should it change? (e.g. punch up the hook)'}
            className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-y"
          />
          <AttachFiles files={files} canAttach={canAttach} canAttachFolder={canAttachFolder}
            onAttach={attachFile} onAttachFolder={attachFolder} onRemove={removeFile} error={attachError}
            hint="A screenshot, the captured footage, a doc — the run reads it as input." />
          {/* Permanent-edit opt-in: by default this re-runs THIS run with the change;
              check to also bake it into the agent so every future run does it. */}
          {skillSlug && note.trim() && (
            <label className="mt-2.5 flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={editAgent} onChange={(e) => setEditAgent(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-500 cursor-pointer" />
              <span className="text-[13px] text-ink-200 leading-snug">
                Also apply this to <span className="font-medium text-ink-50">future runs</span> — edit the agent so it does this every time
              </span>
            </label>
          )}
          <div className="mt-2">
            <button type="button" onClick={continueWithChanges}
              disabled={!!busy || (!note.trim() && files.length === 0)}
              className="btn-success text-sm px-4 py-2 disabled:opacity-50">
              {busy === 'changes' ? 'Queuing…' : (needsInput ? 'Send & continue' : 'Continue & re-run')}
            </button>
          </div>
        </div>
      )}

      {/* MORE (power-user escape hatches) */}
      {showMore && (
        <div className="mt-3 pt-3 border-t border-ink-800 flex flex-col gap-2 text-xs">
          <button type="button" onClick={continueInClaude} className="text-brand-500 hover:underline text-left w-fit">
            Continue live in Claude ↗
          </button>
          {claudeTaskId && (
            <a href={`claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(claudeTaskId)}`}
              className="text-brand-500 hover:underline w-fit">Open the routine in Claude ↗</a>
          )}
          {resumesWork && (
            <button type="button" onClick={markDone} disabled={!!busy} className="text-ink-400 hover:text-ink-200 text-left w-fit">
              Mark done without finishing (I&apos;ll use it myself)
            </button>
          )}
        </div>
      )}

      {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}
      {refusal?.recoverable && refusal.requestId && (
        <ReviewContinuationRecovery
          requestId={refusal.requestId}
          refusal={refusal}
          note={composeNoteWithFiles(note, files)}
        />
      )}
    </section>
  );
}
