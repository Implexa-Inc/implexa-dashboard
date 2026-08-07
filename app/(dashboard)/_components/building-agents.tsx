'use client';

/**
 * <BuildingAgents /> — live status for the "Build an agent" box, shown directly
 * BELOW it. A build is a kind='build' run_request the drainer picks up; this
 * polls GET /api/v2/me/build-status and renders one card per build with its
 * REAL lifecycle.
 *
 * What this used to show, and why it was wrong (founder, 2026-08-06): three
 * phases, queued → building → built, where "building" was derived from a
 * `consumed_at` stamp nothing ever wrote for a build. So every build sat on
 * "Queued" and then jumped straight to "Built" — the user could not tell a
 * claimed request from an untouched one, a running worker from a dead queue, or
 * (worst) a real build from one the drain gave up on, since the give-up path
 * closes the request `done` and `done` was rendered as success.
 *
 * The phase now comes from the server's canonical derivation
 * (implexa-backend lib/run-request-lifecycle) — six states, never re-derived
 * here — and every card carries its `lifecycle[]` so a build that flashes
 * through claimed/running in two seconds still SHOWS that it did, on first
 * render and after a reload. Fast is not the same as never happened.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

/** Canonical vocabulary. Mirrors the CHECK in migration 0160 — do not extend locally. */
type Phase = 'queued' | 'claimed' | 'starting' | 'running' | 'verifying' | 'built' | 'start_failed' | 'claim_expired' | 'failed' | 'cancelled';

type LifecycleEvent = {
  event: Phase;
  at: string | null;
  actor: string | null;
  executor: string | null;
  detail: string | null;
};

type Build = {
  id: string;
  phase: Phase;
  intent: string;
  queuedAt: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  worker: string | null;
  executor: string | null;
  attempt: number;
  lifecycle: LifecycleEvent[];
  workflowSlug: string | null;
};

const POLL_MS = 4000;

/** Terminal phases stop the spinner and stop the elapsed clock. */
const TERMINAL: ReadonlySet<Phase> = new Set(['built', 'start_failed', 'claim_expired', 'failed', 'cancelled']);

