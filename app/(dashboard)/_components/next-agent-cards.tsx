'use client';

/**
 * <NextAgentCards /> — the "Next agents to build" feed that rides on a run's
 * output (recommendation engine v1, see RECOMMENDATION_ENGINE_PLAN.md §1.5).
 *
 * Every run carries 1–3 next-agent recommendations in skill_runs.recommendations
 * (jsonb). We render them as the SAME small "build this" cards used by the
 * suggested shelf / Build-Agent box, so wherever you read a run's output the next
 * agents to build are right there. One tap → the existing run_requests kind='build'
 * pipe (via /api/agents/create), exactly like the suggested shelf's "Build it".
 *
 * - [Build it]  → queue the build (intent + mode/cron so the agent is pre-shaped),
 *                 optimistically remove the card, then POST the .../built endpoint.
 * - [Dismiss ✕] → POST the .../dismiss endpoint, optimistically remove the card.
 *
 * Reads defensively upstream: the column may not exist yet (see the 42703 fallback
 * in lib/run-state.ts). When there are no recommendations this renders nothing.
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

// One next-agent recommendation, the shape of a skill_runs.recommendations[] entry
// (RECOMMENDATION_ENGINE_PLAN.md §1.5 / §6). Schedule fields are optional — an
// on-demand idea carries no cron.
export type Recommendation = {
  id: string;
  title: string;
  intent: string;
  rationale: string;
  mode?: 'cron' | 'on_demand' | string | null;
  cron?: string | null;
  timezone?: string | null;
  dedup_key?: string;
};

type CardState = 'idle' | 'queuing' | 'built' | 'error';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtTime(h: number, m: number): string {
  const ampm = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, '0')}${ampm}`;
}

// A tiny, defensive cron → "runs Tue 2pm" humanizer for the schedule hint. Handles
// the common daily / weekly / monthly shapes; anything it can't parse just doesn't
// render a hint (silence beats a wrong one).
function humanizeCron(cron?: string | null): string | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [mn, hr, dom, , dow] = parts;
  const m = parseInt(mn, 10);
  const h = parseInt(hr, 10);
  if (Number.isNaN(m) || Number.isNaN(h)) return null;
  const time = fmtTime(h, m);
  if (dow && dow !== '*') {
    const d = parseInt(dow, 10);
    const day = Number.isNaN(d) ? dow : DOW[((d % 7) + 7) % 7];
    return `runs ${day} ${time}`;
  }
  if (dom && dom !== '*') return `runs monthly ${time}`;
  return `runs daily ${time}`;
}

// The desktop shell bridge (same cast the suggested shelf uses): when present, we
// hand the build straight to the user's Claude so it builds without a context switch.
type DesktopBridge = { handoffAgent?: (p: string) => Promise<{ ok: boolean }> };
function desktopBridge(): DesktopBridge | undefined {
  return typeof window !== 'undefined'
    ? (window as Window & { implexaDesktop?: DesktopBridge }).implexaDesktop
    : undefined;
}

export default function NextAgentCards({
  runId,
  recommendations,
}: {
  runId: string;
  recommendations: Recommendation[] | null | undefined;
}) {
  // Local copy so a build/dismiss can optimistically drop a card.
  const [recs, setRecs] = useState<Recommendation[]>(() => (recommendations ?? []).slice(0, 3));
  const [state, setState] = useState<Record<string, CardState>>({});
  const supabase = createClient();

  if (!recs.length) return null;

  function remove(id: string) {
    setRecs((list) => list.filter((r) => r.id !== id));
  }

  async function jwt(): Promise<string | undefined> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? undefined;
  }

  async function build(rec: Recommendation) {
    if (state[rec.id] === 'queuing' || state[rec.id] === 'built') return;
    setState((s) => ({ ...s, [rec.id]: 'queuing' }));
    try {
      // Same build bus as the suggested shelf / conversation box. Pass the
      // schedule so the built agent lands pre-shaped (backend ignores unknowns).
      const res = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: rec.intent,
          mode: rec.mode ?? undefined,
          cron: rec.cron ?? undefined,
          timezone: rec.timezone ?? undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setState((s) => ({ ...s, [rec.id]: 'error' })); return; }

      // Desktop shell: open Claude with the build ready (mirrors the shelf).
      const bridge = desktopBridge();
      if (bridge?.handoffAgent) {
        const handoff = `Build my new Implexa agent. Use Implexa's get_pending_run_requests tool to find the request I just queued ("${rec.intent}"), then call generate_workflow to build the agent, then resolve_run_request to clear it. Then tell me what you built.`;
        await bridge.handoffAgent(handoff).catch(() => null);
      }

      setState((s) => ({ ...s, [rec.id]: 'built' }));
      // Mark this recommendation built server-side, then drop the card.
      const token = await jwt();
      callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/recommendations/${encodeURIComponent(rec.id)}/built`, {
        jwt: token, method: 'POST',
      }).catch(() => { /* fire-and-forget; the build is already queued */ });
      setTimeout(() => remove(rec.id), 700);
    } catch {
      setState((s) => ({ ...s, [rec.id]: 'error' }));
    }
  }

  async function dismiss(rec: Recommendation) {
    remove(rec.id); // optimistic
    const token = await jwt();
    callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/recommendations/${encodeURIComponent(rec.id)}/dismiss`, {
      jwt: token, method: 'POST',
    }).catch(() => { /* fire-and-forget */ });
  }

  return (
    <section className="mt-6">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">Next agents to build</h2>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {recs.map((rec) => {
          const st = state[rec.id] ?? 'idle';
          const hint = rec.mode === 'cron' ? humanizeCron(rec.cron) : null;
          return (
            <div key={rec.id} className="card p-5 flex flex-col relative">
              <button
                type="button"
                onClick={() => dismiss(rec)}
                aria-label="Dismiss suggestion"
                title="Dismiss"
                className="absolute top-3 right-3 text-ink-600 hover:text-ink-300 transition-colors text-sm leading-none"
              >
                ✕
              </button>
              <div className="text-sm font-medium text-ink-50 pr-5">{rec.title}</div>
              {rec.rationale && (
                <div className="text-xs text-ink-400 mt-1.5 line-clamp-3 flex-1">{rec.rationale}</div>
              )}
              {hint && (
                <div className="text-[11px] text-ink-500 mt-2 inline-flex items-center gap-1">
                  <span aria-hidden>🕑</span>{hint}
                </div>
              )}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => build(rec)}
                  disabled={st === 'queuing' || st === 'built'}
                  className={`text-xs font-medium rounded-md px-3 py-1.5 transition-colors ${
                    st === 'built'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'btn-success'
                  } disabled:opacity-70`}
                >
                  {st === 'queuing' ? 'Queuing…' : st === 'built' ? '✓ Building in Claude Code' : 'Build it'}
                </button>
                {st === 'error' && (
                  <span className="ml-2 text-xs text-rose-600 dark:text-rose-400">Couldn’t queue — try again</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
