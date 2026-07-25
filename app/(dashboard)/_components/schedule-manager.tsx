'use client';

/**
 * <ScheduleManager /> — inline schedule control on the agent Overview card.
 *
 * WHY (2026-07-23 UX bug): the Schedule card's only affordance was a "manage"
 * link that navigated to the ACTIVATION page — so changing "daily at 12pm" meant
 * leaving the agent, and once there the editor opened on a hard-coded 9am default
 * (it never hydrated from the real cron), and there was NO way to drop the clock
 * back to on-demand at all. This puts edit / pause / make-on-demand right on the
 * card, and opens the editor pre-filled with the ACTUAL schedule.
 *
 * Reuses the exact existing pipes — no new backend:
 *   • edit    → <SchedulePicker> POST /api/v2/agents/:slug/schedule (setAgentSchedule
 *               REPLACES any existing routine, so an edit can't duplicate it)
 *   • pause   → scheduled_skills.update({ status }) — same RLS write as /scheduled
 *   • on-demand → scheduled_skills.delete() — same removal as /scheduled's Delete;
 *               the agent keeps its on_demand home row and runs only via Run now.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { SchedulePicker, type SchedulePickerInitial } from './activation-card';
import { cronToPickerState, isPausableRoutine } from '@/lib/schedule-trigger';

type Routine = {
  id: string;
  schedule_nl: string;
  cron_expression: string | null;
  trigger_type?: string | null;
  fire_at?: string | null;
  status: 'active' | 'paused' | 'failed';
  claude_task_id: string | null;
};

// Map a routine's stored cron into the picker's opening state (null → defaults).
function initialFor(routine: Routine | null): SchedulePickerInitial | undefined {
  if (!routine) return undefined;
  const st = cronToPickerState(routine.cron_expression);
  if (!st) return { mode: 'recurring' };
  return { mode: 'recurring', freq: st.freq, time: st.time, weekday: st.weekday };
}

export default function ScheduleManager({
  slug,
  agentName,
  routine,
}: {
  slug: string;
  agentName: string;
  routine: Routine | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'pause' | 'resume' | 'ondemand' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasClock = !!routine && isPausableRoutine(routine);

  async function setStatus(next: 'active' | 'paused') {
    if (!routine) return;
    setErr(null);
    setBusy(next === 'active' ? 'resume' : 'pause');
    const { error } = await supabase
      .from('scheduled_skills')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', routine.id);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  async function makeOnDemand() {
    if (!routine) return;
    if (!confirm(`Run "${agentName}" on demand only? This drops the schedule — it stays active and runs only when you click Run now. Past output stays in Runs.`)) return;
    setErr(null);
    setBusy('ondemand');
    // Go through the backend, NOT a raw scheduled_skills.delete(): deleting the row
    // would de-activate the agent (activation_state lives on it) and orphan a Claude
    // native task (a DELETE can't set claude_task_dirty). setAgentSchedule(trigger:
    // 'on_demand') converts in place, keeps the agent active, and flags the Claude
    // task for the desktop to disable.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/schedule`, {
        jwt: session?.access_token,
        method: 'POST',
        body: { trigger: 'on_demand' },
      });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not switch to on-demand. Try again.');
    } finally {
      setBusy(null);
    }
  }

  function onSaved() {
    setEditing(false);
    router.refresh();
  }

  const btn = 'text-xs px-2.5 py-1 rounded-md border border-ink-700 text-ink-300 hover:text-ink-100 hover:border-ink-500 transition-colors disabled:opacity-50';

  // No clock: on-demand agent. Offer to add a schedule inline (no navigation).
  if (!hasClock) {
    return (
      <div>
        <p className="text-sm text-ink-500">
          Runs on-demand (the Run now button above){editing ? '.' : ' — no automatic schedule yet.'}
        </p>
        {editing ? (
          <>
            <SchedulePicker slug={slug} onSaved={onSaved} />
            <button type="button" onClick={() => { setEditing(false); setErr(null); }} className={`${btn} mt-2`}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className={`${btn} mt-2`}>
            Add a schedule
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-ink-200 text-sm">{routine!.schedule_nl}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
          routine!.status === 'active'
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
            : routine!.status === 'paused'
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
        }`}>{routine!.status}</span>
      </div>

      {editing ? (
        <SchedulePicker slug={slug} onSaved={onSaved} initial={initialFor(routine)} />
      ) : (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setEditing(true)} className={btn}>Edit schedule</button>
          {routine!.status === 'active' && (
            <button type="button" onClick={() => setStatus('paused')} disabled={busy === 'pause'} className={btn}>
              {busy === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
          )}
          {routine!.status === 'paused' && (
            <button type="button" onClick={() => setStatus('active')} disabled={busy === 'resume'} className={btn}>
              {busy === 'resume' ? 'Resuming…' : 'Resume'}
            </button>
          )}
          <button type="button" onClick={makeOnDemand} disabled={busy === 'ondemand'} className={btn}>
            {busy === 'ondemand' ? 'Removing…' : 'Make on-demand'}
          </button>
        </div>
      )}

      {editing && (
        <button type="button" onClick={() => { setEditing(false); setErr(null); }} className={`${btn} mt-2`}>
          Cancel
        </button>
      )}
      {err && <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">{err}</p>}

      {/* Undocumented Claude route (verified 2026-06-12) — keep beside the inline controls. */}
      {routine!.claude_task_id && (
        <a
          href={`claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(routine!.claude_task_id)}`}
          className="text-xs text-brand-500 hover:underline mt-2 inline-block"
          title="Opens this routine in the Claude desktop app (toggle, history, Run now)."
        >
          Open in Claude ↗
        </a>
      )}
    </div>
  );
}
