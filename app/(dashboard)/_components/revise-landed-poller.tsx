'use client';

/**
 * <ReviseLandedPoller /> — refresh the agent page when an in-flight rewrite LANDS.
 *
 * THE BUG (founder, 2026-07-24): "Edit + Update the agent — when the update
 * finishes the page should reload with new steps/data, otherwise I see a stale
 * agent until I manually refresh."
 *
 * A revise is ASYNCHRONOUS. `/api/agents/revise` only ENQUEUES a kind='revise'
 * request; the user's own Claude/Codex drains it minutes later and calls
 * revise_workflow, which is when the steps actually change. ImproveAgent already
 * calls router.refresh() — but that fires at ENQUEUE time, which is why the
 * "Rewrite in progress" banner appears instantly and then nothing ever updates
 * again. Nobody was watching for the landing.
 *
 * `revisePending` is computed on the SERVER for this page, so re-running the
 * server render is itself the check: refresh, and if the revise landed the prop
 * comes back false, this unmounts, and the user is looking at the new steps
 * without touching anything.
 *
 * BOUNDED, and honest when it gives up. A revise that never lands (drainer
 * offline, Claude capped, the request expired) must not leave a page refreshing
 * forever — so this backs off and stops, leaving the banner as the standing
 * truth rather than pretending it is still watching.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Backoff schedule (ms). A revise usually lands in a minute or two; the tail is
// for a busy/queued drainer. Total ≈ 10 minutes, then we stop.
const DELAYS_MS = [5000, 5000, 8000, 8000, 15000, 15000, 30000, 30000, 60000, 60000, 120000, 120000, 180000];

export default function ReviseLandedPoller({ revisePending }: { revisePending: boolean }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    // Not pending → nothing to watch. Also resets the budget so a SECOND edit
    // later in the same session gets a fresh set of attempts.
    if (!revisePending) { attempt.current = 0; setGaveUp(false); return; }
    if (gaveUp) return;

    const delay = DELAYS_MS[Math.min(attempt.current, DELAYS_MS.length - 1)];
    const t = window.setTimeout(() => {
      attempt.current += 1;
      if (attempt.current > DELAYS_MS.length) { setGaveUp(true); return; }
      // Re-runs the server component. If the rewrite landed, revisePending comes
      // back false and this effect tears itself down.
      router.refresh();
    }, delay);
    return () => window.clearTimeout(t);
    // `attempt.current` is a ref on purpose — bumping it inside the timeout must
    // not itself retrigger the effect; `gaveUp` is what ends the loop.
  }, [revisePending, gaveUp, router]);

  if (!revisePending || !gaveUp) return null;

  // Still pending after the whole budget: say so plainly instead of silently
  // continuing to look busy.
  return (
    <p className="mt-2 text-[11px] text-ink-500 leading-snug">
      Still waiting on your Claude to pick this up. Reload the page to check again.
    </p>
  );
}
