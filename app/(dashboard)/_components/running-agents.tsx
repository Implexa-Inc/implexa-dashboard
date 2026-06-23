'use client';

/**
 * <RunningAgents /> — the live "Running" section atop the Agents tab.
 *
 * Polls GET /api/v2/scheduled-skills/live (one card per agent, mapped to the 5
 * product statuses) and renders a pulsing-dot row per agent. Every card links to
 * /runs/[id] — the run page already does the right thing per status (Approve &
 * continue when held, retry when failed, step-trace when running, view when done),
 * which keeps with our principle: status here, action on the run page.
 *
 * Renders nothing when there's no live activity, so it's invisible at rest.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

// The statuses worth a native desktop notification (yellow/red — they need you).
const NOTIFY: ReadonlySet<string> = new Set(['waiting_approval', 'needs_attention', 'failed']);
// Statuses shown in the Home "Alerts" list — the notify set PLUS 'queued', so a
// run you just kicked off appears there for parity with Active Agents (but queued
// is NOT in NOTIFY, so it never fires a noisy desktop notification).
const ALERT_STATUSES: ReadonlySet<string> = new Set([...NOTIFY, 'queued']);

type LiveStatus = 'queued' | 'waiting_approval' | 'needs_attention' | 'running' | 'failed' | 'finished';
type LiveCard = {
  runId: string | null;
  /** Set on a 'queued' card (a pending run_request with no skill_run yet). */
  requestId?: string | null;
  scheduledSkillId: string | null;
  skillSlug: string;
  source: string | null;
  status: LiveStatus;
  since: string | null;
  /** Median duration of this agent's recent completed runs (ms), if known. */
  typicalMs?: number | null;
  /** Run IDENTITY — what THIS run is, from its own output. Primary card label. */
  headline?: string | null;
};

const POLL_MS = 15000;

// Active states (green/amber) show a clean spinner — they're still working or
// waiting on you. Done states (red/grey) stay a static dot. Every card opens the
// run page, so there's no per-status button label — just a chevron.
const STATUS: Record<LiveStatus, { spin: boolean; spinCls: string; dotCls: string; label: string }> = {
  queued:           { spin: true,  spinCls: 'border-sky-500/25 border-t-sky-500',         dotCls: 'bg-sky-500',                 label: 'Waiting to be picked up by your Claude' },
  running:          { spin: true,  spinCls: 'border-emerald-500/25 border-t-emerald-500', dotCls: 'bg-emerald-500',             label: 'Running' },
  waiting_approval: { spin: true,  spinCls: 'border-amber-500/30 border-t-amber-500',     dotCls: 'bg-amber-500',               label: 'Waiting for approval' },
  needs_attention:  { spin: true,  spinCls: 'border-amber-500/30 border-t-amber-500',     dotCls: 'bg-amber-500',               label: 'Needs attention' },
  failed:           { spin: false, spinCls: '',                                           dotCls: 'bg-rose-500',                label: 'Failed' },
  finished:         { spin: false, spinCls: '',                                           dotCls: 'bg-ink-500 dark:bg-ink-400', label: 'Finished' },
};

