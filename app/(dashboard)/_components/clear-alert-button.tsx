'use client';

/**
 * <ClearAlertButton /> — clearing a run from your Alerts, on the run detail page.
 * Replaces the one-click ✕ that used to sit on the Alerts cards (too easy to hit).
 *
 * Two distinct actions, because they mean different things:
 *   • Hide — declutter only. Removes the card from YOUR alerts on this device; the
 *     approval stays pending, so it reappears elsewhere and a new run re-surfaces.
 *     Non-destructive, no confirm.
 *   • Dismiss approval — resolve the gate. The held deliverable will NOT finish its
 *     gated step (e.g. send/post). Server-side + permanent, so it's confirm-gated.
 *
 * Stalled/failed runs have no approval to dismiss, so they only get Hide.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

function hideLocally(runId: string) {
  try {
    const key = 'implexa:live-cleared';
    const cur = new Set<string>(JSON.parse(localStorage.getItem(key) || '[]'));
    cur.add(runId);
    localStorage.setItem(key, JSON.stringify([...cur]));
  } catch { /* localStorage unavailable */ }
}

export default function ClearAlertButton({ runId, pending }: { runId: string; pending: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<null | 'hide' | 'dismiss'>(null);

  function hide() {
    setBusy('hide');
    hideLocally(runId);
    router.push('/work');
    router.refresh();
  }

  async function dismissApproval() {
    setBusy('dismiss');
    try {
      hideLocally(runId);
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/review`, {
        jwt: session?.access_token, method: 'POST', body: { status: 'dismissed' },
      });
      router.push('/work');
      router.refresh();
    } catch {
      setBusy(null);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 text-sm flex-wrap">
        <span className="text-ink-400">Dismiss without approving? The gated step won’t run.</span>
        <button
          type="button"
          onClick={dismissApproval}
          disabled={busy !== null}
          className="font-medium text-rose-600 dark:text-rose-300 hover:underline disabled:opacity-50"
        >
          {busy === 'dismiss' ? 'Dismissing…' : 'Yes, dismiss'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy !== null}
          className="text-ink-500 hover:text-ink-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-4 text-sm">
      <button
        type="button"
        onClick={hide}
        disabled={busy !== null}
        title="Remove from your alerts. The approval stays pending — a new run will re-surface it."
        className="text-ink-400 hover:text-ink-100 transition-colors disabled:opacity-50"
      >
        {busy === 'hide' ? 'Hiding…' : 'Hide from alerts'}
      </button>
      {pending && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          title="Resolve the gate so it stops asking. The held step will not run."
          className="text-ink-400 hover:text-rose-600 dark:hover:text-rose-300 transition-colors"
        >
          Dismiss approval
        </button>
      )}
    </span>
  );
}
