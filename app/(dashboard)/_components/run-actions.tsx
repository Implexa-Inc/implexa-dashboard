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

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { AttachFiles, composeNoteWithFiles, useRunAttachments } from './run-attachments';

const CLAUDE_CODE_MAX = 13000;

export default function RunActions({
  runId,
  agentName,
  reviewStatus,
  hasShipStep,
  claudeTaskId,
  skillSlug,
}: {
  runId: string;
  agentName: string;
  /** 'pending' = approve-ready hold · 'needs_input' = blocked on a question. */
  reviewStatus: 'pending' | 'needs_input';
  /** Approving triggers a consequential step (post/publish/render) vs deliver-only. */
  hasShipStep: boolean;
  claudeTaskId?: string | null;
  /** The agent's slug — enables the "also edit the agent for future runs" opt-in
   *  on the changes box (a permanent revise alongside the one-off continue). */
  skillSlug?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const needsInput = reviewStatus === 'needs_input';
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
  const [note, setNote] = useState('');
  const { files, canAttach, attachFile, removeFile } = useRunAttachments();

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
        body: { kind: 'continue', runId, source: 'dashboard' },
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
      router.push('/overview'); router.refresh();
    } catch {
      setErr('Could not close it. Try again.'); setBusy(null);
    }
  }

  // SECONDARY: continue with the user's changes / missing inputs.
  async function continueWithChanges() {
    const composed = composeNoteWithFiles(note, files);
    if (busy || (!note.trim() && files.length === 0)) return;
    setBusy('changes'); setErr(null);
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
    } catch {
      setErr('Could not queue the changes. Try again.'); setBusy(null);
    }
  }

  // QUIET: dismiss — close without acting (the gated step won't run).
  async function dismiss() {
    setBusy('dismiss'); setErr(null);
    try {
      await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/review`, {
        jwt: await jwt(), method: 'POST', body: { status: 'dismissed' },
      });
      router.push('/overview'); router.refresh();
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

  const primaryLabel = needsInput
    ? 'Answer & continue'
    : hasShipStep ? 'Approve & finish' : 'Mark as done';

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      {/* One-line context, not a paragraph. */}
      <p className="text-sm text-ink-200">
        {needsInput
          ? <>This run <span className="text-ink-50 font-medium">needs your input</span> to finish.</>
          : hasShipStep
            ? <>Ready for your approval. <span className="text-ink-400">Approving finishes it hands-off — nothing ships until you do.</span></>
            : <>Ready. <span className="text-ink-400">Use it as you like, then mark it done.</span></>}
      </p>

      {/* Actions row */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {/* PRIMARY */}
        {needsInput ? (
          // needs-input: the changes box below is the action; the primary lives there.
          <span className="text-xs text-ink-500">Add what it needs below ↓</span>
        ) : hasShipStep ? (
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
              {hasShipStep ? "Dismiss without finishing?" : 'Dismiss this?'}
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

      {/* CHANGES box (revealed) */}
      {showChanges && (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            placeholder={needsInput ? 'Answer its question or add the missing inputs…' : 'What should it change? (e.g. punch up the hook)'}
            className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-y"
          />
          <AttachFiles files={files} canAttach={canAttach} onAttach={attachFile} onRemove={removeFile}
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
          {hasShipStep && (
            <button type="button" onClick={markDone} disabled={!!busy} className="text-ink-400 hover:text-ink-200 text-left w-fit">
              Mark done without finishing (I&apos;ll use it myself)
            </button>
          )}
        </div>
      )}

      {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}
    </section>
  );
}
