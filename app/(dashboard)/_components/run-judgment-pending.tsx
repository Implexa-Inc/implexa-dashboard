'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

type JudgeRequestStatus = 'pending' | 'consumed' | 'cancelled' | null;

// A real video Judge review (artifact inspection, media probes, transcript
// comparison) can easily run past a couple of minutes. The old fixed 24-poll
// (2-minute) window stopped calling router.refresh() after that and never
// resumed — the page froze on "reviewing" even once a verdict genuinely
// existed, until the user manually reloaded (the exact bug reported: a run
// with a recorded `uncertain` verdict still showing "Judge is reviewing").
//
// Fixed: poll INDEFINITELY while the request is still pending/consumed — the
// server component re-checks run_judgments on every refresh, so the moment a
// verdict lands, the next poll naturally stops rendering this component at
// all. Backs off from 5s to 20s after the first two minutes so a
// longer-running review doesn't hammer the server forever.
const FAST_POLL_MS = 5000;
const SLOW_POLL_MS = 20000;
const FAST_POLL_WINDOW_MS = 2 * 60 * 1000;

// STALL CEILING (review follow-up): run_requests has no 'failed' status — a
// worker session that crashes right after CLAIMING the request (consumed) but
// before ever calling recordJudgment leaves it stuck there forever, with no
// terminal marker at all. Without a client-side ceiling, an open tab would
// call router.refresh() every 20s indefinitely for a request that will never
// resolve. 20 minutes is generous — real reviews (artifact inspection, media
// probes, transcript comparison) should finish well inside it — but it is a
// deadline, not a guess about typical duration; past it we stop polling and
// say so, rather than silently going quiet or refreshing forever.
const STALL_CEILING_MS = 20 * 60 * 1000;

export function RunJudgmentPending({
  phase = 'review',
  requestStatus = null,
  createdAt = null,
}: {
  phase?: 'review' | 'repair';
  /** The underlying run_requests status, so a genuinely CANCELLED request (which
   *  will never produce a verdict) renders a terminal message and stops polling,
   *  instead of looking identical to one still actively in flight. */
  requestStatus?: JudgeRequestStatus;
  /** When the request was created, so the client can stop polling on its own
   *  past a reasonable ceiling even if the request never reaches a terminal
   *  status (see STALL_CEILING_MS). */
  createdAt?: string | null;
}) {
  const router = useRouter();
  const cancelled = requestStatus === 'cancelled';
  // A missing createdAt means "no age known" — treated as fresh (0ms), not
  // stalled, since older callers may not supply it at all. An INVALID
  // createdAt (a malformed string) is different: Date.now() - NaN = NaN, and
  // NaN > STALL_CEILING_MS is ALWAYS false in JS — so a corrupt timestamp
  // used to silently bypass the ceiling entirely and poll forever, the exact
  // failure mode this component exists to prevent. Fail CLOSED instead: an
  // unparseable timestamp is treated as already stalled, not as ageless.
  const parsedAgeMs = createdAt ? Date.now() - new Date(createdAt).getTime() : 0;
  const invalidCreatedAt = createdAt != null && Number.isNaN(parsedAgeMs);
  const ageMs = invalidCreatedAt ? Infinity : parsedAgeMs;
  const stalled = !cancelled && ageMs > STALL_CEILING_MS;

  useEffect(() => {
    if (cancelled || stalled) return; // terminal (or stalled past the ceiling) — nothing more to poll for
    let elapsed = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const interval = elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
      timer = setTimeout(() => {
        elapsed += interval;
        router.refresh();
        tick();
      }, interval);
    };
    tick();
    return () => clearTimeout(timer);
  }, [router, cancelled, stalled]);

  if (cancelled) {
    return (
      <div className="mb-6 rounded-xl border border-ink-700 bg-ink-900/40 px-4 py-3" role="status">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-ink-500" aria-hidden />
          <span className="text-sm font-medium text-ink-200">
            {phase === 'repair' ? 'The repair attempt was cancelled' : 'Implexa Judge review was cancelled'}
          </span>
        </div>
        <p className="text-xs text-ink-500 mt-1">No verdict will be produced for this request.</p>
      </div>
    );
  }

  if (stalled) {
    return (
      <div className="mb-6 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3" role="status">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
          <span className="text-sm font-medium text-ink-200">
            {phase === 'repair' ? 'This repair is taking unusually long' : 'This review is taking unusually long'}
          </span>
        </div>
        <p className="text-xs text-ink-500 mt-1">
          It may have stalled. Refresh the page to check again — this banner stops auto-refreshing past 20 minutes so an open tab doesn&apos;t poll forever.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-violet-500/25 bg-violet-500/5 px-4 py-3" role="status">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" aria-hidden />
        <span className="text-sm font-medium text-ink-200">
          {phase === 'repair' ? 'Implexa is repairing this run' : 'Implexa Judge is reviewing this run'}
        </span>
      </div>
      <p className="text-xs text-ink-500 mt-1">
        {phase === 'repair'
          ? 'The agent is applying the Judge’s qualitative feedback hands-off. Its updated result will be reviewed again in a fresh session.'
          : 'A fresh session is checking the request, criteria, memory, and actual artifacts. The verdict will appear here.'}
      </p>
    </div>
  );
}
