'use client';

/**
 * <BuildingAgents /> — live status for the "Build an agent" box, shown directly
 * BELOW it. A build is a kind='build' run_request the runner drains; this polls
 * GET /api/v2/me/build-status and renders one card per in-flight build with its
 * real lifecycle (queued → building → built), the same run-based live treatment
 * as <RunningAgents />. Replaces the static "Queued. Your agent will appear…"
 * line with something that actually moves. Invisible when nothing is building.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Phase = 'queued' | 'building' | 'built';
type Build = {
  id: string;
  phase: Phase;
  intent: string;
  createdAt: string | null;
  consumedAt: string | null;
  doneAt: string | null;
  workflowSlug: string | null;
};

const POLL_MS = 4000;

function rel(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const COPY: Record<Phase, { title: string; sub: string }> = {
  queued:   { title: 'Queued', sub: 'Waiting for the runner to pick it up' },
  building: { title: 'Building your agent', sub: 'The runner is composing the steps' },
  built:    { title: 'Built', sub: 'Your agent is ready' },
};

export default function BuildingAgents() {
  const supabase = createClient();
  const [builds, setBuilds] = useState<Build[] | null>(null);
  // Built cards the user cleared (so a finished build doesn't linger past its
  // 5-min server window). Keyed by request id.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const tick = useRef(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend('/api/v2/me/build-status', { jwt: session?.access_token });
        if (!alive) return;
        setBuilds(Array.isArray(res?.builds) ? (res.builds as Build[]) : []);
      } catch { if (alive) setBuilds([]); }
    }
    load();
    const t = setInterval(() => { tick.current += 1; load(); }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!builds) return null;
  const list = builds.filter((b) => !dismissed.has(b.id));
  if (list.length === 0) return null;

  return (
    <section className="mt-3 space-y-2">
      {list.map((b) => {
        const c = COPY[b.phase];
        const done = b.phase === 'built';
        return (
          <div
            key={b.id}
            className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-950/40 px-4 py-3"
          >
            {done ? (
              <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500 flex items-center justify-center text-[9px] text-ink-950" aria-hidden="true">✓</span>
            ) : (
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink-100 truncate">
                {c.title}{b.intent ? <span className="text-ink-400 font-normal">: {b.intent}</span> : ''}
              </div>
              <div className="text-[11px] text-ink-500">
                {c.sub}
                {b.phase === 'building' && b.consumedAt ? ` · ${rel(b.consumedAt)}` : ''}
                {b.phase === 'queued' && b.createdAt ? ` · queued ${rel(b.createdAt)} ago` : ''}
              </div>
            </div>
            {done ? (
              <div className="flex items-center gap-2 shrink-0">
                <Link href={b.workflowSlug ? `/agents/${encodeURIComponent(b.workflowSlug)}` : '/agents'} className="btn-success text-xs px-3 py-1.5">
                  {b.workflowSlug ? 'Open agent' : 'See your agents'}
                </Link>
                <button
                  type="button"
                  onClick={() => setDismissed((p) => new Set(p).add(b.id))}
                  aria-label="Dismiss"
                  className="text-ink-600 hover:text-ink-200 text-sm leading-none px-1"
                >
                  ✕
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
