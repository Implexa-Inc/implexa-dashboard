'use client';

/**
 * <ActivationCard /> — the guided activation todo-list (ACTIVATION_JOURNEY.md).
 * One card, one row per step, one CTA per row. Steps the agent doesn't need are
 * already marked done/auto by the backend, so the user only ever sees what's
 * left. Plain language only (no "Bash" / "mcp__…"). Tier-2 permissions are the
 * one place we ask for a deliberate opt-in.
 *
 * Phase 3: renders the checklist + wires the link CTAs (Connections, Schedule)
 * and the local toggles (notifications, Tier-2 opt-in). The final POST /activate
 * lands next; the Activate button reflects readiness today.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { ActivationChecklist, ActivationStep, PermissionItem, PermissionTier } from '@/lib/activation';

// Defined here (not imported) because lib/activation.ts is server-only; a client
// component can take its TYPES (erased at compile) but not its runtime values.
const TIER_PRESENTATION: Record<PermissionTier, { label: string; classes: string }> = {
  0: { label: 'Auto',      classes: 'border-ink-700 text-ink-400' },
  1: { label: 'Heads-up',  classes: 'border-sky-500/40 text-sky-700 dark:text-sky-300' },
  2: { label: 'Your call', classes: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
};

function StatusDot({ status }: { status: ActivationStep['status'] }) {
  if (status === 'done' || status === 'auto') {
    return (
      <span className="flex-none mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs">
        ✓
      </span>
    );
  }
  return <span className="flex-none mt-0.5 inline-flex w-5 h-5 rounded-full border-2 border-ink-600" aria-hidden />;
}

function PermissionList({ items, optIns, onToggle }: {
  items: PermissionItem[];
  optIns: Record<string, boolean>;
  onToggle: (group: string, on: boolean) => void;
}) {
  return (
    <ul className="mt-3 space-y-2 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
      {items.map((it) => {
        const spec = TIER_PRESENTATION[it.tier];
        const isOptIn = it.tier === 2;
        return (
          <li key={it.group} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-100">{it.label}</span>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${spec.classes}`}>{spec.label}</span>
              </div>
              {it.detail && <p className="text-xs text-ink-500 mt-0.5 leading-snug">{it.detail}</p>}
            </div>
            {isOptIn ? (
              <button
                type="button"
                onClick={() => onToggle(it.group, !optIns[it.group])}
                className={`flex-none text-xs font-medium rounded-md px-2.5 py-1 transition-colors ${
                  optIns[it.group]
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200'
                    : 'border border-ink-700 text-ink-400 hover:text-ink-200'
                }`}
              >
                {optIns[it.group] ? 'Allowed' : 'Allow'}
              </button>
            ) : (
              <span className="flex-none text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">granted</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "09:30" (24h, from <input type=time>) -> "9:30am" for the schedule NL the
// backend cron parser understands ("every day at 9:30am").
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
type Mode = 'recurring' | 'once';

// <input type="datetime-local"> emits "2026-06-15T09:00" in the browser's LOCAL
// time. Parse it as local and emit an absolute ISO instant (UTC Z) for fireAt —
// the backend stores the absolute moment and the plugin hands it to
// create_scheduled_task's fireAt verbatim.
function localDatetimeToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// "now" as a datetime-local string, for the input's min (no past one-time runs).
function nowLocalDatetime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Friendly readback of a chosen one-time instant.
function humanizeLocal(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Inline schedule picker — the fix for "Set schedule navigates away". Pick a
 * cadence right here; POST to /agents/:slug/schedule; refresh.
 *
 * Two trigger shapes ship in the UI: RECURRING (cron) and ONE-TIME (fireAt, runs
 * once then auto-disables). CONDITION triggers ("only when X") are deliberately
 * NOT a UI input yet: the gate is enforced in the plugin's /implexa:run-scheduled
 * wrapper, which ships on a plugin release, not this dashboard deploy. Exposing
 * the input before every user's plugin enforces it would let an unmet condition
 * run every time — worse than not offering it. So it stays a "coming next" note.
 */
