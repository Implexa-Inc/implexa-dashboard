'use client';

/**
 * <FinalizeRecoveredButton /> — salvage a run that DID the work but never
 * reported it.
 *
 * THE CASE (founder hit it twice): a long render heartbeats all the way to a
 * verified deliverable — "VERIFIED: 650.60s → 624.60s, exactly 26.000s cut,
 * SSIM 0.9945, 0 decode errors" — and then the session dies without ever calling
 * record_scheduled_run. The dashboard showed "This run stalled" directly above a
 * trace that plainly said the work was finished, and offered no way out.
 *
 * WHY THIS IS A BUTTON AND NOT AUTOMATIC — the load-bearing decision. A heartbeat
 * is the agent's own unverified claim about itself. Auto-promoting one to a
 * completed run would invent a delivery the user never received, which is the
 * same class of dishonesty as closing an exit-0 run 'completed'. So the user
 * reads the evidence and makes the call; we only surface it.
 *
 * The server re-checks eligibility (this page may be an hour stale, and — since
 * 2026-07-24 — a DIFFERENT automatic recovery may have already delivered the
 * real answer for this run) and records the result as status='partial' +
 * run_close_reason='user_finalized_recovered', so a salvaged run never
 * masquerades as a cleanly delivered one.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend, BackendError } from '@/lib/api';

export function FinalizeRecoveredButton({ runId, looksComplete }: { runId: string; looksComplete: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'error'>('idle');
  const [note, setNote] = useState<string | null>(null);

  const finalize = async () => {
    setState('busy');
    setNote(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/runs/${runId}/finalize`, { jwt: session?.access_token, method: 'POST' });
      router.refresh();
    } catch (e) {
      // 409 is not a failure the user caused: the run moved on underneath them —
      // the agent reported, another closer won the race, or (the 2026-07-24 case)
      // a different automatic recovery already delivered the real answer.
      // Refreshing shows them the truth, which is more useful than an error they
      // cannot act on.
      if (e instanceof BackendError && e.status === 409) { router.refresh(); return; }
      setState('error');
      setNote(e instanceof Error ? e.message : 'Could not finalize this run.');
    }
  };

  // 'busy' and 'error' MUST stay on this branch too: finalize() calls
  // setState('busy') then, on failure, setState('error') + setNote(message).
  // Gating on state==='confirm' alone would fall through to the bare CTA below
  // on either of those re-renders — silently dropping the busy indicator (the
  // button could be clicked again mid-request) and, worse, silently dropping
  // the error message entirely (the user sees the plain button again with zero
  // indication anything went wrong).
  if (state === 'confirm' || state === 'busy' || state === 'error') {
    const busy = state === 'busy';
    return (
      <div className="w-full rounded-md border border-emerald-500/40 bg-emerald-500/[0.06] px-3 py-3">
        <p className="text-sm text-ink-200 leading-relaxed">
          This marks the run done using the step trace above as the record. It won&apos;t re-run anything,
          and it won&apos;t invent a result — the run is saved as <span className="text-ink-100">recovered</span>,
          not delivered.
        </p>
        {note && <p className="text-xs text-rose-500 mt-2">{note}</p>}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={finalize}
            disabled={busy}
            className="btn-primary text-xs px-3 py-1.5"
          >
            {busy ? 'Finalizing…' : 'Yes, mark this done'}
          </button>
          <button onClick={() => { setState('idle'); setNote(null); }} disabled={busy} className="text-xs text-ink-400 hover:text-ink-200 disabled:opacity-40">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button onClick={() => setState('confirm')} className="btn-outline text-sm px-4 py-2">
      {looksComplete ? 'Mark as done' : 'Review & mark done'}
    </button>
  );
}
