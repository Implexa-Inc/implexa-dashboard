'use client';

/**
 * <FixNowButton /> — the real fix for a missed/failed scheduled run, used in the
 * "Needs you" strip. "Open agent" (details) was a dead end; this re-runs the
 * agent's REAL routine and drops the user onto it in Claude so they can watch.
 *
 * On click it enqueues a run-request (POST /me/run-requests, kind 'run') — the
 * Implexa plugin sees it and re-arms the routine's one-time fire in the
 * background runtime (same path as AgentActions "Run now"). Then:
 *   - if we know the routine's Claude task id → navigate to the routine's page
 *     in the Claude app (undocumented deep link, verified 2026-06-12), so the
 *     user lands right on it;
 *   - else, hand the run to Claude Code via the desktop bridge;
 *   - else (plain browser) → fall back to the agent's detail page.
 *
 * Codex parity comes later (the routine deep link is Claude-specific today).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { useSetupRequiredGate } from './setup-required-gate';

type Bridge = {
  openAgent?: () => Promise<{ ok: boolean }>;
  handoffAgent?: (prompt: string, surface?: string, target?: string) => Promise<{ ok: boolean; mode?: string }>;
};

export default function FixNowButton({ slug, name, claudeTaskId, neverArmed = false }: {
  slug: string;
  name: string;
  claudeTaskId?: string | null;
  /** Routine was activated but never armed in Claude — relabel as a one-time
   *  setup ("Set it up in Claude") rather than a re-run of a missed fire. The
   *  action is identical: the enqueued run lets the reconcile hook arm the cron. */
  neverArmed?: boolean;
}) {
  const [firing, setFiring] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const supabase = createClient();
  const router = useRouter();
  // MACHINE-CAPABILITY ADMISSION (backend 0346): a typed setup_required refusal
  // is the modal — never swallowed, never followed by the claude:// hop or the
  // /workflows redirect (there is no run to watch).
  const setupGate = useSetupRequiredGate({ slug });

  /** Queue the run. Resolves true when a request exists; false when the setup
   *  modal is open or the request failed (the user stays here either way). */
  async function enqueueRun(): Promise<boolean> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const gated = await setupGate.guard(({ machineId }) => callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: { workflowSlug: slug, source: 'dashboard', kind: 'run', ...(machineId ? { executionMachineId: machineId } : {}) },
      }), () => { afterQueued(); });
      return gated.ok;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not queue the run. Try again.');
      return false;
    }
  }

  // Where a QUEUED run takes the user: the routine in Claude when we know its
  // id (undocumented deep link, verified 2026-06-12), else Active Agents.
  function afterQueued() {
    if (claudeTaskId) { window.location.href = `claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(claudeTaskId)}`; return; }
    router.push('/workflows'); router.refresh();
  }

  // Case 1: we know the routine's Claude task id → queue first, THEN take the
  // user to that routine in Claude. (This used to be an anchor that navigated
  // while the enqueue ran in the background — a refused enqueue was invisible.)
  if (claudeTaskId) {
    return (
      <>
        <button
          type="button"
          onClick={async () => { if (firing) return; setFiring(true); setErr(null); const queued = await enqueueRun(); if (!queued) setFiring(false); }}
          disabled={firing}
          className="btn-success text-xs px-3 py-1.5 flex-none whitespace-nowrap disabled:opacity-60"
        >
          {firing ? 'Starting…' : 'Fix now in Claude ↗'}
        </button>
        {err ? <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span> : null}
        {setupGate.modal}
      </>
    );
  }

  // Case 2: no routine id → just ENQUEUE the run and let it run on its own. The
  // queued request is what arms the schedule + runs the agent (the dispatcher for
  // browser agents, the drainer for headless) — so we do NOT hand over a "Run my
  // agent" prompt the user has to send (founder: closing that prompt without acting
  // still ran the agent, so it was pure friction). We just bring Claude to the front
  // (no prompt) so a session exists to pick it up, then land on Active Agents to
  // watch it spin up.
  async function fix() {
    if (firing) return;
    setFiring(true); setErr(null);
    const bridge = typeof window !== 'undefined'
      ? (window as Window & { implexaDesktop?: Bridge }).implexaDesktop
      : undefined;
    const queued = await enqueueRun();
    if (!queued) { setFiring(false); return; }
    try { await bridge?.openAgent?.().catch(() => null); } catch { /* web: no local app to focus */ }
  }

  return (
    <>
      <button
        type="button"
        onClick={fix}
        disabled={firing}
        className="btn-success text-xs px-3 py-1.5 flex-none whitespace-nowrap disabled:opacity-60"
      >
        {firing ? 'Starting…' : neverArmed ? 'Start it' : 'Fix now'}
      </button>
      {err ? <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span> : null}
      {setupGate.modal}
    </>
  );
}
