'use client';

/**
 * <RunClaudeActions /> — the two ways to get back to Claude from a run:
 *
 *  1. "Open the routine in Claude" — the verified Routines deep link
 *     (claude://claude.ai/claude-code-desktop/scheduled/<taskId>), to SEE the
 *     routine that produced this run. Only when we know its Claude task id.
 *  2. "Continue in Claude" — the fix for a human-approval gate that's otherwise a
 *     dead end: approving in the dashboard only sets a flag; the gated work (e.g.
 *     publish the approved option) never runs. This opens a FRESH Claude Code
 *     session (claude://code/new?q=) prefilled with the run id + an instruction to
 *     execute the post-approval steps, so the agent can actually finish the job.
 *
 * Plain anchors to claude:// — they work inside the desktop app (and prompt in a
 * browser). We never auto-send; the user reviews the prefilled prompt and hits
 * enter.
 */

const CLAUDE_CODE_MAX = 13000;

export default function RunClaudeActions({
  runId, agentName, claudeTaskId,
}: {
  runId: string;
  agentName: string;
  claudeTaskId?: string | null;
}) {
  const continuePrompt =
    `Continue my Implexa agent "${agentName}". Its latest run (${runId}) produced a deliverable I've now reviewed and APPROVED. ` +
    `Pick up where it paused at the human-approval gate: execute only the steps the agent held behind my approval (e.g. publish/ship the approved option) — don't redo the whole job. ` +
    `If you need the deliverable, load run ${runId} from Implexa or ask me to paste the part to act on. Confirm what you did when done.`;
  const continueHref = `claude://code/new?q=${encodeURIComponent(continuePrompt.slice(0, CLAUDE_CODE_MAX))}`;
  const routineHref = claudeTaskId
    ? `claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(claudeTaskId)}`
    : null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <a href={continueHref} className="btn-success text-xs px-3 py-1.5 whitespace-nowrap">
        Continue in Claude →
      </a>
      {routineHref && (
        <a href={routineHref} className="text-xs text-brand-500 hover:underline whitespace-nowrap">
          Open the routine in Claude ↗
        </a>
      )}
    </div>
  );
}
