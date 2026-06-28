'use client';

/**
 * <StuckRunButton /> — the FOREVER FALLBACK (founder's idea): a guaranteed manual
 * escape for a run that's stuck waiting on a permission we didn't pre-grant.
 *
 * Because every on-demand run flows through ONE routine — the browser-run
 * dispatcher ("Implexa Agents" / implexa-browser-dispatcher) — "stuck" always
 * means that routine's session is sitting on a prompt nobody answered. So we
 * deep-link STRAIGHT to it in Claude (verified deep link), where the user can
 * click the running session and approve whatever it's waiting on. This takes the
 * user to the EXISTING stuck session to answer it — you can't un-stick a blocked
 * session with a new prompt, so this is distinct from "re-run".
 *
 * If the run belongs to the agent's OWN scheduled routine (a recurring agent that
 * stalled), we deep-link to that routine instead. The deep link can no-op (app
 * not handling the scheme), so we always show a plain-text fallback path.
 */

const DISPATCHER_TASK_ID = 'implexa-browser-dispatcher';

export default function StuckRunButton({
  claudeTaskId,
  className = '',
}: {
  /** The agent's own routine task id when this is a scheduled run; else we fall
   *  back to the shared on-demand dispatcher (where most stuck runs live). */
  claudeTaskId?: string | null;
  className?: string;
}) {
  const taskId = claudeTaskId || DISPATCHER_TASK_ID;
  const href = `claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(taskId)}`;
  return (
    <div className={className}>
      <a
        href={href}
        className="btn-success text-xs px-3 py-1.5 inline-flex items-center gap-1 whitespace-nowrap"
      >
        Open it in Claude &amp; approve ↗
      </a>
      <p className="mt-1 text-[10.5px] text-ink-500 leading-snug">
        Nothing opened? In Claude, go to <span className="text-ink-300">Routines</span> → the one marked
        <span className="text-ink-300"> Running</span> → click it and approve the permission it&apos;s waiting on.
      </p>
    </div>
  );
}
