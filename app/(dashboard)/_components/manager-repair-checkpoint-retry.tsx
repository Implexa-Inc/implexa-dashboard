'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';

type Eligibility = {
  ok?: boolean;
  eligible?: boolean;
  alreadyQueued?: boolean;
  checkpointCount?: number;
  reason?: string;
};

export function ManagerRepairCheckpointRetry({ requestId }: { requestId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session?.access_token) return null;
      return callBackend(`/api/v2/me/manager-repairs/${encodeURIComponent(requestId)}/checkpoint-retry`, {
        jwt: data.session.access_token,
      });
    }).then((value) => {
      if (active && value) setEligibility(value as Eligibility);
    }).catch(() => {
      if (active) setEligibility({ ok: false, eligible: false, reason: 'checkpoint_retry_unavailable' });
    });
    return () => { active = false; };
  }, [requestId, supabase]);

  if (!eligibility?.eligible || eligibility.alreadyQueued) return null;

  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await callBackend(
        `/api/v2/me/manager-repairs/${encodeURIComponent(requestId)}/checkpoint-retry`,
        { jwt: session?.access_token, method: 'POST' },
      ) as { ok?: boolean; requeued?: boolean; reason?: string };
      if (!result.ok || !result.requeued) throw new Error(result.reason || 'checkpoint_retry_unavailable');
      setEligibility({ ok: true, eligible: true, alreadyQueued: true });
      router.refresh();
    } catch {
      setError('The retry could not be queued. Refresh this run to check whether its checkpoint is still available.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-violet-500/25 bg-violet-500/5 px-3 py-3">
      <p className="text-xs text-ink-300">
        {eligibility.checkpointCount === 1 ? 'An exact original editable-input checkpoint was captured' : 'Exact original editable-input checkpoints were captured'} on the required Desktop. The Desktop will verify the saved bytes again before it starts.
      </p>
      <button type="button" onClick={retry} disabled={busy}
        className="mt-2 rounded-md bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? 'Queuing retry…' : 'Retry from original checkpoint'}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
