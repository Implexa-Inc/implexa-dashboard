'use client';

/**
 * <StepTraceRefresh /> — a manual reload for the run page's free-text "Step trace".
 *
 * That trace is SERVER-rendered from the run's heartbeat notes and, unlike the
 * structured <RunStepChecklist> (which polls), it only updates when the whole page
 * re-renders — i.e. when the run ends or the user reloads. On a long run (e.g. a
 * 40-min render) it therefore looks frozen. This gives an in-place refresh:
 * router.refresh() re-runs the server component and repaints the trace with the
 * latest steps, no full navigation. The icon spins while the refetch is in flight.
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function StepTraceRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      aria-label="Refresh step trace"
      title="Refresh — the trace doesn't auto-update while a run is in progress"
      className="ml-auto text-ink-500 hover:text-ink-200 transition-colors disabled:opacity-60"
    >
      <span className={`inline-block text-sm leading-none ${pending ? 'animate-spin' : ''}`} aria-hidden>⟳</span>
    </button>
  );
}
