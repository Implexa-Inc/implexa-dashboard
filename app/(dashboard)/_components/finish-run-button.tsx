'use client';

/**
 * <FinishRunButton /> — the one-tap "finish a partial run" affordance.
 *
 * A run that stopped MID-PIPELINE (e.g. b-roll done, but the avatar render +
 * compositing still to do) records as "delivered" with the remaining steps buried
 * in prose — the user is left with "no clue how to continue" (founder hit this).
 * When the page detects that remaining-steps/blocked structure, it shows this:
 * one tap queues a kind='continue' that picks up from the deliverable and does the
 * rest, hands-off. Same machinery as the changes box — just zero typing for the
 * common "just finish it" case.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

const FINISH_PROMPT =
  "Continue from this run's deliverable and complete ALL the remaining / blocked steps to finish it end-to-end " +
  '(e.g. generate the avatar/video, run the renders, composite, and produce the final output). ' +
  "Use what's already done as the starting point — do NOT redo finished work. If a step genuinely can't run " +
  '(a missing tool or input), do everything else and clearly say what is left.';

export default function FinishRunButton({
  runId,
  mode = 'finish',
}: {
  runId: string;
  mode?: 'finish' | 'approval-recovery';
}) {
  const supabase = createClient();
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');

  async function finish() {
    if (state === 'busy') return;
    setState('busy');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token, method: 'POST',
        body: mode === 'approval-recovery'
          ? { kind: 'continue', runId, approvalRecovery: true, source: 'dashboard' }
          : { kind: 'continue', runId, note: FINISH_PROMPT, source: 'dashboard' },
      });
      // Land on Active Agents so the user SEES it spin up (parity with Run-now).
      router.push('/workflows'); router.refresh();
    } catch {
      setState('error');
    }
  }

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm text-ink-100 font-medium">
            {mode === 'approval-recovery' ? 'Your review is ready.' : 'This run isn’t finished yet.'}
          </p>
          <p className="text-xs text-ink-400 mt-0.5">
            {mode === 'approval-recovery'
              ? 'Approve the recorded plan and continue from the next step. Finished work will be reused.'
              : 'It did part of the work and left the rest. Finish it in one tap — no typing.'}
          </p>
        </div>
        <button type="button" onClick={finish} disabled={state === 'busy'}
          className="btn-success text-sm px-4 py-2 disabled:opacity-60 flex-none">
          {state === 'busy' ? 'Queuing…' : mode === 'approval-recovery' ? 'Approve & continue' : 'Finish this run'}
        </button>
      </div>
      {state === 'error' && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">Could not queue it. Try again.</p>}
    </div>
  );
}
