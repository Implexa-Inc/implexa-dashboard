'use client';

/**
 * <AgentActions /> — the agent detail page's primary actions, replacing the old
 * clipboard-only "copy run command" (which made the user do the journey by hand).
 *
 * The journey (boardroom/HANDOFF_PROCESS.md): Activate once → Run → it runs in
 * Claude Code on your computer.
 *
 * - Not activated → "Activate" → the guided activation page (which hands off to
 *   the Implexa app when installed).
 * - Activated → "Run now" → enqueues a run-request on the bus
 *   (POST /api/v2/me/run-requests); the Implexa plugin picks it up in Claude Code
 *   and runs the agent there. Inside the desktop shell we also pop Claude open.
 */

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type RunState = 'idle' | 'queuing' | 'queued' | 'error';

export default function AgentActions({ slug, source, isActive, requiresLocal }: {
  slug: string;
  source: string;
  isActive: boolean;
  requiresLocal?: boolean;
}) {
  const [state, setState] = useState<RunState>('idle');
  const [msg, setMsg] = useState('');
  const supabase = createClient();

  async function runNow() {
    if (state === 'queuing') return;
    setState('queuing');
    setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: { workflowSlug: slug, source, kind: 'run' },
      });
      // Inside the desktop shell, pop the user's Claude open so the pending
      // run-request is picked up right away (presence, never runtime).
      const bridge = typeof window !== 'undefined'
        ? (window as Window & { implexaDesktop?: { openAgent?: () => Promise<{ ok: boolean }> } }).implexaDesktop
        : undefined;
      if (bridge?.openAgent) {
        await bridge.openAgent().catch(() => null);
        setMsg('Queued — opening Claude Code, it runs there.');
      } else {
        setMsg('Queued. Open Claude Code (or the Implexa app) and it runs on your next message.');
      }
      setState('queued');
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error ? e.message : 'Could not queue the run. Try again.');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {isActive ? (
        <button
          type="button"
          onClick={runNow}
          disabled={state === 'queuing'}
          className="btn-success text-sm px-4 py-2 disabled:opacity-60"
        >
          {state === 'queuing' ? 'Queuing…' : state === 'queued' ? '✓ Queued' : '▶ Run now'}
        </button>
      ) : (
        <Link href={`/workflows/${slug}/activate`} className="btn-success text-sm px-4 py-2">
          Activate
        </Link>
      )}
      <span className="text-[11px] text-ink-500 text-right max-w-[230px]">
        {msg || (isActive
          ? (requiresLocal ? 'Runs in Claude Code, on your computer.' : 'Runs in your Claude.')
          : 'Activate once, then run it anytime.')}
      </span>
    </div>
  );
}
