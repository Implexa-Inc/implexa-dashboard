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
 *
 * This component is now the LIVE half only — the list itself renders through
 * <RunStepsList>, which each Production node section uses too.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { RunStep } from '@/lib/run-state';
import RunStepsList from './run-steps-list';

const POLL_MS = 6000;

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
  // One renderer, shared with each Production node section: two implementations
  // of "which steps are done" is how the same run reads finished on one page
  // and stuck on the other.
  return <RunStepsList steps={steps} live={running} />;
}
