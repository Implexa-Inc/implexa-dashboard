'use client';

/**
 * <MakeRecurring /> — the post-run nudge to turn a one-off agent into a routine.
 *
 * Shown under a completed run whose agent has NO recurring schedule (it ran on
 * demand). The whole point of Implexa is hands-off recurring work, so once an
 * on-demand agent has proven itself with one good run, offer to put it on a
 * clock right here instead of making the user go find the activation screen.
 *
 * Reuses the SAME backend pipe as the activation card's inline picker
 * (POST /api/v2/agents/:slug/schedule, trigger='cron') — this is purely a more
 * convenient surface for it, not a new scheduling path. One tap on a preset
 * cadence (or a custom day/time) registers the routine; the drainer + the
 * scheduled-tasks runtime own the actual firing, exactly as activation does.
 *
 * Renders nothing once a schedule is saved (the card collapses to a confirmation).
 */

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { ensureScheduleReadinessAfterSave } from '@/lib/schedule-readiness';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "09:30" (24h) -> "9:30am" for the backend's schedule-NL cron parser. Mirrors
// to12h in activation-card.tsx (same parser on the other end).
function to12h(hhmm: string): string {
  const [hStr, mStr] = (hhmm || '09:00').split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  const ampm = h < 12 ? 'am' : 'pm';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

type Freq = 'day' | 'weekday' | 'week' | 'hour';

export default function MakeRecurring({ slug, agentName }: { slug: string; agentName: string }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [freq, setFreq] = useState<Freq>('week');
  const [time, setTime] = useState('09:00');
  const [weekday, setWeekday] = useState(1); // Monday
  const [saving, setSaving] = useState(false);
  const [savedNl, setSavedNl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function buildNl(): string {
    const t = to12h(time);
    if (freq === 'hour') return 'every hour';
    if (freq === 'weekday') return `every weekday at ${t}`;
    if (freq === 'week') return `every ${WEEKDAYS[weekday].toLowerCase()} at ${t}`;
    return `every day at ${t}`;
  }

  async function save() {
    setErr(null);
    setSaving(true);
    const nl = buildNl();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/schedule`, {
        jwt: session?.access_token,
        method: 'POST',
        body: { trigger: 'cron', scheduleNl: nl, timezone },
      });
      void ensureScheduleReadinessAfterSave();
      setSavedNl(nl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not set the schedule. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (savedNl) {
    return (
      <section className="mt-6 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.07] p-4">
        <div className="text-sm text-ink-100">
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ {agentName} is now recurring</span>
          {' — '}runs {savedNl}. You don&apos;t need to start it; results land on your home as they come in.
        </div>
        <Link
          href={`/workflows/${encodeURIComponent(slug)}/activate`}
          className="text-xs text-brand-500 hover:underline mt-1.5 inline-block"
        >
          Change the schedule →
        </Link>
      </section>
    );
  }

  const selectCls = 'bg-ink-900 border border-ink-700 rounded-md text-sm px-2 py-1 text-ink-100';

  return (
    <section className="mt-6 rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-100">Want this to run on its own?</div>
          <div className="text-xs text-ink-400 mt-0.5">
            This ran on demand. Put {agentName} on a schedule and it&apos;ll deliver hands-off — no need to start it each time.
          </div>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="btn-success text-xs px-3 py-1.5 shrink-0">
            Make it recurring
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={freq} onChange={(e) => setFreq(e.target.value as Freq)} className={selectCls}>
            <option value="day">Every day</option>
            <option value="weekday">Every weekday</option>
            <option value="week">Weekly</option>
            <option value="hour">Every hour</option>
          </select>
          {freq === 'week' && (
            <select value={weekday} onChange={(e) => setWeekday(parseInt(e.target.value, 10))} className={selectCls}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          )}
          {freq !== 'hour' && (
            <>
              <span className="text-sm text-ink-500">at</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={selectCls} />
            </>
          )}
          <button type="button" onClick={save} disabled={saving} className={saving ? 'btn-outline text-xs px-3 py-1.5 opacity-50' : 'btn-success text-xs px-3 py-1.5'}>
            {saving ? 'Saving…' : `Run ${buildNl()}`}
          </button>
          {err && <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span>}
        </div>
      )}
    </section>
  );
}
