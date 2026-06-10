'use client';

/**
 * <AgentActions /> — the agent detail page's primary actions, replacing the old
 * clipboard-only "copy run command" (which made the user do the journey by hand).
 *
 * The journey (boardroom/HANDOFF_PROCESS.md): Activate once → Run → it runs in
 * Claude Code on your computer → the result comes home.
 *
 * - Not activated → "Activate" → the guided activation page (which hands off to
 *   the Implexa app when installed).
 * - Activated → "Run now" → enqueues a run-request on the bus
 *   (POST /api/v2/me/run-requests, source 'dashboard'); the Implexa plugin picks
 *   it up in Claude Code and runs the agent there. Inside the desktop shell we
 *   also pop Claude open. Then we POLL the request (GET /me/run-requests/:id)
 *   so the page shows pending → running → done with a link to the result,
 *   instead of leaving the user to go find the inbox.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type RunState = 'idle' | 'queuing' | 'queued' | 'running' | 'done' | 'error';

const POLL_MS = 5000;
const POLL_MAX_MS = 5 * 60 * 1000; // stop after 5 min; the run still lands in the inbox

export default function AgentActions({ slug, isActive, requiresLocal }: {
  slug: string;
  isActive: boolean;
  requiresLocal?: boolean;
}) {
  const [state, setState] = useState<RunState>('idle');
  const [msg, setMsg] = useState('');
  const requestId = useRef<string | null>(null);
  const pollStart = useRef(0);
  const supabase = createClient();

  // Poll the queued request until the plugin marks it done (run_id linked).
  useEffect(() => {
    if (state !== 'queued' && state !== 'running') return;
    const t = setInterval(async () => {
      if (!requestId.current) return;
      if (Date.now() - pollStart.current > POLL_MAX_MS) {
        clearInterval(t);
        setMsg('Still queued. It runs the next time Claude Code is open; the result lands in your inbox.');
        return;
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend(`/api/v2/me/run-requests/${requestId.current}`, { jwt: session?.access_token });
        const status = res?.request?.status;
        if (status === 'consumed') { setState('running'); setMsg('Running in Claude Code…'); }
        else if (status === 'done') { clearInterval(t); setState('done'); setMsg(''); }
        else if (status === 'cancelled') { clearInterval(t); setState('error'); setMsg('The run was cancelled.'); }
      } catch { /* transient poll failure: keep trying until the cap */ }
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function runNow() {
    if (state === 'queuing' || state === 'running') return;
    setState('queuing');
    setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: { workflowSlug: slug, source: 'dashboard', kind: 'run' },
      });
      requestId.current = res?.request?.id || null;
      pollStart.current = Date.now();
      // Inside the desktop shell, pop the user's Claude open so the pending
      // run-request is picked up right away (presence, never runtime).
      const bridge = typeof window !== 'undefined'
        ? (window as Window & { implexaDesktop?: { openAgent?: () => Promise<{ ok: boolean }> } }).implexaDesktop
        : undefined;
      if (bridge?.openAgent) {
        await bridge.openAgent().catch(() => null);
        setMsg('Queued — opening Claude Code, it runs there.');
      } else {
        setMsg('Queued. It runs in Claude Code on your next message there.');
      }
      setState('queued');
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error ? e.message : 'Could not queue the run. Try again.');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {!isActive ? (
        <Link href={`/workflows/${slug}/activate`} className="btn-success text-sm px-4 py-2">
          Activate
        </Link>
      ) : state === 'done' ? (
        <Link href="/inbox" className="btn-success text-sm px-4 py-2">
          ✓ Done — view result
        </Link>
      ) : (
        <button
          type="button"
          onClick={runNow}
          disabled={state === 'queuing' || state === 'running'}
          className="btn-success text-sm px-4 py-2 disabled:opacity-60"
        >
          {state === 'queuing' ? 'Queuing…'
            : state === 'running' ? 'Running…'
            : state === 'queued' ? '✓ Queued'
            : '▶ Run now'}
        </button>
      )}
      <span className="text-[11px] text-ink-500 text-right max-w-[230px]">
        {msg || (isActive
          ? (requiresLocal ? 'Runs in Claude Code, on your computer.' : 'Runs in your Claude.')
          : 'Activate once, then run it anytime.')}
      </span>
    </div>
  );
}
