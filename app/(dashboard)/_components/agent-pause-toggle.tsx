'use client';

/**
 * <AgentPauseToggle /> , Pause / Resume one agent's routine from its page.
 *
 * Pause is a direct RLS-scoped update of scheduled_skills.status (same path as
 * the /scheduled row). It genuinely pauses the loop, not just the label: when
 * the cron next fires, run-scheduled calls get_scheduled_skill_payload, sees
 * `paused`, and silently exits , so the work stops even though the underlying
 * scheduled-task keeps ticking (it just no-ops until you Resume).
 *
 * Optimistic flip with rollback on error, mirroring schedule-row.tsx.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function AgentPauseToggle({
  routineId,
  initialStatus,
}: {
  routineId: string;
  initialStatus: 'active' | 'paused' | 'failed';
}) {
  const supabase = createClient();
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(next: 'active' | 'paused') {
    setError(null);
    setPending(true);
    const prev = status;
    setStatus(next); // optimistic
    const { error: updErr } = await supabase
      .from('scheduled_skills')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', routineId);
    if (updErr) {
      setStatus(prev);
      setError(updErr.message);
    } else {
      router.refresh();
    }
    setPending(false);
  }

  // A failed routine isn't pause/resume-able here , it needs a re-activation.
  if (status === 'failed') return null;

  return (
    <div className="inline-flex flex-col items-end gap-1">
      {status === 'active' ? (
        <button
          type="button"
          onClick={() => patch('paused')}
          disabled={pending}
          className="text-sm px-3.5 py-2 rounded-md border border-ink-700 text-ink-200 hover:bg-ink-800 disabled:opacity-50 transition-colors"
          title="Stop this agent's scheduled runs until you resume it."
        >
          {pending ? 'Pausing…' : 'Pause'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => patch('active')}
          disabled={pending}
          className="text-sm px-3.5 py-2 rounded-md border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
          title="Resume this agent's schedule."
        >
          {pending ? 'Resuming…' : 'Resume schedule'}
        </button>
      )}
      {status === 'paused' && !error && (
        <span className="text-[11px] text-amber-700 dark:text-amber-400 max-w-[220px] text-right">
          Paused. No runs until resumed. Claude&apos;s Routines updates next time Claude is open.
        </span>
      )}
      {error && <span className="text-[11px] text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
  );
}
