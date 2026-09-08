'use client';

// "Retry safely — no work started previously" (backend 0335).
//
// Rendered on a run whose request was surfaced after a Codex control-plane
// attachment failure. The BACKEND decides eligibility from its ledger; this
// component reads it, shows the explicit distinction from "Run again", asks
// for confirmation, and posts ONLY the pins it read back (generation, frozen
// workflow version, input digest). It never sends attempt ids, fences or proof
// tokens, and it never claims a queue the server did not confirm.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import {
  describeControlPlaneRetry, retryConfirmed, RETRY_SAFELY_LABEL, RETRY_SAFELY_DISTINCTION, RUN_AGAIN_DISTINCTION,
} from '@/lib/control-plane-retry';

export function ControlPlaneRetry({ requestId }: { requestId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [eligibility, setEligibility] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const path = `/api/v2/me/run-requests/${encodeURIComponent(requestId)}/control-plane-retry`;

  async function readEligibility(active: () => boolean) {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) return;
      const value = await callBackend(path, { jwt: data.session.access_token });
      if (active()) setEligibility(value);
    } catch {
      if (active()) setEligibility(null);
    }
  }

  useEffect(() => {
    let active = true;
    void readEligibility(() => active);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, supabase]);

  const presentation = describeControlPlaneRetry(eligibility);
  if (queued || presentation.state === 'queued') {
    return (
      <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-3 text-sm text-ink-200">
        Queued again safely — same request, frozen inputs. Implexa will verify its control tools before any work starts.
      </div>
    );
  }
  if (presentation.state === 'hidden') return null;

  async function retry() {
    if (busy || inFlight.current || presentation.state !== 'available') return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await callBackend(path, {
        jwt: session?.access_token, method: 'POST',
        body: {
          expectedDrainRetryEpoch: presentation.pins.expectedDrainRetryEpoch,
          expectedWorkflowVersionId: presentation.pins.expectedWorkflowVersionId,
          expectedInputBindingsDigest: presentation.pins.expectedInputBindingsDigest,
        },
      });
      if (!retryConfirmed(result)) throw new Error('unconfirmed');
      setQueued(true);
      router.refresh();
    } catch {
      setError('Could not queue the safe retry. The request may have changed; its current state was reloaded.');
      setConfirming(false);
      await readEligibility(() => true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/[0.06] px-3 py-3">
      <div className="text-sm font-semibold text-ink-100">{RETRY_SAFELY_LABEL}</div>
      <p className="mt-1 text-xs text-ink-300 leading-relaxed">
        Implexa could not attach its control tools before work began. No work or provider action started.
      </p>
      <ul className="mt-2 text-xs text-ink-400 leading-relaxed">
        <li>{RETRY_SAFELY_DISTINCTION}</li>
        <li>{RUN_AGAIN_DISTINCTION}</li>
      </ul>
      {presentation.state === 'disabled' && (
        <p className="mt-2 text-xs text-amber-300">Retry safely is unavailable: {presentation.explanation}</p>
      )}
      {presentation.state === 'available' && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} disabled={busy}
          className="mt-2 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
          Retry safely
        </button>
      )}
      {presentation.state === 'available' && confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-300">Queue the same request with its frozen inputs?</span>
          <button type="button" onClick={() => void retry()} disabled={busy}
            className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? 'Queuing…' : 'Queue the same request'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-60">
            Keep it paused
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}

export default ControlPlaneRetry;
