'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';

export function JudgeReviewRetry({ runId, judgmentId, finalOutputSha256, pending = false }: {
  runId: string; judgmentId: string; finalOutputSha256: string; pending?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (pending) setQueued(false); }, [pending]);
  async function retry() {
    if (busy || pending || queued) return;
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('sign_in_required');
      const result = await callBackend(`/api/v2/me/runs/${encodeURIComponent(runId)}/judge-retry`, {
        method: 'POST', jwt: session.access_token,
        body: { priorJudgmentId: judgmentId, expectedFinalOutputSha256: finalOutputSha256 },
      }) as { ok?: boolean; requestId?: string };
      if (!result.ok || !result.requestId) throw new Error('retry_unavailable');
      setQueued(true);
      router.refresh();
    } catch {
      setError('The review could not be queued. Refresh this page to check its latest status.');
    } finally { setBusy(false); }
  }
  return <div className="mt-3">
    <button type="button" onClick={retry} disabled={busy || pending || queued}
      className="btn-secondary text-xs disabled:opacity-50">
      {busy ? 'Queuing review…' : pending || queued ? 'Review queued' : 'Retry review'}
    </button>
    <p className="mt-1 text-xs text-ink-500">Reviews this same video using your model subscription. The agent will not run again.</p>
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
  </div>;
}