function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function rel(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtDur(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}
function elapsedMs(iso: string | null): number {
  return iso ? Math.max(0, Date.now() - new Date(iso).getTime()) : 0;
}

export default function RunningAgents({ alertsOnly = false }: { alertsOnly?: boolean } = {}) {
  const supabase = createClient();
  const [cards, setCards] = useState<LiveCard[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Cards the user cleared — shared key with the run detail page's "Hide from
  // alerts". Keyed by runId so a fresh run of the same agent re-appears. A ✕ on
  // FINISHED cards (terminal, safe) dismisses inline; held/failed alerts go
  // through the deliberate detail-page action instead.
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(JSON.parse(localStorage.getItem('implexa:live-cleared') || '[]')); } catch { return new Set(); }
  });
  function dismiss(runId: string) {
    setDismissed((prev) => {
      const next = new Set(prev); next.add(runId);
      try { localStorage.setItem('implexa:live-cleared', JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }
  // Native desktop notifications fire from here (the dashboard runs inside the
  // Electron webview, so the Notification API reaches the OS). We seed on the first
  // poll so pre-existing states don't storm, then notify only on NEW transitions.
  const notified = useRef<Set<string>>(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  function maybeNotify(items: LiveCard[]) {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
    const first = !seeded.current;
    seeded.current = true;
    for (const c of items) {
      if (!NOTIFY.has(c.status) || !c.runId) continue; // queued has no runId; not notifiable anyway
      const rid = c.runId;
      const key = `${rid}:${c.status}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      if (first) continue; // seed only on the first poll — don't notify for what's already there
      try {
        const n = new Notification(c.headline || humanize(c.skillSlug), {
          body: `${humanize(c.skillSlug)} · ${(STATUS[c.status] ?? STATUS.running).label} — tap to open`,
          tag: key,
        });
        n.onclick = () => { try { window.focus(); } catch { /* noop */ } window.location.href = `/runs/${encodeURIComponent(rid)}`; };
      } catch { /* notifications unavailable */ }
    }
  }

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend('/api/v2/scheduled-skills/live', { jwt: session?.access_token });
        if (!alive) return;
        const items = Array.isArray(res?.items) ? (res.items as LiveCard[]) : [];
        setCards(items);
        maybeNotify(items);
      } catch { if (alive) setCards([]); }
    }
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cards) return null;
  // On Home we show only the cards that need you (yellow/red); on the Agents page
  // we show everything live.
  const list = (alertsOnly ? cards.filter((c) => ALERT_STATUSES.has(c.status)) : cards).filter((c) => !(c.runId && dismissed.has(c.runId)));
  if (list.length === 0) return null; // invisible at rest
  const shown = showAll ? list : list.slice(0, 5);

  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-xs font-semibold text-ink-300 uppercase tracking-wide">{alertsOnly ? 'Alerts' : 'Active Agents'} ({list.length})</h2>
      </div>
      <div className="space-y-2">
        {shown.map((c) => {
          const s = STATUS[c.status] ?? STATUS.running;
          // Where the card opens. With a real run row -> the run page (status-aware
          // step-trace / approve / retry). A queued or just-picked-up card has no
          // skill_run yet (it's a pending/consumed run_request, runId null), but the
          // user still wants IN — fall back to the agent page so they can see the
          // chain's steps while it spins up. (Founder hit a running chain card that
          // was dead because the run row wasn't logged yet.)
          const href = c.runId ? `/runs/${encodeURIComponent(c.runId)}` : (c.skillSlug ? `/workflows/${encodeURIComponent(c.skillSlug)}` : null);
          const linkable = !!href;
          const body = (
            <>
              {s.spin ? (
                <span className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${s.spinCls} animate-spin`} aria-hidden="true" />
              ) : (
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dotCls}`} aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                {/* Run IDENTITY first (what THIS run is); agent name drops to the
                    secondary line so two runs of one agent read distinctly. */}
                <div className="text-sm text-ink-100 truncate">{c.headline || humanize(c.skillSlug)}</div>
                <div className="text-[11px] text-ink-500 truncate">
                  {c.headline ? `${humanize(c.skillSlug)} · ` : ''}{s.label}{c.since ? ` · ${rel(c.since)}` : ''}
                  {c.status === 'running' && c.typicalMs ? (
                    elapsedMs(c.since) > c.typicalMs * 1.5 ? (
                      <span className="text-amber-600 dark:text-amber-400"> · longer than usual (~{fmtDur(c.typicalMs)})</span>
                    ) : (
                      <span> · ~{fmtDur(c.typicalMs)} typical</span>
                    )
                  ) : null}
                </div>
              </div>
              {(c.status === 'finished' || c.status === 'failed') && c.runId && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(c.runId!); }}
                  title="Dismiss from alerts"
                  aria-label="Dismiss this run from alerts"
                  className="shrink-0 text-ink-600 hover:text-ink-200 opacity-0 group-hover:opacity-100 transition-opacity text-sm leading-none px-1"
                >
                  ✕
                </button>
              )}
              {linkable && (
                <span className="shrink-0 text-lg leading-none text-ink-500 group-hover:text-ink-200 transition-colors" aria-hidden="true">›</span>
              )}
            </>
          );
          const key = c.runId || c.requestId || c.skillSlug;
          const cls = 'group flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-950/40 px-4 py-3';
          return linkable ? (
            <Link key={key} href={href!} className={`${cls} hover:border-ink-700 transition-colors`}>
              {body}
            </Link>
          ) : (
            <div key={key} className={cls}>{body}</div>
          );
        })}
      </div>
      {list.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-ink-500 hover:text-ink-300 mt-2"
        >
          {showAll ? 'Show less' : `Load more (${list.length - 5})`}
        </button>
      )}
    </section>
  );
}
