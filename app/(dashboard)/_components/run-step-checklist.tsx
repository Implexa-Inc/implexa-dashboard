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
import { isWatchableRunState, type RunStep } from '@/lib/run-state';
import RunStepsList from './run-steps-list';

const POLL_MS = 6000;

export default function RunStepChecklist({
  runId,
  initialSteps,
  initialRunState,
}: {
  runId: string;
  initialSteps: RunStep[];
  /** Queue and execution are one live lifecycle; watch across that boundary. */
  initialRunState: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [steps, setSteps] = useState<RunStep[]>(initialSteps);
  const [running, setRunning] = useState(initialRunState === 'running');
  const stop = useRef(false);

  useEffect(() => {
    if (!isWatchableRunState(initialRunState)) return;
    stop.current = false;
    let observedState = initialRunState;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend(`/api/v2/scheduled-skills/runs/${encodeURIComponent(runId)}`, { jwt: session?.access_token });
        const item = res?.item;
        if (item) {
          let refreshedThisPoll = false;
          if (Array.isArray(item.steps_state)) setSteps(item.steps_state as RunStep[]);
          const held = item.review_status === 'pending' || item.review_status === 'needs_input';
          const stillRunning = item.run_state === 'running' && !held;
          const stillWatchable = isWatchableRunState(item.run_state) && !held;
          setRunning(stillRunning);
          // The page can be opened while the reserved run is still queued. Keep
          // polling through queued -> running, and refresh the server-rendered
          // badge once at every observed lifecycle transition. Previously the
          // poller did not mount for queued runs, so the entire page stayed frozen
          // until a manual/browser refresh even while heartbeats were arriving.
          if (item.run_state !== observedState) {
            observedState = item.run_state;
            refreshedThisPoll = true;
            router.refresh();
          }
          // The server finalizes the checklist on completion/hold/failure. Land
          // that final state, refresh the rest of the page, then stop polling.
          if (!stillWatchable) {
            stop.current = true;
            if (!refreshedThisPoll) router.refresh();
          }
        }
      } catch { /* transient — keep the last good state, try again */ }
      if (!stop.current) timer = setTimeout(poll, POLL_MS);
    }
    // Do not add a full polling interval to the already-visible queue handoff.
    timer = setTimeout(poll, 1_000);
    return () => { stop.current = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, initialRunState]);

  if (!steps?.length) return null;
  // One renderer, shared with each Production node section: two implementations
  // of "which steps are done" is how the same run reads finished on one page
  // and stuck on the other.
  return <RunStepsList steps={steps} live={running} />;
}
