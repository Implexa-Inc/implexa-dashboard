'use client';

/**
 * <FinalizeRecoveredButton /> — salvage a run that DID the work but never
 * reported it.
 *
 * THE CASE (founder hit it twice): a long render heartbeats all the way to a
 * verified deliverable — "VERIFIED: 650.60s → 624.60s, exactly 26.000s cut,
 * SSIM 0.9945, 0 decode errors" — and then the session dies without ever calling
 * record_scheduled_run. The dashboard showed "This run stalled" directly above a
 * trace that plainly said the work was finished, and offered no way out. Runs
 * abandoned before A0 shipped are worse: nothing will ever report their exit, so
 * they sit stalled forever.
 *
 * WHY THIS IS A BUTTON AND NOT AUTOMATIC — the load-bearing decision. A heartbeat
 * is the agent's own unverified claim about itself. Auto-promoting one to a
 * completed run would invent a delivery the user never received, which is the
 * same class of dishonesty as closing an exit-0 run 'completed'. So the user
 * reads the evidence and makes the call; we only surface it. The confirm step is
 * not friction-for-its-own-sake, it is where the authority actually comes from.
 *
 * The server re-checks eligibility (this page may be an hour stale) and records
 * the result as status='partial' + run_close_reason='user_finalized_recovered',
 * so a salvaged run never masquerades as a cleanly delivered one.
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
      // 409 is not a failure the user caused: the run moved on underneath them
      // (the agent reported, or another closer won the race). Refreshing shows
      // them the truth, which is more useful than an error they can't act on.
      if (e instanceof BackendError && e.status === 409) { router.refresh(); return; }
      setState('error');
      setNote(e instanceof Error ? e.message : 'Could not finalize this run.');
    }
  };

  if (state === 'confirm') {
    return (
      <div className="w-full rounded-md border border-emerald-500/40 bg-emerald-500/[0.06] px-3 py-3">
        <p className="text-sm text-ink-200 leading-relaxed">
          This marks the run done using the step trace above as the record. It won’t re-run anything,
          and it won’t invent a result — the run is saved as <span className="text-ink-100">recovered</span>,
          not as a clean delivery.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={finalize} className="btn-primary text-sm px-4 py-2">Yes, mark it done</button>
          <button type="button" onClick={() => setState('idle')} className="btn-outline text-sm px-4 py-2">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setState('confirm')}
        disabled={state === 'busy'}
        className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
      >
        {state === 'busy' ? 'Finalizing…' : 'Review and finalize'}
      </button>
      {/* Hedge the wording when the trace does NOT read as finished. The offer is
          the same either way — the user can see the trace and we should not
          pretend to know better — but the copy must not oversell it. */}
      <p className="text-xs text-ink-500 mt-1.5 leading-snug">
        {looksComplete
          ? 'The last step reported looks like finished work. Marking it done records that.'
          : 'The last step doesn’t clearly say it finished — check the trace above before marking it done.'}
      </p>
      {state === 'error' && note && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{note}</p>}
    </div>
  );
}
