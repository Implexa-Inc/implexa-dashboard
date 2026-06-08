'use client';

import { useState } from 'react';

/**
 * The conversation box: "you talk to Implexa". One codebase, two contexts.
 *
 * On submit it enqueues a build-request via the user's session (POST
 * /api/agents/build), which works in a plain browser AND inside the desktop
 * shell. Then, if the native desktop bridge is present (window.implexaDesktop),
 * it opens the user's Claude/Codex so the SessionStart hook builds the agent
 * right away. In a plain browser it tells the user to open their agent. The
 * model work always stays on the user's agent: presence, never runtime.
 */

declare global {
  interface Window {
    implexaDesktop?: {
      openAgent?: (surface?: string) => Promise<{ ok: boolean; surface?: string }>;
      handoffAgent?: (prompt: string, surface?: string) => Promise<{ ok: boolean; surface?: string; mode?: string }>;
    };
  }
}

type State = 'idle' | 'sending' | 'queued' | 'opening' | 'error';

export default function TalkToImplexa() {
  const [intent, setIntent] = useState('');
  const [state, setState] = useState<State>('idle');
  const [msg, setMsg] = useState('');

  const submit = async () => {
    const t = intent.trim();
    if (!t || state === 'sending' || state === 'opening') return;
    setState('sending');
    setMsg('');
    try {
      const res = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: t }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setState('error');
        setMsg(data?.error === 'not signed in' ? 'Please sign in first.' : 'Could not queue that. Try again.');
        return;
      }
      setIntent('');
      const bridge = typeof window !== 'undefined' ? window.implexaDesktop : undefined;
      // Desktop shell: open the agent with the build PREFILLED for review (GUI
      // path, no terminal). For Claude this is a new-chat deep link; the user
      // reviews and sends, and Claude builds it via the Implexa connector.
      if (bridge?.handoffAgent) {
        setState('opening');
        const handoff = `Build my new Implexa agent. Use Implexa's get_pending_run_requests tool to find the request I just queued ("${t}"), then call generate_workflow to build the agent, then resolve_run_request to clear it. Then tell me what you built.`;
        const r = await bridge.handoffAgent(handoff).catch(() => ({ ok: false }));
        setState('queued');
        setMsg(r?.ok
          ? 'Opening your agent with the build ready. Review it and hit send, then it appears under Your agents below.'
          : 'Queued. Open your Claude or Codex and Implexa will build it.');
      } else {
        setState('queued');
        setMsg('Queued. Open your Claude or Codex and Implexa builds it, then it appears under Your agents below.');
      }
    } catch {
      setState('error');
      setMsg('Could not queue that. Try again.');
    }
  };

  const busy = state === 'sending' || state === 'opening';
  const label = state === 'sending' ? 'Queuing' : state === 'opening' ? 'Opening' : 'Build it';

  return (
    <section className="mb-8">
      <div className="card p-4">
        <label htmlFor="talk" className="text-sm font-medium text-ink-100">
          Tell Implexa what to do
        </label>
        <p className="text-xs text-ink-400 mt-0.5 mb-3">
          Describe a recurring job. Implexa builds the agent; it runs in your connected Claude or Codex, as you.
        </p>
        <div className="flex gap-2">
          <input
            id="talk"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. every morning, send me my key numbers"
            disabled={busy}
            className="flex-1 rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-brand-500 disabled:opacity-60"
          />
          <button
            onClick={submit}
            disabled={busy || !intent.trim()}
            className="rounded-md bg-brand-500 text-ink-950 px-4 py-2 text-sm font-medium hover:bg-brand-400 whitespace-nowrap transition-colors disabled:opacity-50"
          >
            {label}
          </button>
        </div>
        {msg && (
          <p className={`text-xs mt-2 ${state === 'error' ? 'text-rose-400' : 'text-ink-300'}`}>{msg}</p>
        )}
      </div>
    </section>
  );
}
