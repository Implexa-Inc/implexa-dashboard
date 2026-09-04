'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

/** Stop is an owner request, not proof that a process exited or work succeeded. */
export default function RunStopControl({ runId, runState, cancelRequestedAt }: {
  runId: string; runState: string | null; cancelRequestedAt?: string | null;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [requested, setRequested] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // Use durable state, not heartbeat age, output prose, or an Active Agents card.
  const stoppable = runState === 'running' || runState === 'stalled';
  const pending = !!cancelRequestedAt || requested;

  useEffect(() => {
    if (!stoppable || !pending) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [stoppable, pending, router]);

  async function stop() {
    if (!stoppable || pending || ended || !confirm || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session?.access_token) throw new Error('login required');
      const result = await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/cancel`, {
        jwt: session.access_token, method: 'POST',
      }) as { ok?: boolean; requested?: boolean; alreadyTerminal?: boolean };
      if (result?.ok !== true || (result.requested !== true && result.alreadyTerminal !== true)) {
        throw new Error('cancellation response unavailable');
      }
      if (result.alreadyTerminal === true) setEnded(true);
      else setRequested(true);
      setConfirm(false);
      router.refresh();
    } catch {
      setError('Could not confirm the Stop request. Refresh this run to check its state before trying again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!stoppable) return null;
  return (
    <section className="mb-6 rounded-lg border border-amber-500/35 bg-amber-500/[0.05] p-4" aria-label="Run cancellation">
      <p className="text-sm text-ink-200">
        {ended ? 'This run has already ended. Refreshing its recorded result.'
          : pending ? 'Stop requested. Waiting for the owning executor or Desktop to confirm closure.'
            : 'This attempt is still open, even if no executor is currently active. You can request Stop without marking the work successful.'}
      </p>
      {!pending && !ended && (!confirm ? (
        <button type="button" className="btn-outline mt-3 text-sm" onClick={() => setConfirm(true)}>Stop run</button>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-ink-300">Stop this attempt and any remaining verification? This does not delete existing files, retry the work, or create a successful result.</p>
          <button type="button" className="btn-outline mt-3 text-sm" disabled={busy} onClick={stop}>{busy ? 'Requesting Stop…' : 'Confirm stop'}</button>
          <button type="button" className="ml-3 text-sm" disabled={busy} onClick={() => setConfirm(false)}>Keep open</button>
        </div>
      ))}
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  );
}