function rel(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function clock(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

const COPY: Record<Phase, { title: string; sub: string }> = {
  queued:    { title: 'Queued',       sub: 'Waiting for a worker to pick it up' },
  claimed:   { title: 'Picked Up',    sub: 'A worker claimed it and is starting' },
  starting:  { title: 'Starting executor', sub: 'Waiting for the local process to acknowledge startup' },
  running:   { title: 'Building',     sub: 'The worker is composing the steps' },
  verifying: { title: 'Verifying',    sub: 'The build finished; checking the saved agent' },
  built:     { title: 'Built',        sub: 'Your agent is ready' },
  failed:    { title: 'Failed',       sub: 'The build did not finish' },
  start_failed: { title: 'Start failed', sub: 'The selected executor could not start' },
  claim_expired: { title: 'Claim expired', sub: 'No process acknowledged this claim before its deadline' },
  cancelled: { title: 'Cancelled',    sub: 'This build was cancelled' },
};

/** Short label for a completed stage in the history strip. */
const STEP_LABEL: Record<Phase, string> = {
  queued: 'Queued',
  claimed: 'Picked up',
  starting: 'Starting',
  running: 'Running',
  verifying: 'Verifying',
  built: 'Built',
  failed: 'Failed',
  start_failed: 'Start failed',
  claim_expired: 'Claim expired',
  cancelled: 'Cancelled',
};

function phaseDot(phase: Phase): string {
  if (phase === 'built') return 'bg-emerald-500';
  if (phase === 'failed' || phase === 'start_failed') return 'bg-rose-500';
  if (phase === 'claim_expired') return 'bg-amber-500';
  if (phase === 'cancelled') return 'bg-ink-600';
  return 'bg-amber-500';
}

/**
 * The elapsed-time suffix for the CURRENT phase. Anchored on that phase's own
 * stamp so "Picked Up · 12s" means 12s since the claim, not since the ask —
 * a claim that has been sitting for 4 minutes without starting is exactly the
 * thing the old UI could not tell you.
 */
function anchorFor(b: Build): string | null {
  if (b.phase === 'running') return b.startedAt;
  if (b.phase === 'claimed') return b.claimedAt;
  if (b.phase === 'starting') return b.claimedAt;
  if (b.phase === 'queued') return b.queuedAt;
  return null;
}

export default function BuildingAgents() {
  const supabase = createClient();
  const [builds, setBuilds] = useState<Build[] | null>(null);
  // Distinguish "the queue is empty" from "we could not read it". Rendering an
  // unavailable read as an empty list is how a broken surface passes for a calm
  // one — the backend now 503s rather than returning [] for the same reason.
  const [unavailable, setUnavailable] = useState(false);
  // Cards the user cleared, keyed by request id.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Cards whose lifecycle history is expanded.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tick = useRef(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend('/api/v2/me/build-status', { jwt: session?.access_token });
        if (!alive) return;
        if (res && res.ok === false) { setUnavailable(true); return; }
        setUnavailable(false);
        setBuilds(Array.isArray(res?.builds) ? (res.builds as Build[]) : []);
      } catch {
        // Keep the last known list rather than blanking it — a single failed
        // poll must not make in-flight builds appear to vanish.
        if (alive) setUnavailable(true);
      }
    }
    load();
    const t = setInterval(() => { tick.current += 1; load(); }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (unavailable && !builds) {
    return (
      <section className="mt-3">
        <div className="rounded-lg border border-ink-800 bg-ink-950/40 px-4 py-3 text-[11px] text-ink-500">
          Couldn’t load build status. Retrying…
        </div>
      </section>
    );
  }
  if (!builds) return null;
  const list = builds.filter((b) => !dismissed.has(b.id));
  if (list.length === 0) return null;

  return (
    <section className="mt-3 space-y-2">
      {list.map((b) => {
        const c = COPY[b.phase] || COPY.queued;
        const done = TERMINAL.has(b.phase);
        const anchor = anchorFor(b);
        // The history strip is the point: even a two-second build must be able
        // to show that it was queued, claimed, ran, and finished.
        const history = (b.lifecycle || []).filter((e) => e.at);
        const expanded = open.has(b.id);
        return (
          <div
            key={b.id}
            className="rounded-lg border border-ink-800 bg-ink-950/40 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              {b.phase === 'built' ? (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500 flex items-center justify-center text-[9px] text-ink-950" aria-hidden="true">✓</span>
              ) : (b.phase === 'failed' || b.phase === 'start_failed') ? (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-rose-500 flex items-center justify-center text-[9px] text-ink-950" aria-hidden="true">!</span>
              ) : b.phase === 'cancelled' ? (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-ink-600" aria-hidden="true" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink-100 truncate">
                  {c.title}{b.intent ? <span className="text-ink-400 font-normal">: {b.intent}</span> : ''}
                </div>
                <div className="text-[11px] text-ink-500">
                  {/* A failure states its reason. "Failed" with no actionable
                      next step is barely better than the false "Built" it
                      replaces. */}
                  {(b.phase === 'failed' || b.phase === 'start_failed' || b.phase === 'claim_expired') ? (b.failureReason || c.sub) : c.sub}
                  {anchor ? ` · ${rel(anchor)}` : ''}
                  {/* Name the worker once one exists, so "Picked Up" is a claim
                      the user can check rather than one they have to trust. */}
                  {b.executor && b.phase !== 'queued' ? ` · ${b.executor}` : ''}
                  {b.attempt > 1 ? ` · attempt ${b.attempt}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {history.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setOpen((p) => {
                      const n = new Set(p);
                      if (n.has(b.id)) n.delete(b.id); else n.add(b.id);
                      return n;
                    })}
                    aria-expanded={expanded}
                    className="text-[11px] text-ink-500 hover:text-ink-200 px-1"
                  >
                    {expanded ? 'Hide steps' : 'Steps'}
                  </button>
                ) : null}
                {b.phase === 'built' ? (
                  <Link href={b.workflowSlug ? `/workflows/${encodeURIComponent(b.workflowSlug)}` : '/workflows'} className="btn-success text-xs px-3 py-1.5">
                    {b.workflowSlug ? 'Review agent' : 'See your agents'}
                  </Link>
                ) : null}
                {done ? (
                  <button
                    type="button"
                    onClick={() => setDismissed((p) => new Set(p).add(b.id))}
                    aria-label="Dismiss"
                    className="text-ink-600 hover:text-ink-200 text-sm leading-none px-1"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            </div>

            {expanded && history.length > 0 ? (
              <ol className="mt-3 border-t border-ink-800/70 pt-2 space-y-1">
                {history.map((e, i) => (
                  <li key={`${e.event}-${e.at}-${i}`} className="flex items-baseline gap-2 text-[11px]">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${phaseDot(e.event)}`} aria-hidden="true" />
                    <span className="text-ink-300 w-20 shrink-0">{STEP_LABEL[e.event] || e.event}</span>
                    <span className="text-ink-500 tabular-nums">{clock(e.at)}</span>
                    {e.detail ? <span className="text-ink-500 truncate">— {e.detail}</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
