'use client';

/**
 * <RunsCalendar /> — Runs as calendar-based activities (the redesign's Runs view).
 *
 * A navigable month grid: each day with runs shows an activity dot (red if any
 * failed, amber if any held/stalled, else green) + a count. Clicking a day lists
 * that day's runs below; each row links to /runs/[id] for the full deliverable.
 * Fed a lightweight run list from the server page (no output_markdown).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

export type CalRun = {
  id: string;
  skillSlug: string;
  status: string | null;
  runState: string | null;
  reviewStatus: string | null;
  ranAt: string;
  source: string | null;
};

type Tone = 'failed' | 'attention' | 'ok';

function runTone(r: CalRun): Tone {
  if (r.status === 'failed' || r.runState === 'failed') return 'failed';
  if (r.runState === 'stalled' || r.reviewStatus === 'pending') return 'attention';
  return 'ok';
}

const DOT: Record<Tone, string> = {
  failed: 'bg-rose-500',
  attention: 'bg-amber-500',
  ok: 'bg-emerald-500',
};
const RANK: Record<Tone, number> = { failed: 3, attention: 2, ok: 1 };

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function RunsCalendar({ runs }: { runs: CalRun[] }) {
  // Group runs by local day.
  const byDay = useMemo(() => {
    const m = new Map<string, CalRun[]>();
    for (const r of runs) {
      const key = ymd(new Date(r.ranAt));
      (m.get(key) ?? m.set(key, []).get(key)!).push(r);
    }
    return m;
  }, [runs]);

  // Default the view + selection to the most recent run's day (else today).
  const latest = runs.length ? new Date(runs[0].ranAt) : new Date();
  const [view, setView] = useState({ y: latest.getFullYear(), m: latest.getMonth() });
  const [selected, setSelected] = useState<string | null>(runs.length ? ymd(latest) : null);

  const first = new Date(view.y, view.m, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.y, view.m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = ymd(new Date());
  const selectedRuns = selected ? (byDay.get(selected) ?? []) : [];

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  return (
    <div>
      {/* Month header */}
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={() => shiftMonth(-1)} className="text-ink-400 hover:text-ink-100 px-2 py-1 rounded hover:bg-ink-800" aria-label="Previous month">◀</button>
        <div className="text-sm font-medium text-ink-100">{MONTHS[view.m]} {view.y}</div>
        <button type="button" onClick={() => shiftMonth(1)} className="text-ink-400 hover:text-ink-100 px-2 py-1 rounded hover:bg-ink-800" aria-label="Next month">▶</button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-[10px] uppercase tracking-wide text-ink-500 py-1">{w}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const key = ymd(date);
          const dayRuns = byDay.get(key) ?? [];
          const worst = dayRuns.reduce<Tone>((acc, r) => (RANK[runTone(r)] > RANK[acc] ? runTone(r) : acc), 'ok');
          const isSel = selected === key;
          const isToday = key === todayKey;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(key)}
              className={`aspect-square rounded-md flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                isSel ? 'bg-brand-500/15 border border-brand-500/50' : 'border border-transparent hover:bg-ink-800'
              } ${isToday && !isSel ? 'ring-1 ring-ink-600' : ''}`}
            >
              <span className={dayRuns.length ? 'text-ink-100' : 'text-ink-500'}>{date.getDate()}</span>
              {dayRuns.length > 0 && (
                <span className="flex items-center gap-0.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT[worst]}`} />
                  {dayRuns.length > 1 && <span className="text-[9px] text-ink-500">{dayRuns.length}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day's runs */}
      <div className="mt-6">
        {selected && (
          <div className="text-xs text-ink-400 mb-2">
            {new Date(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}{selectedRuns.length} run{selectedRuns.length === 1 ? '' : 's'}
          </div>
        )}
        {selectedRuns.length === 0 ? (
          <p className="text-sm text-ink-500 italic">No runs on this day.</p>
        ) : (
          <ul className="space-y-2">
            {selectedRuns.map((r) => {
              const t = runTone(r);
              return (
                <Link
                  key={r.id}
                  href={`/runs/${encodeURIComponent(r.id)}`}
                  className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-950/40 px-4 py-2.5 hover:border-ink-700 transition-colors"
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${DOT[t]}`} aria-hidden="true" />
                  <span className="text-sm text-ink-100 truncate flex-1">{r.skillSlug.replace(/[-_]+/g, ' ')}</span>
                  {r.reviewStatus === 'pending' && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">held</span>
                  )}
                  <span className="text-xs text-ink-500 shrink-0">{timeOf(r.ranAt)}</span>
                </Link>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
