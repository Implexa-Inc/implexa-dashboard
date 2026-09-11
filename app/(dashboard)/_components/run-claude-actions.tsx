'use client';

/**
 * <RunClaudeActions /> — finish a held run from the app, hands-off.
 *
 *  - "Approve & finish" (when the run is HELD at an approval gate): queues a
 *    kind='continue' run-request (POST /api/v2/me/run-requests). The backend
 *    marks the run approved and the always-on drainer executes the held
 *    post-approval step on the user's own Claude/Codex — no session to open.
 *    The result lands in the inbox. FAIL CLOSED: a refusal or a backend/transport
 *    failure leaves the run exactly as it was, says so, and keeps the button
 *    available. It never silently opens Claude and never marks the run approved
 *    — that fallback (for a backend that predated kind='continue') would run
 *    the held step outside every hands-off guarantee, including machine setup.
 *  - "continue in Claude ↗" — small secondary opt-in (watch-it mode): marks the
 *    run approved (if held), then opens a fresh Claude session prefilled to execute
 *    the gated step so the user can supervise it live. It's a SMALL link for held
 *    AND non-held runs now — the primary continue path is the hands-off, prompt-+-
 *    files <RunContinueBox /> rendered alongside this (the universal "Continue this
 *    run"); this component is just Approve & finish (held) + the watch-it opt-in.
 *  - "Open the routine in Claude" — the verified Routines deep link, to VIEW the
 *    routine that produced this run (when we know its Claude task id).
 *
 * claude:// anchors work inside the desktop app (and prompt in a browser). We
 * never auto-send; the user reviews the prefilled prompt and hits enter.
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { runRequestRefusalCopy } from '@/lib/run-request-refusal';
import { useSetupRequiredGate } from './setup-required-gate';

const CLAUDE_CODE_MAX = 13000;

export default function RunClaudeActions({
  runId, agentName, claudeTaskId, pending = false, slug = null, workflowVersionId = null,
}: {
  runId: string;
  agentName: string;
  claudeTaskId?: string | null;
  /** Run is held at an approval gate (review_status='pending'). */
  pending?: boolean;
  /** The run's agent and FROZEN version, for "Open setup" on a setup refusal. */
  slug?: string | null;
  workflowVersionId?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const supabase = createClient();
  // MACHINE-CAPABILITY ADMISSION (backend 0346): a typed setup_required refusal
  // is the modal, for the run's own agent and frozen version.
  const setupGate = useSetupRequiredGate({ slug, workflowVersionId });

  const verb = pending ? 'APPROVED' : 'reviewed';
  const continuePrompt =
    `Continue my Implexa agent "${agentName}". Its latest run (${runId}) produced a deliverable I've now ${verb}. ` +
    `Pick up where it paused at the human-approval gate: execute only the steps the agent held behind my approval (e.g. publish/ship the approved option), don't redo the whole job. ` +
    `If you need the deliverable, load run ${runId} from Implexa or ask me to paste the part to act on. Confirm what you did when done.`;
  const continueHref = `claude://code/new?q=${encodeURIComponent(continuePrompt.slice(0, CLAUDE_CODE_MAX))}`;
  const routineHref = claudeTaskId
    ? `claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(claudeTaskId)}`
    : null;

  // PRIMARY (held runs): approve + finish hands-off. Queue a kind='continue'
  // run-request; the drainer executes the held step on the user's own runtime.
  async function approveAndFinish() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const gated = await setupGate.guard(({ machineId }) => callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: { kind: 'continue', runId, source: 'dashboard', ...(machineId ? { executionMachineId: machineId } : {}) },
      }), () => {
        setDone(true);
        setMsg('Approved. Finishing hands-off; the result lands in your inbox.');
      });
      if (!gated.ok) return;
    } catch (error) {
      // Any other failure (5xx, network, a typed refusal): nothing was queued
      // and nothing was approved. Say so; do NOT open Claude or mark approved.
      setErr(runRequestRefusalCopy(error, 'Could not approve and finish. Nothing was changed. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  // SECONDARY (watch-it mode) + the only path for non-held runs: mark the run
  // approved (if held) and open a fresh Claude session prefilled to finish it.
  async function openInClaude() {
    if (pending) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/review`, {
          jwt: session?.access_token, method: 'POST', body: { status: 'approved' },
        });
      } catch { /* non-fatal */ }
    }
    window.location.href = continueHref; // hand off to Claude (prefilled, not sent)
  }

  if (done) {
    return <p className="text-xs text-success-600 dark:text-success-400">{msg}</p>;
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {setupGate.modal}
      {/* Held runs keep "Approve & finish" as the prominent primary CTA (continue
          with the implicit "ship the approved deliverable" intent). The general
          "Continue with a prompt" box (<RunContinueBox />) sits right under this so
          the user can instead supply inputs/changes. */}
      {pending && (
        <button
          type="button"
          onClick={approveAndFinish}
          disabled={busy}
          className="btn-success text-xs px-3 py-1.5 whitespace-nowrap disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Approve & finish'}
        </button>
      )}
      {/* Watch-it path: a small opt-in to finish/continue live in Claude. Primary
          continuing now happens hands-off via <RunContinueBox />, so this stays a
          small link for held AND non-held runs. */}
      <button
        type="button"
        onClick={openInClaude}
        disabled={busy}
        className="text-xs text-brand-500 hover:underline whitespace-nowrap disabled:opacity-60"
      >
        continue in Claude ↗
      </button>
      {routineHref && (
        <a
          href={routineHref}
          title="Opens Claude's Routines list (Claude doesn't support deep-linking to a specific routine)"
          className="text-xs text-brand-500 hover:underline whitespace-nowrap"
        >
          Open Claude Routines ↗
        </a>
      )}
      {err ? <span className="text-xs text-rose-600 dark:text-rose-400" role="alert">{err}</span> : null}
    </div>
  );
}
