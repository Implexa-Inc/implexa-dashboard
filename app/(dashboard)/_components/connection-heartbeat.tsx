'use client';

/**
 * <ConnectionHeartbeat /> , live "are you actually connected?" detector (audit #3).
 *
 * The #1 silent failure for non-developers: they paste the connect command but
 * never fully relaunch Claude, so the plugin never loads, and the old SetupChip
 * (keyed off API-key existence) read "connected" before anything actually fired.
 * This polls the user's real last hook/MCP activity and reflects the TRUTH:
 *   live      , a heartbeat arrived in the last ~2 min -> "Connected and live"
 *   stale     , connected before but Claude looks closed now
 *   waiting   , never connected yet, still within the grace window (mid-install)
 *   relaunch  , never connected after the grace window -> the loud Cmd+Q nudge
 *
 * Reads the caller's own users row (RLS-scoped). Polls every 5s, stops after
 * ~6 min so an idle tab doesn't poll forever.
 */

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const LIVE_WINDOW_MS = 2 * 60 * 1000;   // a heartbeat this recent = live
const GRACE_MS       = 45 * 1000;       // mid-install patience before the nudge
const POLL_MS        = 5000;
const POLL_MAX_MS    = 6 * 60 * 1000;

type State = 'checking' | 'live' | 'stale' | 'waiting' | 'relaunch';

export default function ConnectionHeartbeat() {
  const [state, setState] = useState<State>('checking');
  const mountedAt = useRef(0);
  const startedPolling = useRef(false);

  useEffect(() => {
    mountedAt.current = Date.now();
    const supabase = createClient();
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from('users').select('last_hook_event_at, last_mcp_call_at').eq('id', uid).maybeSingle();
      if (cancelled) return;
      const ts = [data?.last_hook_event_at, data?.last_mcp_call_at]
        .map((t) => (t ? Date.parse(t) : 0))
        .filter((n) => Number.isFinite(n));
      const last = Math.max(0, ...ts);
      const now = Date.now();
      if (last && now - last < LIVE_WINDOW_MS) setState('live');
      else if (last) setState('stale');
      else if (now - mountedAt.current < GRACE_MS) setState('waiting');
      else setState('relaunch');
    }

    if (!startedPolling.current) {
      startedPolling.current = true;
      check();
      timer = setInterval(() => {
        if (Date.now() - mountedAt.current > POLL_MAX_MS && timer) { clearInterval(timer); return; }
        check();
      }, POLL_MS);
    }
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, []);

  if (state === 'checking') return null;

  if (state === 'live') {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md bg-success-400/10 border border-success-400/30 px-3 py-2">
        <span className="inline-block size-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
        <span className="text-xs text-success-700 dark:text-success-400 font-medium">Connected and live , your Claude is talking to Implexa.</span>
      </div>
    );
  }

  if (state === 'relaunch') {
    return (
      <div className="mt-3 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2.5">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Didn&apos;t connect yet?</p>
        <p className="text-xs text-ink-400 mt-0.5 leading-relaxed">
          After running the command, you must <span className="text-ink-100 font-medium">fully quit Claude (Cmd+Q)</span> and reopen it , a normal close leaves the old session running without the plugin. This flips green the moment it connects.
        </p>
      </div>
    );
  }

  if (state === 'stale') {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md bg-ink-900/40 border border-ink-700 px-3 py-2">
        <span className="inline-block size-2 rounded-full bg-ink-500" aria-hidden />
        <span className="text-xs text-ink-400">Connected before, but Claude looks closed now. Open it and your agents run.</span>
      </div>
    );
  }

  // waiting
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md bg-ink-900/40 border border-ink-700 px-3 py-2">
      <span className="inline-block size-2 rounded-full bg-sky-500 animate-pulse" aria-hidden />
      <span className="text-xs text-ink-400">Waiting for your first connection… run the command above, then fully reopen Claude.</span>
    </div>
  );
}
