'use client';

/**
 * <MarkDoneButton /> — "I've handled this, close it." The escape hatch for a held
 * run whose deliverable you just USE (HN drafts you paste, a reel you uploaded by
 * hand): there's no agent step left to run, so "Approve & finish" (ship the gated
 * step) and "Continue" (re-run) both miss — you just want it marked done.
 *
 * Closes the run server-side via POST /runs/:id/review { status:'approved' } (the
 * hold clears, so it leaves Alerts) WITHOUT re-running the agent. Works for both a
 * pending (approval) hold and a needs_input hold.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export default function MarkDoneButton({ runId }: { runId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function markDone() {
    setBusy(true);
    try {
      // Drop it from this device's alert list too, so it disappears immediately.
      try {
        const key = 'implexa:live-cleared';
        const cur = new Set<string>(JSON.parse(localStorage.getItem(key) || '[]'));
        cur.add(runId);
        localStorage.setItem(key, JSON.stringify([...cur]));
      } catch { /* localStorage unavailable */ }
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/review`, {
        jwt: session?.access_token, method: 'POST', body: { status: 'approved' },
      });
      router.push('/overview');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={markDone}
      disabled={busy}
      title="You've already used this output (or done the manual step) — close the run, no re-run."
      className="btn-success text-sm px-4 py-2 disabled:opacity-50"
    >
      {busy ? 'Marking done…' : '✓ Mark as done'}
    </button>
  );
}