function SchedulePicker({ slug, onSaved }: { slug: string; onSaved: () => void }) {
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>('recurring');
  const [freq, setFreq] = useState<Freq>('day');
  const [time, setTime] = useState('09:00');
  const [weekday, setWeekday] = useState(1); // Monday
  const [fireAtLocal, setFireAtLocal] = useState('');
  const [saving, setSaving] = useState(false);
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
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let body: Record<string, unknown>;
    if (mode === 'once') {
      const iso = localDatetimeToIso(fireAtLocal);
      if (!iso) { setErr('Pick a date and time for the one-time run.'); return; }
      if (new Date(iso).getTime() <= Date.now()) { setErr('Pick a time in the future.'); return; }
      body = { trigger: 'once', fireAt: iso, timezone };
    } else {
      body = { trigger: 'cron', scheduleNl: buildNl(), timezone };
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/schedule`, {
        jwt, method: 'POST', body,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not set the schedule. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const selectCls = 'bg-ink-900 border border-ink-700 rounded-md text-sm px-2 py-1 text-ink-100';
  const tabCls = (on: boolean) =>
    `text-xs font-medium rounded-md px-2.5 py-1 transition-colors ${
      on ? 'bg-ink-100 text-ink-900' : 'border border-ink-700 text-ink-400 hover:text-ink-200'
    }`;

  return (
    <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/40 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => { setMode('recurring'); setErr(null); }} className={tabCls(mode === 'recurring')}>Recurring</button>
        <button type="button" onClick={() => { setMode('once'); setErr(null); }} className={tabCls(mode === 'once')}>One-time</button>
      </div>

      {mode === 'recurring' ? (
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-500">Run once on</span>
          <input
            type="datetime-local"
            value={fireAtLocal}
            min={nowLocalDatetime()}
            onChange={(e) => setFireAtLocal(e.target.value)}
            className={selectCls}
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className={saving ? 'btn-outline text-xs px-3 py-1.5 opacity-50' : 'btn-success text-xs px-3 py-1.5'}>
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
        <span className="text-xs text-ink-500">
          {mode === 'once'
            ? (fireAtLocal ? `Runs once on ${humanizeLocal(fireAtLocal)}, then turns off.` : 'Pick when it should run once.')
            : `Runs ${buildNl()}.`}
        </span>
        {err && <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span>}
      </div>
      <p className="text-[11px] text-ink-600 leading-snug">Condition triggers (“only when a new file appears”) are coming next.</p>
    </div>
  );
}

function StepRow({ step, slug, optIns, onToggleOptIn, onChanged, defaultOpen }: {
  step: ActivationStep;
  slug: string;
  optIns: Record<string, boolean>;
  onToggleOptIn: (group: string, on: boolean) => void;
  onChanged: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const isTodo = step.status === 'todo';

  // Resolve the CTA target/behavior per step.
  let cta: React.ReactNode = null;
  if (step.id === 'schedule') {
    // Inline picker (the fix): toggle a panel, never navigate away. Available
    // when todo ("Set schedule") and when done ("Change").
    const label = step.status === 'done' ? 'Change' : (step.cta || 'Set schedule');
    cta = <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline text-xs px-2.5 py-1">{open ? 'Hide' : label}</button>;
  } else if (isTodo && step.cta) {
    if (step.id === 'permissions') {
      cta = <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline text-xs px-2.5 py-1">{open ? 'Hide' : step.cta}</button>;
    } else if (step.id === 'connections') {
      cta = <Link href="/connections" className="btn-outline text-xs px-2.5 py-1">{step.cta}</Link>;
    } else {
      cta = <button type="button" className="btn-outline text-xs px-2.5 py-1">{step.cta}</button>;
    }
  }

  const items = (step.data?.items ?? []) as PermissionItem[];

  return (
    <li className="py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <StatusDot status={step.status} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink-100">{step.title}</span>
              {step.status === 'auto' && <span className="text-[10px] uppercase tracking-wide text-ink-500">auto</span>}
            </div>
            <p className="text-xs text-ink-400 mt-0.5 leading-snug">{step.detail}</p>
          </div>
        </div>
        {cta && <div className="flex-none">{cta}</div>}
      </div>
      {step.id === 'permissions' && open && items.length > 0 && (
        <PermissionList items={items} optIns={optIns} onToggle={onToggleOptIn} />
      )}
      {step.id === 'schedule' && open && (
        <SchedulePicker slug={slug} onSaved={() => { setOpen(false); onChanged(); }} />
      )}
    </li>
  );
}

const STATE_BADGE: Record<ActivationChecklist['state'], { label: string; classes: string }> = {
  created:         { label: 'Not activated', classes: 'bg-ink-800 text-ink-300' },
  activating:      { label: 'Activating',    classes: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  active:          { label: 'Active',        classes: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  needs_attention: { label: 'Needs attention', classes: 'bg-amber-500/20 text-amber-700 dark:text-amber-300' },
};

export function ActivationCard({ checklist }: { checklist: ActivationChecklist }) {
  const permStep = checklist.steps.find((s) => s.id === 'permissions');
  const tier2 = ((permStep?.data?.items ?? []) as PermissionItem[]).filter((i) => i.tier === 2);

  // Seed local opt-ins from what's ALREADY granted server-side (item.granted), so
  // granted Tier-2 show "Allowed" and only the ungranted ones need a tap. Without
  // this seed, an already-active agent that needs a new grant looked un-grantable.
  const [optIns, setOptIns] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    for (const i of tier2) if ((i as PermissionItem & { granted?: boolean }).granted) seed[i.group] = true;
    return seed;
  });
  const toggleOptIn = (group: string, on: boolean) => setOptIns((s) => ({ ...s, [group]: on }));

  const router = useRouter();
  const supabase = createClient();
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(checklist.state === 'active');
  const [savedLocally, setSavedLocally] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setError(null);
    setActivating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      await callBackend(`/api/v2/agents/${encodeURIComponent(checklist.slug)}/activate`, {
        jwt, method: 'POST', body: { optIns },
      });
      setActivated(true);
      setSavedLocally(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setActivating(false);
    }
  }

  const allSavedGranted = tier2.every((i) => (i as PermissionItem & { granted?: boolean }).granted) || savedLocally;
  const allLocalGranted = tier2.every((i) => optIns[i.group]); // saved + just-toggled
  const isActive = checklist.state === 'active' || activated;
  // Active, but a Tier-2 grant is still missing -> the wedged "Fix"/needs-you case.
  const needsGrant = isActive && !allSavedGranted;
  const ready = checklist.canActivate && allLocalGranted && !isActive; // initial activation
  const badge = STATE_BADGE[checklist.state];

  return (
    <div className="card max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink-50 truncate">{checklist.name}</h1>
          {checklist.summary && <p className="text-sm text-ink-400 mt-1 leading-snug">{checklist.summary}</p>}
          {checklist.requiresLocal && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-ink-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 flex-none" aria-hidden />
              Runs on your computer, in the Implexa app (not on a server).
            </p>
          )}
        </div>
        <span className={`flex-none text-xs font-medium rounded-full px-2.5 py-1 ${badge.classes}`}>{badge.label}</span>
      </div>

      {checklist.state !== 'active' && (
        <p className="text-xs text-ink-500 mb-1">
          {checklist.stepsLeft === 0 ? 'Ready to switch on.' : `${checklist.stepsLeft} step${checklist.stepsLeft === 1 ? '' : 's'} left`}
        </p>
      )}

      <ul className="divide-y divide-ink-800">
        {checklist.steps.map((s) => (
          <StepRow
            key={s.id}
            step={s}
            slug={checklist.slug}
            optIns={optIns}
            onToggleOptIn={toggleOptIn}
            onChanged={() => router.refresh()}
            defaultOpen={needsGrant && s.id === 'permissions'}
          />
        ))}
      </ul>

      <div className="mt-5 flex items-center gap-3">
        {isActive && allSavedGranted ? (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">✓ Active.</span>
        ) : needsGrant ? (
          // Already active, but a Tier-2 capability still needs your deliberate OK.
          <>
            <button
              type="button"
              onClick={activate}
              disabled={!allLocalGranted || activating}
              className={allLocalGranted && !activating ? 'btn-success' : 'btn-outline opacity-50 cursor-not-allowed'}
              title={allLocalGranted ? 'Save this grant' : 'Allow the permission above first'}
            >
              {activating ? 'Granting…' : 'Grant access'}
            </button>
            {error ? (
              <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
            ) : !allLocalGranted ? (
              <span className="text-xs text-ink-500">Allow the highlighted permission above, then grant.</span>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={activate}
              disabled={!ready || activating}
              className={ready && !activating ? 'btn-success' : 'btn-outline opacity-50 cursor-not-allowed'}
              title={ready ? 'Switch this agent on' : 'Finish the steps above first'}
            >
              {activating ? 'Activating…' : 'Activate'}
            </button>
            {error ? (
              <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
            ) : !ready && tier2.length > 0 && !allLocalGranted ? (
              <span className="text-xs text-ink-500">Allow the highlighted permission first.</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
