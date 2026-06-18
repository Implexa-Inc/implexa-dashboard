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
import Modal from './modal';

type RunState = 'idle' | 'queuing' | 'queued' | 'running' | 'done' | 'error';
type FreshField = { key: string; question: string; kind: 'text' | 'choice' | 'file'; options?: string[]; freshEachRun?: boolean };

const POLL_MS = 5000;
const POLL_MAX_MS = 5 * 60 * 1000; // stop after 5 min; the run still lands in the inbox

export default function AgentActions({ slug, name, isActive, requiresLocal, source = 'generated', nextRunAt, pendingQuestions = 0, claudeTaskId, align = 'end' }: {
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
  /** Claude routine id — lets "Running…" deep-link the routine's page in Claude. */
  claudeTaskId?: string | null;
  /** 'end' on the detail page header; 'start' inside the activation card. */
  align?: 'start' | 'end';
}) {
  const [state, setState] = useState<RunState>('idle');
  const [msg, setMsg] = useState('');
  const [showRunModal, setShowRunModal] = useState(false);
  // Per-run input pop-up: questions the agent marked "fresh each run" (a new
  // recording, today's topic) are collected here before the run is queued.
  const [showFreshModal, setShowFreshModal] = useState(false);
  const [freshFields, setFreshFields] = useState<FreshField[]>([]);
  const [freshValues, setFreshValues] = useState<Record<string, string>>({});
  const [freshSaving, setFreshSaving] = useState(false);
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
    // The questions live in the Setup TAB, which AgentTabs leaves unmounted
    // while another tab is active — so #agent-setup may not exist yet. Switch to
    // the Setup tab first (AgentTabs listens for this), THEN scroll + flash once
    // the panel has mounted. On surfaces without tabs (the activation card), the
    // open-tab event is a harmless no-op and #agent-setup is already present.
    try { window.dispatchEvent(new CustomEvent('implexa-open-tab', { detail: { key: 'setup' } })); } catch { /* best effort */ }
    const focusSetup = () => {
      const el = document.getElementById('agent-setup');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try { window.dispatchEvent(new CustomEvent('implexa-flash-setup')); } catch { /* best effort */ }
        return true;
      }
      return false;
    };
    // Try immediately (no-tab surfaces), then again after the tab panel mounts.
    if (!focusSetup()) {
      setTimeout(focusSetup, 90);
      setTimeout(focusSetup, 300);
    }
  }

  async function runNow() {
    if (state === 'queuing' || state === 'running') return;
    // Hard gate: never hand off a run that is missing required answers. Surface
    // the questions instead of producing a dead "nothing happened" run.
    if (pendingQuestions > 0) { surfaceQuestions(); return; }
    // Per-run input gate: if the agent has "fresh each run" questions (a new
    // recording, today's topic), pop them up to update BEFORE queuing — don't
    // silently reuse last run's answer. Best-effort: if the lookup fails, fall
    // through and queue normally.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const setup = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup?source=${encodeURIComponent(source)}`, { jwt: session?.access_token });
      const schema: FreshField[] = Array.isArray(setup?.schema) ? setup.schema : [];
      const fresh = schema.filter((f) => f.freshEachRun);
      if (fresh.length) {
        const answers: Record<string, string> = (setup?.answers && typeof setup.answers === 'object') ? setup.answers : {};
        setFreshFields(fresh);
        setFreshValues(Object.fromEntries(fresh.map((f) => [f.key, (answers[f.key] ?? '').toString()])));
        setShowFreshModal(true);
        return; // wait for the pop-up's "Save & run"
      }
    } catch { /* setup lookup failed — queue without the pop-up */ }
    doQueue();
  }

  // Save the fresh per-run answers, then queue the run.
  async function saveFreshAndRun() {
    if (freshFields.some((f) => (freshValues[f.key] ?? '').toString().trim() === '')) return; // all required
    setFreshSaving(true);
    setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup`, {
        jwt: session?.access_token, method: 'POST', body: { answers: freshValues, source },
      });
      setShowFreshModal(false);
      await doQueue();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save your input. Try again.');
    } finally {
      setFreshSaving(false);
    }
  }

  async function doQueue() {
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
      // A SCHEDULED agent runs as its real routine: the plugin sees the queued
      // request and re-arms the agent's one-time fireAt task, which fires in the
      // background runtime with its pre-granted permissions (no chat, no enter
      // key). The pending-runs hook picks the request up on the user's next
      // Claude interaction (SessionStart / any prompt), so we do NOT open a blank
      // Claude session here. Confirm with a clear pop-up instead of inline text.
      if (claudeTaskId) {
        setState('queued');
        // Be honest immediately: Run now QUEUES the run; it fires when Claude Code
        // is open on this computer to pick it up. Don't imply it's already running.
        setMsg('Queued. It fires when Claude Code is open on your computer — the result lands in your Implexa inbox (usually a minute or two once it picks up).');
        setShowRunModal(true);
        return;
      }
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
    <>
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
            : state === 'queued' ? 'Waiting for Claude…'
            : '▶ Run now'}
        </button>
      )}
      <span className={`text-[11px] text-ink-500 max-w-[320px] ${align === 'end' ? 'text-right' : 'text-left'}`}>
        {msg || (isActive
          ? (requiresLocal ? 'Runs in Claude Code, on your computer.' : 'Runs in your Claude.')
          : 'Activate once, then run it anytime.')}
      </span>
      {/* While the run is in flight, point the user at where the RESULT actually
          lands — their Implexa results. We deliberately do NOT deep-link the
          recurring routine's Claude page here: an on-demand Run now fires as a
          separate one-time task, so that page shows the (often paused) schedule
          with a "Skipped" cron, which reads as "broken" (founder hit this). */}
      {(state === 'queued' || state === 'running') && (
        <Link
          href="/inbox"
          className={`text-[11px] text-brand-500 hover:underline ${align === 'end' ? 'text-right' : 'text-left'}`}
        >
          Track it in your results →
        </Link>
      )}
      {/* When does it run next (scheduled agents), grey + small. */}
      {isActive && !msg && nextRunAt && (
        <span className={`text-[11px] text-ink-600 ${align === 'end' ? 'text-right' : 'text-left'}`}>
          Next run: {nextRunLabel(nextRunAt)}
        </span>
      )}
    </div>

    {/* Run-triggered confirmation for a scheduled agent — a clear pop-up instead
        of the barely-visible inline line. */}
    <Modal
      open={showRunModal}
      onClose={() => setShowRunModal(false)}
      title="Run triggered"
      maxWidth="max-w-md"
    >
      <p className="text-sm text-ink-200 leading-relaxed">
        Your agent’s run is queued. It fires the next time <strong>Claude Code is open</strong> on this
        computer to pick it up (usually a minute or two), and the result lands in your{' '}
        <Link href="/inbox" className="text-brand-500 hover:underline" onClick={() => setShowRunModal(false)}>
          Implexa results
        </Link>
        {' '}like any scheduled run. Keep Claude open and you’ll see it come through.
      </p>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={() => setShowRunModal(false)}
          className="btn-success text-sm px-5 py-2"
        >
          OK
        </button>
      </div>
    </Modal>

    {/* Per-run input pop-up: collect the "fresh each run" answers before queuing. */}
    <Modal
      open={showFreshModal}
      onClose={() => { if (!freshSaving) setShowFreshModal(false); }}
      title="Update this run's input"
      maxWidth="max-w-md"
    >
      <p className="text-sm text-ink-300 leading-relaxed mb-4">
        This agent asks for fresh input each time it runs. Confirm or update {freshFields.length === 1 ? 'it' : 'these'} below, then it runs.
      </p>
      <div className="space-y-4">
        {freshFields.map((f) => (
          <div key={f.key}>
            <label className="block text-sm text-ink-200 mb-1.5">{f.question}</label>
            {f.kind === 'choice' && f.options && f.options.length > 0 ? (
              <select
                value={freshValues[f.key] ?? ''}
                onChange={(e) => setFreshValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 focus:border-brand-500/60 focus:outline-none"
              >
                <option value="">Choose…</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={freshValues[f.key] ?? ''}
                onChange={(e) => setFreshValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.kind === 'file' ? 'Paste the file path or link for this run' : 'Type this run’s value'}
                autoFocus
                className={`w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none${f.kind === 'file' ? ' font-mono text-xs' : ''}`}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setShowFreshModal(false)}
          disabled={freshSaving}
          className="btn-outline text-sm px-4 py-2 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={saveFreshAndRun}
          disabled={freshSaving || freshFields.some((f) => (freshValues[f.key] ?? '').toString().trim() === '')}
          className="btn-success text-sm px-5 py-2 disabled:opacity-50"
        >
          {freshSaving ? 'Saving…' : 'Save & run'}
        </button>
      </div>
    </Modal>
    </>
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
