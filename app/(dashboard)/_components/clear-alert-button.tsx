'use client';

/**
 * <ClearAlertButton /> — "Ignore & clear this run" on the run detail page.
 *
 * Replaces the one-click ✕ that used to sit on the Alerts cards (too easy to hit,
 * and it cleared the alert entirely). Here it's a deliberate, labeled action with
 * an inline confirm. For a held-for-approval run it RESOLVES the hold server-side
 * (POST /runs/:id/review {dismissed}) so it clears for good, everywhere. For any
 * run it also writes the local "cleared" key the Alerts strip reads, so the card
 * disappears the moment you go back. Then it returns you to Home.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export default function ClearAlertButton({ runId, pending }: { runId: string; pending: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function clear() {
    setBusy(true);
    try {
      // Persist the local hide first so the Alerts strip drops it on return even
      // if the server call is slow/offline.
      try {
        const key = 'implexa:live-cleared';
        const cur = new Set<string>(JSON.parse(localStorage.getItem(key) || '[]'));
        cur.add(runId);
        localStorage.setItem(key, JSON.stringify([...cur]));
      } catch { /* localStorage unavailable */ }

      // For a held run, resolve the approval server-side so it's gone everywhere.
      if (pending) {
        const { data: { session } } = await supabase.auth.getSession();
        await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/review`, {
          jwt: session?.access_token, method: 'POST', body: { status: 'dismissed' },
        });
      }
      router.push('/overview');
      router.refresh();
    } catch {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-ink-400 hover:text-rose-600 dark:hover:text-rose-300 transition-colors"
      >
        Ignore &amp; clear this run
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-ink-400">
        {pending ? 'Clear without approving? It leaves your alerts and the gated step won’t run.' : 'Remove this from your alerts?'}
      </span>
      <button
        type="button"
        onClick={clear}
        disabled={busy}
        className="font-medium text-rose-600 dark:text-rose-300 hover:underline disabled:opacity-50"
      >
        {busy ? 'Clearing…' : 'Yes, clear'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="text-ink-500 hover:text-ink-300 disabled:opacity-50"
      >
        Cancel
      </button>
    </span>
  );
}
