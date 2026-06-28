'use client';

/**
 * <RunStepChecklist /> — the live, per-step checklist for a chain/workflow run.
 *
 * Where the run page's free-text "Step trace" answers "what did it last say", this
 * answers the at-a-glance question while a run is IN FLIGHT: which of the chain's
 * steps are done, which one is executing now, which are still pending. It reads
 * skill_runs.steps_state (migration 0089) and, while the run is still running,
 * polls GET /api/v2/scheduled-skills/runs/:id so the list advances without a
 * reload (the backend returns the same step columns via getRunById).
 *
 * Seeded with the server-fetched steps so it paints instantly; polling only takes
 * over to keep it fresh. Stops polling the moment the run leaves 'running'.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { RunStep, StepStatus } from '@/lib/run-state';

const POLL_MS = 6000;

// Per-status glyph + tint. running = spinner (it's the live one), done = check,
// failed = ✕, pending = hollow dot.
function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') {
    return <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-sky-500/25 border-t-sky-500 animate-spin" aria-hidden="true" />;
  }
  if (status === 'done') {
    return <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center text-[9px] font-bold" aria-hidden="true">✓</span>;
  }
  if (status === 'failed') {
    return <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 grid place-items-center text-[9px] font-bold" aria-hidden="true">✕</span>;
  }
  return <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-ink-700" aria-hidden="true" />;
}

export default function RunStepChecklist({
  runId,
  initialSteps,
  live,
}: {
  runId: string;
  initialSteps: RunStep[];
  /** True when the run was 'running' at page load — start polling for updates. */
  live: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [steps, setSteps] = useState<RunStep[]>(initialSteps);
  const [running, setRunning] = useState(live);
  const stop = useRef(false);

  useEffect(() => {
    if (!live) return;
    stop.current = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend(`/api/v2/scheduled-skills/runs/${encodeURIComponent(runId)}`, { jwt: session?.access_token });
        const item = res?.item;
        if (item) {
          if (Array.isArray(item.steps_state)) setSteps(item.steps_state as RunStep[]);
          // Stop once the run is no longer in flight — the server finalizes the
          // checklist (all done / mid-step failed) on close, so one last poll
          // lands the terminal state, then we idle.
          const stillRunning = item.run_state === 'running' && item.review_status !== 'pending' && item.review_status !== 'needs_input';
          setRunning(stillRunning);
          // The run just left "running" (completed, held for approval, or failed).
          // The steps poll keeps the checklist fresh, but the REST of the page — the
          // status badge, the Approve/Mark-done actions, the deliverable — is
          // server-rendered and was going stale until a manual reload (founder: "no
          // way to know it finished without leaving and coming back"). Refresh the
          // server components ONCE on that transition so the whole page catches up.
          if (!stillRunning) { stop.current = true; router.refresh(); }
        }
      } catch { /* transient — keep the last good state, try again */ }
      if (!stop.current) timer = setTimeout(poll, POLL_MS);
    }
    timer = setTimeout(poll, POLL_MS);
    return () => { stop.current = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, live]);

  if (!steps?.length) return null;
  const done = steps.filter((s) => s.status === 'done').length;
  const total = steps.length;

  return (
    <div className="mb-6 rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-ink-300">Steps</span>
        {running && (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-sky-700 dark:text-sky-300 bg-sky-500/15 rounded px-1.5 py-0.5">live</span>
        )}
        <span className="text-[11px] text-ink-500 ml-auto">{done}/{total} done</span>
      </div>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.index} className="flex items-center gap-2.5 text-sm">
            <StepIcon status={s.status} />
            <span className="text-[11px] font-mono text-ink-600 shrink-0">{s.index}/{total}</span>
            <span className={s.status === 'pending' ? 'text-ink-500 truncate' : 'text-ink-100 truncate'}>
              {s.label || `Step ${s.index}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
