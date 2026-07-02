'use client';

/**
 * <AgentBrowserConnect /> — the grant "sitting" + waiting room (Stage 2).
 *
 * A browser agent isn't hands-free until this Mac's Claude-for-Chrome pairing is
 * in place AND the agent's own sites are pre-warmed (visited once so the per-site
 * "Always allow" is captured, not asked mid-run). Implexa can't grant those — only
 * TRIGGER them — so this opens a focused Claude session that surfaces the prompts
 * and pre-warms the agent's domains, then Implexa becomes the narrator: it POLLS
 * the activation verification and flips to "connected" the moment the grant lands
 * (report_runtime_permissions stamps chrome_connected_at, which the backend's
 * live-derived verification reads). No engine round-trip data flows back to us —
 * we watch the verified flag, nothing more.
 *
 * The user's home stays this card the whole time; the Claude window is a cameo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { GRANT_PERMISSIONS_PROMPT } from './grant-permissions-button';

type Bridge = {
  handoffAgent?: (prompt: string, surface?: string, target?: string) => Promise<{ ok: boolean; mode?: string }>;
};

type Phase = 'idle' | 'connecting' | 'connected' | 'timeout';

const POLL_MS = 4000;
const MAX_POLLS = 75; // ~5 minutes — long enough for a human to approve, then stop.

// The agent-aware grant prompt: the shared machine-level grant flow, plus a
// pre-warm of THIS agent's sites so its first real run never stalls on a per-site
// prompt. Domains are best-effort (a pure-browser agent may declare none).
function buildPrompt(name: string, domains: string[]): string {
  if (!domains.length) return GRANT_PERMISSIONS_PROMPT;
  const list = domains.join(', ');
  return `${GRANT_PERMISSIONS_PROMPT} (4) PRE-WARM SITES — after the browser is paired, open each of these sites once so "${name}" can act on them later without asking: ${list}. Visit each; if the browser asks whether to allow Claude on that site, tell me to click "Always allow" so it's remembered.`;
}

export default function AgentBrowserConnect({
  slug,
  name,
  domains = [],
}: {
  slug: string;
  name: string;
  domains?: string[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const pollsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);
  useEffect(() => stop, [stop]); // clear the poll on unmount

  const poll = useCallback(async () => {
    pollsRef.current += 1;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/activation`, {
        jwt: session?.access_token,
      });
      const verified = res?.verification?.verified === true;
      if (verified) {
        setPhase('connected');
        stop();
        router.refresh(); // re-render the card in its verified state
        return;
      }
    } catch { /* transient — keep polling */ }
    if (pollsRef.current >= MAX_POLLS) { setPhase('timeout'); stop(); return; }
    timerRef.current = setTimeout(poll, POLL_MS);
  }, [slug, supabase, router, stop]);

  async function connect() {
    const prompt = buildPrompt(name, domains);
    const bridge = typeof window !== 'undefined'
      ? (window as Window & { implexaDesktop?: Bridge }).implexaDesktop
      : undefined;
    try {
      if (bridge?.handoffAgent) {
        await bridge.handoffAgent(prompt, 'claude', 'code');
      } else if (typeof window !== 'undefined') {
        window.location.href = `claude://code/new?q=${encodeURIComponent(prompt)}`;
      }
    } catch { /* best-effort — the user can retry */ }
    pollsRef.current = 0;
    setPhase('connecting');
    stop();
    timerRef.current = setTimeout(poll, POLL_MS);
  }

  if (phase === 'connected') {
    return (
      <p className="text-sm text-emerald-600 dark:text-emerald-400">✓ Browser connected — this agent now runs hands-free.</p>
    );
  }

  if (phase === 'connecting') {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="inline-flex items-center gap-2 text-sm text-ink-200">
          <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-ink-600 border-t-brand-500 animate-spin" aria-hidden />
          Waiting for you to approve in Claude…
        </span>
        <p className="text-xs text-ink-500 leading-snug">
          Approve the prompts in the Claude window{domains.length ? ' and let it open your sites' : ''}. This updates on its own — no need to come back.
        </p>
        <button type="button" onClick={connect} className="btn-outline text-xs px-2.5 py-1 self-start mt-0.5">
          Reopen Claude ↗
        </button>
      </div>
    );
  }

  if (phase === 'timeout') {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug">
          Didn&apos;t detect the browser yet. Finish approving in Claude, then it&apos;ll update — or try again.
        </p>
        <button type="button" onClick={connect} className="btn-success text-xs px-3 py-1.5 self-start">
          Try again ↗
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={connect} className="btn-success text-xs px-3 py-1.5 self-start whitespace-nowrap">
        Connect the browser ↗
      </button>
      {domains.length > 0 && (
        <p className="text-[11px] text-ink-500 leading-snug">
          Opens {domains.slice(0, 3).join(', ')}{domains.length > 3 ? ` +${domains.length - 3} more` : ''} once, so runs never stop to ask.
        </p>
      )}
    </div>
  );
}
