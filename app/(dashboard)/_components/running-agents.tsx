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

type LiveStatus = 'waiting_approval' | 'needs_attention' | 'running' | 'failed' | 'finished';
type LiveCard = {
  runId: string;
  scheduledSkillId: string | null;
  skillSlug: string;
  source: string | null;
  status: LiveStatus;
  since: string | null;
};

const POLL_MS = 15000;

const STATUS: Record<LiveStatus, { dot: string; pulse: boolean; label: string; cta: string }> = {
  running:          { dot: 'bg-emerald-500',                pulse: true,  label: 'Running',              cta: 'Watch' },
  waiting_approval: { dot: 'bg-amber-500',                  pulse: true,  label: 'Waiting for approval', cta: 'Approve & continue' },
  needs_attention:  { dot: 'bg-amber-500',                  pulse: true,  label: 'Needs attention',      cta: 'Open' },
  failed:           { dot: 'bg-rose-500',                   pulse: false, label: 'Failed',               cta: 'View' },
  finished:         { dot: 'bg-ink-500 dark:bg-ink-400',    pulse: false, label: 'Finished',             cta: 'View result' },
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

export default function RunningAgents() {
  const supabase = createClient();
  const [cards, setCards] = useState<LiveCard[] | null>(null);
  const [showAll, setShowAll] = useState(false);
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
      if (!NOTIFY.has(c.status)) continue;
      const key = `${c.runId}:${c.status}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      if (first) continue; // seed only on the first poll — don't notify for what's already there
      try {
        const n = new Notification(`Implexa · ${humanize(c.skillSlug)}`, {
          body: `${(STATUS[c.status] ?? STATUS.running).label} — tap to open`,
          tag: key,
        });
        n.onclick = () => { try { window.focus(); } catch { /* noop */ } window.location.href = `/runs/${encodeURIComponent(c.runId)}`; };
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

  if (!cards || cards.length === 0) return null; // invisible at rest
  const shown = showAll ? cards : cards.slice(0, 5);

  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-xs font-semibold text-ink-300 uppercase tracking-wide">Running</h2>
        <span className="text-xs text-ink-500">{cards.length}</span>
      </div>
      <div className="space-y-2">
        {shown.map((c) => {
          const s = STATUS[c.status] ?? STATUS.running;
          return (
            <Link
              key={c.runId}
              href={`/runs/${encodeURIComponent(c.runId)}`}
              className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-950/40 px-4 py-3 hover:border-ink-700 transition-colors"
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                {s.pulse && <span className={`absolute inline-flex h-full w-full rounded-full ${s.dot} opacity-60 animate-ping`} />}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${s.dot}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink-100 truncate">{humanize(c.skillSlug)}</div>
                <div className="text-[11px] text-ink-500">
                  {s.label}{c.since ? ` · ${rel(c.since)}` : ''}
                </div>
              </div>
              <span className="text-xs text-brand-500 shrink-0 whitespace-nowrap">{s.cta} →</span>
            </Link>
          );
        })}
      </div>
      {cards.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-ink-500 hover:text-ink-300 mt-2"
        >
          {showAll ? 'Show less' : `Load more (${cards.length - 5})`}
        </button>
      )}
    </section>
  );
}
