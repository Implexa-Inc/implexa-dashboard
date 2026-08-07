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
import { parseLiveItems } from '@/lib/live-feed';
import { queuedWaitNotice } from '@/lib/queued-wait-copy';
import Modal from './modal';
import StuckRunButton from './stuck-run-button';

// The statuses worth a native desktop notification (yellow/red — they need you).
// action_available = a delivered run has a READY one-tap action (publish, etc.).
const NOTIFY: ReadonlySet<string> = new Set(['waiting_approval', 'needs_attention', 'start_failed', 'claim_expired', 'failed', 'action_available']);
// Statuses shown in the Home "Alerts" list — the notify set PLUS 'queued', so a
// run you just kicked off appears there for parity with Active Agents (but queued
// is NOT in NOTIFY, so it never fires a noisy desktop notification).
const ALERT_STATUSES: ReadonlySet<string> = new Set([...NOTIFY, 'queued']);

type LiveStatus = 'queued' | 'picked_up' | 'starting' | 'start_failed' | 'claim_expired' | 'waiting_approval' | 'needs_attention' | 'running' | 'verifying' | 'built' | 'failed' | 'finished' | 'action_available';
type LiveCard = {
  runId: string | null;
  /** Set on a 'queued' card (a pending run_request with no skill_run yet). */
  requestId?: string | null;
  scheduledSkillId: string | null;
  skillSlug: string;
  source: string | null;
  status: LiveStatus;
  /** Canonical request lifecycle for definition work without a run row. */
  lifecyclePhase?: 'queued' | 'claimed' | 'starting' | 'running' | 'verifying' | 'built' | 'start_failed' | 'claim_expired' | 'failed' | 'cancelled' | null;
  since: string | null;
  /** When the run actually completed (null while running/queued). The Home linger
   *  and a finished card's "Nm ago" measure from THIS, not `since` (start time). */
  finishedAt?: string | null;
  /** Median duration of this agent's recent completed runs (ms), if known. */
  typicalMs?: number | null;
  /** Run IDENTITY — what THIS run is, from its own output. Primary card label. */
  headline?: string | null;
  /** Honest terminal cause for request-level failures (not the user's edit text). */
  failureReason?: string | null;
  /** Live per-step progress (0089) — drives "Step N/M · <label>" while running. */
  currentStepIndex?: number | null;
  totalSteps?: number | null;
  currentStepLabel?: string | null;
  /** action_available (0090): the primary ready action's label + how many open. */
  actionLabel?: string | null;
  actionCount?: number | null;
  /** SOFT stuck signal (heartbeat stale on a running run) — likely waiting on a
   *  permission. Drives the forever-fallback "open it in Claude & approve" nudge. */
  stuck?: boolean;
  /** The agent's own routine task id (for the stuck deep-link when scheduled). */
  claudeTaskId?: string | null;
  executor?: 'claude' | 'codex' | null;
  executorThreadId?: string | null;
  executorWorkspace?: string | null;
  /** What the Stalled Run Manager actually FOUND for this run, when it has
   *  diagnosed it. null = not diagnosed (yet, or pre-0125) — render that as
   *  "we don't know yet", NEVER as a guessed cause (2026-07-23 incident). */
  attention?: {
    status: string | null;
    summary: string | null;
    /** Only set when the Manager concluded a human is needed AND the blocker is
     *  actionable — 'none'/'unknown' arrive as null so no dead button is shown. */
    blockerType: string | null;
    blockerMessage: string | null;
    nextAction: string | null;
  } | null;
};

const POLL_MS = 15000;

