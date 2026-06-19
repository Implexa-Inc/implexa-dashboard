'use client';

/**
 * <RunClaudeActions /> — finish a held run from the app, hands-off.
 *
 *  - "Approve & finish" (when the run is HELD at an approval gate): queues a
 *    kind='continue' run-request (POST /api/v2/me/run-requests). The backend
 *    marks the run approved and the always-on drainer executes the held
 *    post-approval step on the user's own Claude/Codex — no session to open.
 *    The result lands in the inbox. FALLBACK: if the kind='continue' endpoint
 *    isn't live yet (sibling chip not deployed → non-2xx / unknown-kind), we
 *    fall back to the prior open-Claude behavior so Approve never breaks.
 *  - "continue in Claude ↗" — small secondary opt-in (watch-it mode): marks the
 *    run approved, then opens a fresh Claude session prefilled to execute the
 *    gated step so the user can supervise it live. For a non-held run this is the
 *    primary "Continue in Claude" (no approval needed).
 *  - "Open the routine in Claude" — the verified Routines deep link, to VIEW the
 *    routine that produced this run (when we know its Claude task id).
 *
 * claude:// anchors work inside the desktop app (and prompt in a browser). We
 * never auto-send; the user reviews the prefilled prompt and hits enter.
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

const CLAUDE_CODE_MAX = 13000;

export default function RunClaudeActions({
  runId, agentName, claudeTaskId, pending = false,
}: {
  runId: string;
  agentName: string;
  claudeTaskId?: string | null;
  /** Run is held at an approval gate (review_status='pending'). */
  pending?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState('');
  const supabase = createClient();

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
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: { kind: 'continue', run_id: runId, source: 'dashboard' },
      });
      setDone(true);
      setMsg('Approved. Finishing hands-off; the result lands in your inbox.');
    } catch {
      // The kind='continue' endpoint isn't live yet (sibling chip not deployed:
      // unknown-kind / non-2xx) OR a transient backend error. Either way, fall
      // back to the prior open-Claude continue path so Approve never breaks.
      await openInClaude();
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
      <button
        type="button"
        onClick={pending ? approveAndFinish : openInClaude}
        disabled={busy}
        className="btn-success text-xs px-3 py-1.5 whitespace-nowrap disabled:opacity-60"
      >
        {busy ? 'Working…' : pending ? 'Approve & finish' : 'Continue in Claude →'}
      </button>
      {/* Secondary opt-in for held runs: watch it finish live in Claude. */}
      {pending && (
        <button
          type="button"
          onClick={openInClaude}
          disabled={busy}
          className="text-xs text-brand-500 hover:underline whitespace-nowrap disabled:opacity-60"
        >
          continue in Claude ↗
        </button>
      )}
      {routineHref && (
        <a
          href={routineHref}
          title="Opens Claude's Routines list (Claude doesn't support deep-linking to a specific routine)"
          className="text-xs text-brand-500 hover:underline whitespace-nowrap"
        >
          Open Claude Routines ↗
        </a>
      )}
    </div>
  );
}
