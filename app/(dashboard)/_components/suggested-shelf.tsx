'use client';

/**
 * <SuggestedShelf /> — the "Suggested for you" shelf, with an explicit journey on
 * every card (the old shelf was fetched but never rendered, and gave no hint how
 * to use a suggestion).
 *
 * Two card shapes:
 * - An existing catalog agent (workflow_slug) → "View & activate" → the agent
 *   page → Activate → Run.
 * - A suggested intent (no agent yet) → "Build it" → queues the build HANDS-OFF
 *   (same bus as the conversation box); the always-on drainer builds it on the
 *   user's own Claude/Codex with no session to open, then it appears under Your
 *   agents to activate. A small "shape it in Claude" opt-in remains for power
 *   users who want the interactive build.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { SuggestedAgent } from '@/lib/workflow-catalog';

type BuildState = 'idle' | 'queuing' | 'queued' | 'error';

const CLAUDE_CODE_MAX = 13000;

function buildHandoffPrompt(intent: string) {
  return `Build my new Implexa agent. Use Implexa's get_pending_run_requests tool to find the request I just queued ("${intent}"), then call generate_workflow to build the agent, then resolve_run_request to clear it. Then tell me what you built.`;
}

function BuildButton({ intent }: { intent: string }) {
  const [state, setState] = useState<BuildState>('idle');

  async function build() {
    if (state === 'queuing' || state === 'queued') return;
    setState('queuing');
    try {
      const res = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setState('error'); return; }
      // Hands-off: the drainer builds it. No Claude session is opened here.
      setState('queued');
    } catch {
      setState('error');
    }
  }

  // Secondary opt-in: shape the queued build interactively in Claude.
  function shapeInClaude() {
    const handoff = buildHandoffPrompt(intent);
    const bridge = typeof window !== 'undefined'
      ? (window as Window & { implexaDesktop?: { handoffAgent?: (p: string, s?: string, t?: string) => Promise<{ ok: boolean }> } }).implexaDesktop
      : undefined;
    if (bridge?.handoffAgent) {
      void bridge.handoffAgent(handoff, undefined, 'code').catch(() => null);
    } else {
      window.location.href = `claude://code/new?q=${encodeURIComponent(handoff.slice(0, CLAUDE_CODE_MAX))}`;
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={build}
        disabled={state === 'queuing' || state === 'queued'}
        className={`text-xs font-medium rounded-md px-3 py-1.5 transition-colors ${
          state === 'queued'
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            : 'btn-success'
        } disabled:opacity-70`}
      >
        {state === 'queuing' ? 'Queuing…' : state === 'queued' ? '✓ Queued — building' : 'Build it'}
      </button>
      {state === 'queued' && (
        <button
          type="button"
          onClick={shapeInClaude}
          className="text-[11px] text-ink-400 hover:text-ink-200 underline-offset-2 hover:underline"
        >
          …or shape it in Claude ↗
        </button>
      )}
    </div>
  );
}

export default function SuggestedShelf({ suggestions }: { suggestions: SuggestedAgent[] }) {
  if (!suggestions.length) return null;
  return (
    <section className="mt-12">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">Suggested for you</h2>
        <p className="text-xs text-ink-500 mt-1">
          One tap each: Implexa builds it, you activate it, it runs in your Claude Code.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {suggestions.slice(0, 6).map((s, i) => (
          <div key={`${s.workflow_slug || s.skill_slug || s.title}-${i}`} className="card p-5 flex flex-col">
            <div className="text-sm font-medium text-ink-50">{s.title}</div>
            {s.reason && <div className="text-xs text-ink-400 mt-1.5 line-clamp-2 flex-1">{s.reason}</div>}
            <div className="mt-4">
              {s.workflow_slug ? (
                <Link href={`/workflows/${s.workflow_slug}`} className="text-xs font-medium rounded-md px-3 py-1.5 btn-success inline-block">
                  View &amp; activate
                </Link>
              ) : s.suggested_intent ? (
                <BuildButton intent={s.suggested_intent} />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
