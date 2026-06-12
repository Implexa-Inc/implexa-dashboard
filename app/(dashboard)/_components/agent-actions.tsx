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

export default function AgentActions({ slug, name, isActive, requiresLocal, source = 'generated', nextRunAt, pendingQuestions = 0, align = 'end' }: {
  slug: string;
  /** Display name; the prefilled run command quotes it ("Run my Implexa agent ..."). */
  name?: string;
  isActive: boolean;
  requiresLocal?: boolean;
  /** Catalog source, to fetch the agent's saved config answers for the run prompt. */
  source?: string;
  /** ISO of the next scheduled fire — shown as grey "Next run: …" under Run now. */
  nextRunAt?: string | null;
  /** Unanswered config questions — shown as an amber chip that scrolls to the setup card. */
  pendingQuestions?: number;
  /** 'end' on the detail page header; 'start' inside the activation card. */
  align?: 'start' | 'end';
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

  // Scroll the agent's questions into view and flash them. Used when Run is
  // pressed with unanswered questions, so they surface AT the run moment instead
  // of the run firing blind (founder: "I clicked Run and nothing happened").
  function surfaceQuestions() {
    const el = document.getElementById('agent-setup');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try { window.dispatchEvent(new CustomEvent('implexa-flash-setup')); } catch { /* best effort */ }
    }
  }

  async function runNow() {
    if (state === 'queuing' || state === 'running') return;
    // Hard gate: never hand off a run that is missing required answers. Surface
    // the questions instead of producing a dead "nothing happened" run.
    if (pendingQuestions > 0) { surfaceQuestions(); return; }
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
      // The handoff must be VISIBLE (founder: "Queued" with an empty Claude box
      // reads as a silent failure). Inside the desktop shell we open Claude with
      // the run command PREFILLED via the claude:// deep link; the user reviews
      // and hits enter. The queued request stays underneath so the result still
      // comes home to Results. Clipboard is the belt-and-suspenders fallback.
      // Thread the agent's saved config answers into the run command, so it runs
      // unattended instead of stopping to ask in Claude Code. (apply_workflow
      // also injects them server-side; this makes them visible in the prompt.)
      let settings = '';
      try {
        const setup = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup?source=${encodeURIComponent(source)}`, { jwt: session?.access_token });
        const schema: Array<{ key: string; question: string }> = Array.isArray(setup?.schema) ? setup.schema : [];
        const answers: Record<string, string> = (setup?.answers && typeof setup.answers === 'object') ? setup.answers : {};
        const pairs = schema
          .filter((f) => (answers[f.key] ?? '').toString().trim() !== '')
          .map((f) => `${f.question} ${answers[f.key]}`);
        if (pairs.length) settings = ` Use these saved answers, do not ask again: ${pairs.join('; ')}.`;
      } catch { /* no config or transient: run without inline settings (server still injects) */ }
      const runCommand = `Run my Implexa agent "${name || slug}".${settings}`;
      try { await navigator.clipboard.writeText(runCommand); } catch { /* clipboard is best-effort */ }
      const bridge = typeof window !== 'undefined'
        ? (window as Window & { implexaDesktop?: {
            openAgent?: () => Promise<{ ok: boolean }>;
            handoffAgent?: (prompt: string, surface?: string, target?: string) => Promise<{ ok: boolean; mode?: string }>;
          } }).implexaDesktop
        : undefined;
      if (bridge?.handoffAgent) {
        // target 'code': the run must land in Claude CODE (Bash, Remotion, local
        // files), never the chat tab — chat cannot execute a local agent. Older
        // desktop builds ignore the third arg and fall back to chat.
        const h = await bridge.handoffAgent(runCommand, undefined, 'code').catch(() => null);
        setMsg(h && h.ok && h.mode === 'deeplink'
          ? 'Opening Claude Code with the run command prefilled — review it and hit enter.'
          : `Opening Claude. Paste the command we copied (${runCommand}) and hit enter.`);
      } else if (bridge?.openAgent) {
        await bridge.openAgent().catch(() => null);
        setMsg(`Opening Claude. Paste the command we copied (${runCommand}) and hit enter.`);
      } else {
        setMsg(`Queued. In Claude, send: ${runCommand} (copied to your clipboard).`);
      }
      setState('queued');
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error ? e.message : 'Could not queue the run. Try again.');
    }
  }

  return (
    <div className={`flex flex-col gap-1.5 ${align === 'end' ? 'items-end' : 'items-start'}`}>
      {!isActive ? (
        <Link href={`/workflows/${slug}/activate`} className="btn-success text-sm px-4 py-2">
          Activate
        </Link>
      ) : state === 'done' ? (
        <Link href="/inbox" className="btn-success text-sm px-4 py-2">
          ✓ Done — view result
        </Link>
      ) : pendingQuestions > 0 ? (
        // Unanswered questions: the primary action IS answering them. The button
        // surfaces + flashes the question card rather than firing a dead run.
        <button
          type="button"
          onClick={surfaceQuestions}
          className="text-sm px-4 py-2 rounded-md border border-amber-500/60 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 font-medium"
        >
          Answer {pendingQuestions} question{pendingQuestions === 1 ? '' : 's'} to run ↑
        </button>
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
      <span className={`text-[11px] text-ink-500 max-w-[320px] ${align === 'end' ? 'text-right' : 'text-left'}`}>
        {msg || (isActive
          ? (requiresLocal ? 'Runs in Claude Code, on your computer.' : 'Runs in your Claude.')
          : 'Activate once, then run it anytime.')}
      </span>
      {/* When does it run next (scheduled agents), grey + small. */}
      {isActive && !msg && nextRunAt && (
        <span className={`text-[11px] text-ink-600 ${align === 'end' ? 'text-right' : 'text-left'}`}>
          Next run: {nextRunLabel(nextRunAt)}
        </span>
      )}
    </div>
  );
}

function nextRunLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const secs = (d.getTime() - Date.now()) / 1000;
  const rel = secs < 3600 ? `${Math.round(secs / 60)}m` : secs < 86400 ? `${Math.round(secs / 3600)}h` : `${Math.round(secs / 86400)}d`;
  return `${day} ${time} (in ${rel})`;
}
