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
  const supabase = createClient();
  const router = useRouter();

  async function enqueueRun() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: { workflowSlug: slug, source: 'dashboard', kind: 'run' },
      });
    } catch { /* the navigation below still surfaces the routine; the hook can re-arm on arrival */ }
  }

  // Case 1: we know the routine's Claude task id → an anchor takes the user
  // straight to that routine in Claude, and we re-arm the run on the way out
  // (onClick fires the enqueue without preventing the claude:// navigation).
  if (claudeTaskId) {
    return (
      <a
        href={`claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(claudeTaskId)}`}
        onClick={() => { void enqueueRun(); }}
        className="btn-success text-xs px-3 py-1.5 flex-none whitespace-nowrap"
      >
        Fix now in Claude ↗
      </a>
    );
  }

  // Case 2: no routine id → enqueue + hand the run to Claude Code via the bridge
  // (target 'code': a run must land in Code, not chat). Falls back to details.
  async function fix() {
    if (firing) return;
    setFiring(true);
    await enqueueRun();
    const bridge = typeof window !== 'undefined'
      ? (window as Window & { implexaDesktop?: Bridge }).implexaDesktop
      : undefined;
    try {
      if (bridge?.handoffAgent) {
        await bridge.handoffAgent(`Run my Implexa agent "${name}".`, undefined, 'code').catch(() => null);
      } else if (bridge?.openAgent) {
        await bridge.openAgent().catch(() => null);
      } else {
        router.push(`/workflows/${slug}`); // plain browser: no local runtime to fix in
      }
    } finally {
      setFiring(false);
    }
  }

  return (
    <button
      type="button"
      onClick={fix}
      disabled={firing}
      className="btn-success text-xs px-3 py-1.5 flex-none whitespace-nowrap disabled:opacity-60"
    >
      {firing ? 'Opening…' : neverArmed ? 'Start it in Claude' : 'Fix now in Claude'}
    </button>
  );
}