// Active states (green/amber) show a clean spinner — they're still working or
// waiting on you. Done states (red/grey) stay a static dot. Every card opens the
// run page, so there's no per-status button label — just a chevron.
//
// `chip` is a short state word ("Queued" / "Running" / "Approval needed" / …)
// rendered as a small colored badge next to the run identity — a static
// "Running" buried in small grey subtitle text (esp. with no per-step detail,
// e.g. a plain "Run now" with no heartbeat) read as if the status indicator had
// disappeared (founder: "that's gone now"). The badge makes the state
// unmissable at a glance regardless of whether step detail is present.
const STATUS: Record<LiveStatus, { spin: boolean; spinCls: string; dotCls: string; label: string; chip: string; chipCls: string }> = {
  queued:           { spin: true,  spinCls: 'border-sky-500/25 border-t-sky-500',         dotCls: 'bg-sky-500',                 label: 'Waiting to be picked up by your AI engine', chip: 'Queued',          chipCls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  picked_up:        { spin: true,  spinCls: 'border-cyan-500/25 border-t-cyan-500',       dotCls: 'bg-cyan-500',                label: 'A worker picked this up and is starting',    chip: 'Picked up',       chipCls: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30' },
  starting:         { spin: true,  spinCls: 'border-cyan-500/25 border-t-cyan-500',       dotCls: 'bg-cyan-500',                label: 'Starting the selected executor',             chip: 'Starting',         chipCls: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30' },
  start_failed:     { spin: false, spinCls: '',                                           dotCls: 'bg-rose-500',                label: 'The executor could not start',                chip: 'Start failed',     chipCls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30' },
  claim_expired:    { spin: false, spinCls: '',                                           dotCls: 'bg-amber-500',               label: 'The worker did not confirm startup in time',  chip: 'Claim expired',    chipCls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  running:          { spin: true,  spinCls: 'border-emerald-500/25 border-t-emerald-500', dotCls: 'bg-emerald-500',             label: 'Running',                                    chip: 'Running',         chipCls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  verifying:        { spin: true,  spinCls: 'border-violet-500/25 border-t-violet-500',   dotCls: 'bg-violet-500',              label: 'Verifying the saved agent revision',         chip: 'Verifying',       chipCls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30' },
  built:            { spin: false, spinCls: '',                                           dotCls: 'bg-emerald-500',             label: 'Your updated agent is ready',                 chip: 'Built',           chipCls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  waiting_approval: { spin: true,  spinCls: 'border-amber-500/30 border-t-amber-500',     dotCls: 'bg-amber-500',               label: 'Waiting for approval',                       chip: 'Approval needed', chipCls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  action_available: { spin: false, spinCls: '',                                           dotCls: 'bg-brand-500',               label: 'Action available',                           chip: 'Action ready',    chipCls: 'bg-brand-500/10 text-brand-600 dark:text-brand-300 border-brand-500/30' },
  needs_attention:  { spin: true,  spinCls: 'border-amber-500/30 border-t-amber-500',     dotCls: 'bg-amber-500',               label: 'Needs attention',                            chip: 'Needs attention', chipCls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  failed:           { spin: false, spinCls: '',                                           dotCls: 'bg-rose-500',                label: 'Failed',                                     chip: 'Failed',          chipCls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30' },
  finished:         { spin: false, spinCls: '',                                           dotCls: 'bg-ink-500 dark:bg-ink-400', label: 'Finished',                                   chip: 'Finished',        chipCls: 'bg-ink-500/10 text-ink-400 border-ink-500/30' },
};

function statusFromLifecycle(card: LiveCard): LiveStatus {
  switch (card.lifecyclePhase) {
    case 'queued': return 'queued';
    case 'claimed': return 'picked_up';
    case 'starting': return 'starting';
    case 'running': return 'running';
    case 'verifying': return 'verifying';
    case 'built': return 'built';
    case 'failed': return 'failed';
    case 'start_failed': return 'start_failed';
    case 'claim_expired': return 'claim_expired';
    // Cancelled requests are omitted from Active Agents. Preserve an older
    // backend's explicit card status if one nevertheless appears.
    default: return card.status;
  }
}

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

/**
 * What the live read currently KNOWS. Three-valued on purpose: a parent that
 * gates an all-clear on this must be able to tell "there is nothing live" from
 * "we don't know yet" and from "we couldn't find out" — collapsing those into a
 * count of 0 is how a false "Nothing needs you" gets rendered over real work.
 */
export type LiveState = { status: 'loading' | 'ready' | 'unavailable'; count: number };

export default function RunningAgents({ alertsOnly = false, bare = false, onState }: {
  alertsOnly?: boolean;
  /** Nested inside a parent that owns the heading (see TodayFeed). */
  bare?: boolean;
  /** Reports what the live read knows, so the parent can own the all-clear honestly. */
  onState?: (s: LiveState) => void;
} = {}) {
  const supabase = createClient();
  const [cards, setCards] = useState<LiveCard[] | null>(null);
  /** The live read failed. Distinct from "no cards" — see the catch in load(). */
  const [failed, setFailed] = useState(false);
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
  // A STALLED / held alert (incl. the "An Agent" permission-stall phantoms) had no
  // way to clear it from here — the ✕ only showed on finished/failed. This removes
  // it for REAL: mark the run reviewed=dismissed on the backend so it can't
  // resurface, then hide the card. Optimistic: hide first, fire the call.
  async function dismissHeld(runId: string) {
    dismiss(runId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/review`, {
        jwt: session?.access_token, method: 'POST', body: { status: 'dismissed' },
      });
    } catch { /* hidden locally already; backend retry on next interaction */ }
  }

  // Cancel a run. TWO cases:
  //  • QUEUED (a pending run_request not yet picked up) — the cheap catch-before-
  //    it-spends case: flip the request to 'cancelled' so the drainer/Claude never
  //    picks it up, and hide the card.
  //  • RUNNING (already in flight) — the kill case: POST /runs/:id/cancel sets a
  //    flag the executor watches; the headless drainer SIGKILLs its child, an
  //    attended run aborts at its next step. We can't un-spend what's already gone,
  //    so the card flips to "Stopping…" (not hidden) until the executor confirms.
  const [confirmCancel, setConfirmCancel] = useState<LiveCard | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelledReqIds, setCancelledReqIds] = useState<Set<string>>(new Set());
  const [stoppingRunIds, setStoppingRunIds] = useState<Set<string>>(new Set());
  const isRunningCancel = (c: LiveCard | null) => !!c && c.status === 'running' && !!(c.runId || c.requestId);
  async function doCancel(card: LiveCard) {
    if (cancelBusy) return;
    setCancelBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (isRunningCancel(card) && card.runId) {
        await callBackend(`/api/v2/runs/${encodeURIComponent(card.runId!)}/cancel`, {
          jwt: session?.access_token, method: 'POST',
        });
        setStoppingRunIds((p) => { const n = new Set(p); n.add(card.runId!); return n; });
      } else if (card.requestId) {
        await callBackend(`/api/v2/me/run-requests/${encodeURIComponent(card.requestId)}`, {
          jwt: session?.access_token, method: 'PATCH', body: { status: 'cancelled' },
        });
        setCancelledReqIds((p) => { const n = new Set(p); n.add(card.requestId!); return n; });
      }
      setConfirmCancel(null);
    } catch { /* leave the card; the user can retry */ }
    finally { setCancelBusy(false); }
  }
  // Native desktop notifications fire from here (the dashboard runs inside the
  // Electron webview, so the Notification API reaches the OS). We seed on the first
  // poll so pre-existing states don't storm, then notify only on NEW transitions.
  const onStateRef = useRef<((s: LiveState) => void) | undefined>(undefined);
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
      if (!NOTIFY.has(c.status) || (!c.runId && !c.requestId)) continue;
      const identity = c.runId || c.requestId!;
      const key = `${identity}:${c.status}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      if (first) continue; // seed only on the first poll — don't notify for what's already there
      try {
        const n = new Notification(c.headline || humanize(c.skillSlug), {
          body: `${humanize(c.skillSlug)} · ${(STATUS[c.status] ?? STATUS.running).label} — tap to open`,
          tag: key,
        });
        n.onclick = () => {
          try { window.focus(); } catch { /* noop */ }
          window.location.href = c.runId
            ? `/runs/${encodeURIComponent(c.runId)}`
            : `/workflows/${encodeURIComponent(c.skillSlug)}?tab=runs`;
        };
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
        // A 2xx is NOT proof we understood the answer. callBackend only throws on
        // a non-2xx status, so an empty/non-JSON body, a dropped `items` field, or
        // a shape change all arrive here as "success" — and the old
        // `Array.isArray(...) ? ... : []` turned every one of them into a
        // confident empty list, which is exactly what the all-clear reads.
        // Unreadable is unavailable, not empty. (See lib/live-feed.)
        const items = parseLiveItems<LiveCard>(res);
        if (items === null) { if (alive) setFailed(true); return; }
        const normalized = items.map((card) => ({ ...card, status: statusFromLifecycle(card) }));
        setCards(normalized);
        setFailed(false);
        maybeNotify(normalized);
      } catch {
        // UNAVAILABLE IS NOT EMPTY. This used to `setCards([])`, which made a
        // failed read indistinguishable from "nothing is live" — and a parent
        // counting cards would then report a confident 0. Flag the failure and
        // LEAVE the last known cards alone: the parent can say "we couldn't
        // check", and a transient blip doesn't blank a list that was correct a
        // second ago. (A first-load failure keeps cards null → nothing rendered,
        // and the parent's warning is the only thing that shows.)
        if (alive) setFailed(true);
      }
    }
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On Home we show only the cards that need you (yellow/red); on the Agents page
  // we show everything live. On Home (alertsOnly) we ALSO keep a just-FINISHED run
  // around for ~30 min as a "Done — view result" receipt, so a run you kicked off
  // doesn't vanish the instant it completes (founder: "it ran and immediately went
  // out of my agents, so I had to dig in Runs to find it"). After the window it ages
  // out of Home; the full Agents page still shows finished runs for the backend's 3h.
  const RECENT_DONE_MS = 30 * 60 * 1000;
  // Anchor the linger to COMPLETION (finishedAt), falling back to `since` only when an
  // older card predates the finishedAt field. Measuring from start time made a long
  // run age out almost as soon as it finished (founder: "disappeared before 30 min").
  const doneAt = (c: LiveCard) => c.finishedAt || c.since;
  const recentlyDone = (c: LiveCard) =>
    (c.status === 'finished' || c.status === 'built') && !!doneAt(c) && (Date.now() - new Date(doneAt(c)!).getTime()) < RECENT_DONE_MS;
  // Computed from `cards ?? []` BEFORE the early returns so the state effect below
  // is never skipped by a conditional hook. The COUNT here is only meaningful
  // alongside `liveStatus` — while cards is null it is 0 because there is nothing
  // to show YET, which is emphatically not the same fact as "there is nothing".
  const list = (alertsOnly ? (cards ?? []).filter((c) => ALERT_STATUSES.has(c.status) || recentlyDone(c)) : (cards ?? []))
    .filter((c) => !(c.runId && dismissed.has(c.runId)))
    .filter((c) => !(c.requestId && cancelledReqIds.has(c.requestId)));

  // Report what the live read KNOWS, so a parent that owns the all-clear
  // (TodayFeed) can distinguish nothing-live from not-known-yet from
  // couldn't-check. Reporting a bare number let "unknown" masquerade as "zero" —
  // the same unavailable-is-not-empty collapse lib/attention.ts exists to
  // prevent, and the reason a false "Nothing needs you" could render during the
  // first poll or after a failed one. Held in a ref so an unmemoized parent
  // callback can't loop the effect.
  const liveStatus: LiveState['status'] = failed ? 'unavailable' : cards === null ? 'loading' : 'ready';
  onStateRef.current = onState;
  useEffect(() => {
    onStateRef.current?.({ status: liveStatus, count: list.length });
  }, [liveStatus, list.length]);

  if (!cards) return null;
  if (list.length === 0) return null; // invisible at rest
  const shown = showAll ? list : list.slice(0, 5);

  return (
    <section className={bare ? '' : 'mb-8'}>
      {/* `bare` (2026-07-24 Home redesign): nested inside <TodayFeed>, which owns
          the single "Today" heading. Home used to stack THREE headed sections
          (Alerts / Set up / Results) that each answered "what needs me?" with a
          different keying model — the page could even render its own "nothing
          needs you" all-clear while a section above it listed work. One heading,
          one answer. Standalone callers keep their own heading. */}
      {!bare && (
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-xs font-semibold text-ink-300 uppercase tracking-wide">{alertsOnly ? 'Alerts' : 'Active Agents'} ({list.length})</h2>
        </div>
      )}
      <div className="space-y-2">
        {shown.map((c) => {
          const s = STATUS[c.status] ?? STATUS.running;
          // Where the card opens. With a real run row -> the run page (status-aware
          // step-trace / approve / retry). A queued or just-picked-up card has no
          // skill_run yet (it's a pending/consumed run_request, runId null), but the
          // user still wants IN — fall back to the agent page so they can see the
          // chain's steps while it spins up. (Founder hit a running chain card that
          // was dead because the run row wasn't logged yet.)
          // With a real run row → the run page (status-aware step-trace / approve /
          // retry). Without one (a queued/picked-up request, or a chain whose legs
          // record under their own leaf slugs), fall back to the agent's RUNS TAB —
          // never the marketing Overview (founder landed there from a running card and
          // saw no steps). The Runs tab lists this agent's runs/requests, one click
          // from the step-trace.
          const href = c.runId
            ? `/runs/${encodeURIComponent(c.runId)}`
            : (c.skillSlug ? `/workflows/${encodeURIComponent(c.skillSlug)}?tab=runs` : null);
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
                    secondary line so two runs of one agent read distinctly. The
                    status CHIP is a small colored badge, not just inline text, so
                    the state is unmissable even while it's a static "Running" with
                    no per-step detail yet. */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm text-ink-100 truncate">{c.headline || humanize(c.skillSlug)}</div>
                  <span className={`shrink-0 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border ${s.chipCls}`}>
                    {s.chip}
                  </span>
                </div>
                <div className="text-[11px] text-ink-500 truncate">
                  {c.headline ? `${humanize(c.skillSlug)} · ` : ''}
                  {c.runId && stoppingRunIds.has(c.runId)
                    ? <span className="text-rose-500">Stopping… your Claude wraps up at its next step</span>
                    : c.status === 'action_available' && c.actionLabel
                    ? <span className="text-brand-500">{c.actionLabel}{c.actionCount && c.actionCount > 1 ? ` (+${c.actionCount - 1} more)` : ''}</span>
                    : s.label}
                  {/* Finished/failed → "Nm ago" from completion; live cards from start. */}
                  {(() => { const t = (c.status === 'finished' || c.status === 'built' || c.status === 'failed') && c.finishedAt ? c.finishedAt : c.since; return t ? ` · ${rel(t)}` : ''; })()}
                  {c.status === 'running' && c.typicalMs ? (
                    elapsedMs(c.since) > c.typicalMs * 1.5 ? (
                      <span className="text-amber-600 dark:text-amber-400"> · longer than usual (~{fmtDur(c.typicalMs)})</span>
                    ) : (
                      <span> · ~{fmtDur(c.typicalMs)} typical</span>
                    )
                  ) : null}
                </div>
                {/* Live per-step progress (0089): which step of how many is in
                    flight RIGHT NOW. Only for a running chain that reports it —
                    a plain run (no step state) shows just "Running" as before. */}
                {c.status === 'running' && c.totalSteps ? (
                  <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300 truncate mt-0.5">
                    Step {Math.min(c.currentStepIndex || 1, c.totalSteps)}/{c.totalSteps}
                    {c.currentStepLabel ? ` · ${c.currentStepLabel}` : ''}
                  </div>
                ) : null}
                {(['failed', 'start_failed', 'claim_expired'] as LiveStatus[]).includes(c.status) && c.failureReason ? (
                  <div className="mt-1 text-[11px] text-rose-500 leading-snug line-clamp-2">
                    {c.failureReason}
                  </div>
                ) : null}
              </div>
              {(c.status === 'finished' || c.status === 'built' || c.status === 'failed') && c.runId && (
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
              {/* STALLED / held alerts (incl. the "An Agent" permission-stall phantoms)
                  were un-clearable — give them a ✕ that REMOVES them for good
                  (backend reviewed=dismissed), so a dead stall can't sit forever. */}
              {(c.status === 'needs_attention' || c.status === 'waiting_approval') && c.runId && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismissHeld(c.runId!); }}
                  title="Dismiss this alert"
                  aria-label="Dismiss this alert"
                  className="shrink-0 text-ink-600 hover:text-ink-200 opacity-0 group-hover:opacity-100 transition-opacity text-sm leading-none px-1"
                >
                  ✕
                </button>
              )}
              {(c.status === 'start_failed' || c.status === 'claim_expired') && c.skillSlug && (
                <Link
                  href={`/workflows/${encodeURIComponent(c.skillSlug)}?tab=runs&retryRequest=${encodeURIComponent(c.requestId || '')}`}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-[11px] font-medium text-sky-500 hover:text-sky-400 px-2 py-1 rounded border border-sky-500/30"
                >
                  Retry from agent
                </Link>
              )}
              {/* Cancel a QUEUED run before it's picked up (catch it before it
                  spends). Opens a confirm; stops the drainer/Claude from running it. */}
              {(['queued', 'picked_up', 'starting'] as LiveStatus[]).includes(c.status) && c.requestId && !c.runId && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmCancel(c); }}
                  title="Cancel this request"
                  aria-label="Cancel this request"
                  className="shrink-0 text-[11px] font-medium text-rose-500 hover:text-rose-400 px-2 py-1 rounded border border-rose-500/30"
                >
                  Cancel request
                </button>
              )}
              {/* Kill a RUNNING run that's already in flight. The × stays after the
                  flag is set (shows "Stopping…") until the executor confirms the kill. */}
              {c.status === 'running' && (c.runId || c.requestId) && !(c.runId && stoppingRunIds.has(c.runId)) && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmCancel(c); }}
                  title="Stop this run"
                  aria-label="Stop this run"
                  className="shrink-0 text-[11px] font-medium text-rose-500 hover:text-rose-400 px-2 py-1 rounded border border-rose-500/30"
                >
                  Stop run
                </button>
              )}
              {linkable && (
                <span className="shrink-0 text-lg leading-none text-ink-500 group-hover:text-ink-200 transition-colors" aria-hidden="true">›</span>
              )}
            </>
          );
          const key = c.runId || c.requestId || c.skillSlug;
          const cls = 'group flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-950/40 px-4 py-3';
          // FOREVER FALLBACK: a run that's stuck (soft heartbeat-stale, or hard
          // stalled) is almost always its dispatcher session waiting on a permission
          // prompt. Offer a guaranteed one-click "open it in Claude & approve" so a
          // fresh agent that hits an un-granted tool/site never dead-ends. Rendered
          // as a SIBLING (can't nest an <a> inside the card's <Link>).
          const showStuck = (c.stuck || c.status === 'needs_attention') && c.status !== 'finished' && c.status !== 'failed';
          // A queued run that's sat unclaimed for a while isn't "broken" — but it is
          // ALSO not "waiting for Claude". This box used to say exactly that for every
          // queued run, including the auto-routed ones that are the default: it named
          // an engine nothing had pinned, blamed a 5-hour cap nothing had measured, and
          // told the user to wait it out while a healthy Codex sat idle. What we may
          // honestly say lives in lib/queued-wait-copy (pure + tested).
          const queuedWait = queuedWaitNotice({
            status: c.status,
            since: c.since,
            nowMs: Date.now(),
            // Only the backend's OWN diagnosis counts as a block. null = not diagnosed.
            declaredBlock: c.attention?.blockerMessage ?? null,
          });
          const card = linkable ? (
            <Link href={href!} className={`${cls} hover:border-ink-700 transition-colors`}>{body}</Link>
          ) : (
            <div className={cls}>{body}</div>
          );
          return (
            <div key={key}>
              {card}
              {showStuck && (
                <div className="mt-1.5 ml-7 rounded-md border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5">
                  {/* HONEST STATE, NOT A GUESS (2026-07-23 incident). This box used to
                      assert "most likely it's waiting on a permission" for EVERY
                      needs_attention run and always offer browser permissions. A real
                      stall was a broken Continue that never ran — Implexa Manager had
                      diagnosed it correctly, and this hard-coded heuristic buried that
                      behind an action that could not possibly help.
                      The two signals are NOT the same thing:
                        • `stuck`  — SOFT: a running run whose heartbeat went stale. A
                          pending permission prompt genuinely is the common cause, so
                          the approve shortcut is a fair offer.
                        • needs_attention — HARD: something already determined this run
                          needs a human. Guessing over that determination is how the
                          user gets sent to the wrong place. Point at the diagnosis. */}
                  {c.status === 'needs_attention' ? (
                    <>
                      {/* SHOW what the Manager found, when it found something. The
                          previous pass stopped GUESSING a cause but still made the
                          user open the run to learn anything — the diagnosis existed
                          and simply wasn't carried. `attention` is null until the
                          Manager has diagnosed it, and that stays honestly unknown
                          rather than reverting to a guess. */}
                      {c.attention?.summary ? (
                        <>
                          <p className="text-[11px] font-medium text-amber-800 dark:text-amber-200 leading-snug">
                            {c.attention.summary}
                          </p>
                          {c.attention.blockerMessage && (
                            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                              Needs you: {c.attention.blockerMessage}
                            </p>
                          )}
                          {c.attention.nextAction && (
                            <p className="mt-1 text-[11px] text-ink-500 leading-snug">{c.attention.nextAction}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                          This run stopped and needs you. Open it to see what Implexa found and what it needs —
                          the reason is on the run itself.
                        </p>
                      )}
                      {c.runId && (
                        <Link
                          href={`/runs/${c.runId}`}
                          className="mt-2 inline-block rounded-md border border-amber-500/40 px-3 py-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                        >
                          {c.attention?.summary ? 'Open the run' : 'See what it needs'}
                        </Link>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                        On the same step a while — if it’s waiting on a permission to continue, you can approve it now.
                      </p>
                      <StuckRunButton
                        engine={c.executor || 'claude'}
                        threadId={c.executorThreadId}
                        workspace={c.executorWorkspace}
                        runId={c.runId}
                        claudeTaskId={c.claudeTaskId}
                        permissionCapability="browser"
                        className="mt-2"
                      />
                    </>
                  )}
                </div>
              )}
              {queuedWait && (
                <div className="mt-1.5 ml-7 rounded-md border border-sky-500/25 bg-sky-500/[0.06] px-3 py-2.5">
                  <p className="text-[11px] font-medium text-sky-700 dark:text-sky-300 leading-snug">
                    {queuedWait.headline}
                  </p>
                  {/* Only ever the backend's own declared block — never a guessed cause. */}
                  {queuedWait.block && (
                    <p className="mt-1 text-[11px] text-sky-700 dark:text-sky-300 leading-snug">
                      Blocked: {queuedWait.block}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-ink-500 leading-snug">{queuedWait.detail}</p>
                </div>
              )}
            </div>
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

      <Modal
        open={!!confirmCancel}
        onClose={() => { if (!cancelBusy) setConfirmCancel(null); }}
        title={isRunningCancel(confirmCancel) ? 'Stop this run?' : 'Cancel this run?'}
        maxWidth="max-w-sm"
      >
        {isRunningCancel(confirmCancel) ? (
          <p className="text-sm text-ink-200 leading-relaxed">
            This will stop{' '}
            <span className="font-medium text-ink-50">{confirmCancel ? humanize(confirmCancel.skillSlug) : 'this run'}</span>{' '}
            while it&apos;s running — your Claude wraps up at its next step instead of finishing.
            Work already done (and any credits already spent) can&apos;t be undone. You can run it again anytime.
          </p>
        ) : (
          <p className="text-sm text-ink-200 leading-relaxed">
            This will cancel{' '}
            <span className="font-medium text-ink-50">{confirmCancel ? humanize(confirmCancel.skillSlug) : 'this run'}</span>{' '}
            before an executor begins work. If it was already claimed, this closes that claim without inventing a run. You can run it again anytime.
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setConfirmCancel(null)}
            disabled={cancelBusy}
            className="btn-outline text-sm px-4 py-2 disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={() => confirmCancel && doCancel(confirmCancel)}
            disabled={cancelBusy}
            className="text-sm px-4 py-2 rounded-lg bg-rose-500 text-white hover:bg-rose-400 font-medium disabled:opacity-50"
          >
            {cancelBusy ? (isRunningCancel(confirmCancel) ? 'Stopping…' : 'Cancelling…') : (isRunningCancel(confirmCancel) ? 'Stop run' : 'Cancel run')}
          </button>
        </div>
      </Modal>
    </section>
  );
}
