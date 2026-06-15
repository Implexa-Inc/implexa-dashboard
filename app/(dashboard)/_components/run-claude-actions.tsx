'use client';

/**
 * <RunClaudeActions /> — get back to Claude from a run.
 *
 *  - "Approve & continue in Claude" (when the run is HELD at an approval gate):
 *    marks the run approved (POST /runs/:id/review → clears it from Needs You),
 *    then opens a fresh Claude Code session prefilled to execute the gated
 *    post-approval steps for this run, in the agent's context. The fix for the
 *    dead-end where approving did nothing. For a non-held run it's just
 *    "Continue in Claude" (no approval needed).
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
  const supabase = createClient();

  const verb = pending ? 'APPROVED' : 'reviewed';
  const continuePrompt =
    `Continue my Implexa agent "${agentName}". Its latest run (${runId}) produced a deliverable I've now ${verb}. ` +
    `Pick up where it paused at the human-approval gate: execute only the steps the agent held behind my approval (e.g. publish/ship the approved option) — don't redo the whole job. ` +
    `If you need the deliverable, load run ${runId} from Implexa or ask me to paste the part to act on. Confirm what you did when done.`;
  const continueHref = `claude://code/new?q=${encodeURIComponent(continuePrompt.slice(0, CLAUDE_CODE_MAX))}`;
  const routineHref = claudeTaskId
    ? `claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(claudeTaskId)}`
    : null;

  async function approveAndContinue() {
    if (busy) return;
    setBusy(true);
    // Mark the held run approved so it clears from Needs You. Best-effort — the
    // continuation (what the user actually wants) proceeds regardless.
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

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={approveAndContinue}
        disabled={busy}
        className="btn-success text-xs px-3 py-1.5 whitespace-nowrap disabled:opacity-60"
      >
        {busy ? 'Opening…' : pending ? 'Approve & continue in Claude →' : 'Continue in Claude →'}
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
    </div>
  );
}
