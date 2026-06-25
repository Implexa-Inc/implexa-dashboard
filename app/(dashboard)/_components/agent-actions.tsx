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
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import Modal from './modal';
import { firstRunPermsSeen, markFirstRunPermsSeen } from './first-run-permissions-note';
import { AttachFiles, composeNoteWithFiles, useRunAttachments } from './run-attachments';

type RunState = 'idle' | 'queuing' | 'queued' | 'running' | 'done' | 'error';
type SetupField = { key: string; question: string; kind: 'text' | 'choice' | 'file'; options?: string[] };

// "Review setup before running" is shown the FIRST time you run an agent that has
// setup questions, with a "don't show again for this agent" opt-out. Dismissal is
// a per-device UI nudge (localStorage), keyed by agent slug — losing it on a new
// device just re-shows the (harmless) confirm once.
function setupReviewed(slug: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(`implexa:setup-reviewed:${slug}`) === '1'; } catch { return false; }
}
function markSetupReviewed(slug: string) {
  try { localStorage.setItem(`implexa:setup-reviewed:${slug}`, '1'); } catch { /* private mode / blocked */ }
}

const POLL_MS = 5000;
const POLL_MAX_MS = 5 * 60 * 1000; // stop after 5 min; the run still lands in the inbox

// The per-run note + attached file PATHS plumbing (the picker, the chips, the note
// composition) is shared with the universal "Continue this run" box — see
// ./run-attachments. The per-run note rides the run-request `note` (a one-off
// channel), never the saved standing note.

export default function AgentActions({ slug, name, isActive, requiresLocal, source = 'generated', nextRunAt, pendingQuestions = 0, claudeTaskId, align = 'end', inFlight = null }: {
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
  /** Server-observed in-flight run for THIS agent (a queued run-request the drainer
   *  hasn't picked up, or a live run) — so opening the agent shows Queued/Running
   *  instead of always "Run now". Kept fresh by a live-feed poll below. */
  inFlight?: 'queued' | 'running' | null;
}) {
  const [state, setState] = useState<RunState>(inFlight ?? 'idle');
  const [msg, setMsg] = useState(
    inFlight === 'running' ? 'Running in Claude Code…'
      : inFlight === 'queued' ? 'Queued. Waiting for your Claude to pick it up — the result lands in your inbox.'
      : '');
  const [showRunModal, setShowRunModal] = useState(false);
  // One-time permissions heads-up inside the run-triggered modal, shown on the
  // user's first queued run (shared SEEN flag with the Home note so it never
  // double-shows across surfaces).
  const [showPermsNote, setShowPermsNote] = useState(false);
  // Setup-review pop-up: shown the first time you run an agent that has setup
  // questions (prefilled), so you can confirm/change answers (e.g. swap a
  // reference video) before a hands-off run. Per-agent "don't show again".
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [setupFields, setSetupFields] = useState<SetupField[]>([]);
  const [setupValues, setSetupValues] = useState<Record<string, string>>({});
  const [setupSaving, setSetupSaving] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  // Free-text note the user attaches to THIS run (a tweak/comment), rides into it.
  const [runNote, setRunNote] = useState('');
  // Per-run file attachments (absolute paths) via the native picker — shared with
  // the Continue box. Their paths are baked into the note so the hands-off run reads them.
  const { files: runFiles, setFiles: setRunFiles, canAttach, attachFile, removeFile } = useRunAttachments();
  // What the pre-run pop-up does on submit: queue it hands-off, or open a session
  // to watch (so the note is pushed into the live session you're watching).
  const [preRunMode, setPreRunMode] = useState<'queue' | 'watch'>('queue');
  const requestId = useRef<string | null>(null);
  const pollStart = useRef(0);
  const supabase = createClient();
  const router = useRouter();

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

  // Externally-observed in-flight run: queued/running came from the SERVER (the
  // `inFlight` prop), not a run kicked off in this tab — so there's no requestId
  // to poll. Track it via the live feed instead, so the button follows
  // queued → running → done without a reload, then frees up to "Run now" again.
  useEffect(() => {
    if (requestId.current) return;            // user-initiated runs use the poll above
    if (state !== 'queued' && state !== 'running') return;
    let alive = true;
    let misses = 0;
    const t = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend('/api/v2/scheduled-skills/live', { jwt: session?.access_token });
        if (!alive) return;
        const items: Array<{ skillSlug?: string; status?: string }> = Array.isArray(res?.items) ? res.items : [];
        const card = items.find((c) => c.skillSlug === slug && (c.status === 'queued' || c.status === 'running'));
        if (card) {
          misses = 0;
          setState(card.status as RunState);
          setMsg(card.status === 'running'
            ? 'Running in Claude Code…'
            : 'Queued. Waiting for your Claude to pick it up — the result lands in your inbox.');
        } else if (++misses >= 2) {            // gone for two polls → finished; allow Run now again
          clearInterval(t);
          setState('idle');
          setMsg('');
        }
      } catch { /* transient — keep polling */ }
    }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
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
    // Run now ALWAYS opens the pre-run pop-up so you can add a note for this run
    // (and review setup until you've dismissed it for this agent).
    await openPreRun('queue');
  }

  // "Open in a session to watch" also goes through the pop-up, so your note is
  // pushed into the live session you're about to supervise.
  async function openWatch() {
    await openPreRun('watch');
  }

  async function openPreRun(mode: 'queue' | 'watch') {
    if (state === 'queuing' || state === 'running') return;
    setPreRunMode(mode);
    setDontShowAgain(false);
    // Fetch the setup schema/answers. Show the setup fields until the user has
    // dismissed the review for this agent.
    const reviewed = setupReviewed(slug);
    const { schema, answers } = await loadSetup();
    setSetupFields(reviewed ? [] : schema);
    setSetupValues(reviewed ? {} : Object.fromEntries(schema.map((f) => [f.key, (answers[f.key] ?? '').toString()])));
    // The per-run note + attachments are ONE-OFF (they ride the run-request, not the
    // saved standing note) — so they always start empty here, never pre-loaded from
    // the saved note. The standing note is edited in the Setup card, not this pop-up.
    setRunNote('');
    setRunFiles([]);
    setShowSetupModal(true);
  }

  async function loadSetup(): Promise<{ schema: SetupField[]; answers: Record<string, string>; note: string }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const setup = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup?source=${encodeURIComponent(source)}`, { jwt: session?.access_token });
      const schema: SetupField[] = Array.isArray(setup?.schema) ? setup.schema : [];
      const answers: Record<string, string> = (setup?.answers && typeof setup.answers === 'object') ? setup.answers : {};
      const note: string = typeof setup?.note === 'string' ? setup.note : '';
      return { schema, answers, note };
    } catch { return { schema: [], answers: {}, note: '' }; }
  }

  // Submit the pop-up: save any reviewed setup (+ remember the dismissal), then
  // either queue it hands-off or open a session to watch — carrying the note.
  async function submitPreRun() {
    if (setupFields.some((f) => (setupValues[f.key] ?? '').toString().trim() === '')) return; // all required
    setSetupSaving(true);
    setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // The PER-RUN note: the user's one-off prose for THIS run + any attached file
      // PATHS, combined. It is one-off — it rides the run-request `note` (queue path)
      // or the prefilled prompt (watch path), and is NEVER written to the saved
      // standing note (__agent_note). The drainer reads it back from the request's
      // `intent` and passes it to run_agent_now, which combines it with the standing
      // note for the run. Net: the saved note stays clean; this applies to just this run.
      const perRunNote = composeNoteWithFiles(runNote, runFiles);
      // Save ONLY reviewed setup answers (when the setup-review was shown) — never the
      // standing note here, so per-run additions can't mutate it. The standing note is
      // edited in the Setup card.
      if (setupFields.length) {
        await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup`, {
          jwt: session?.access_token,
          method: 'POST',
          body: { answers: setupValues, source },
        });
        if (dontShowAgain) markSetupReviewed(slug);
      }
      setShowSetupModal(false);
      // Carry the per-run note into the run: the queue path sends it as the run-request
      // `note`; the watch path puts it (paths included) in the prefilled prompt of the
      // session you're about to supervise.
      if (preRunMode === 'watch') await doWatch(perRunNote || undefined);
      else await doQueue(perRunNote || undefined);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save your input. Try again.');
    } finally {
      setSetupSaving(false);
    }
  }

  // PRIMARY path: always queue. The drainer (or an open Claude session's hook)
  // runs it hands-off on the user's machine — same for every agent, so there's no
  // confusing split and no double-run. The result lands in the inbox.
  async function doQueue(note?: string) {
    if (state === 'queuing' || state === 'running') return;
    setState('queuing');
    setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: { workflowSlug: slug, source: 'dashboard', kind: 'run', ...(note ? { note } : {}) },
      });
      requestId.current = res?.request?.id || null;
      pollStart.current = Date.now();
      setState('queued');
      setMsg('Queued. It runs hands-off on your computer (Claude open / Mac awake) — the result lands in your Implexa inbox, usually within a few minutes.');
      // Land the user where the run actually shows itself starting — the Active
      // Agents loader on /workflows (founder ask: "redirect to agent home so I can
      // see the loader starting"). EXCEPTION: on the very first queued run ever,
      // show the one-time permissions heads-up modal first, then redirect when they
      // acknowledge — so that crucial note isn't skipped past.
      if (!firstRunPermsSeen()) {
        setShowPermsNote(true);
        markFirstRunPermsSeen();
        setShowRunModal(true);
      } else {
        router.push('/workflows');
      }
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error ? e.message : 'Could not queue the run. Try again.');
    }
  }

  // SECONDARY path: open Claude Code with the run PREFILLED so the user can watch
  // / supervise it live. Deliberately does NOT queue a run-request, so the drainer
  // won't also fire it (no double-run). The per-run note is pushed into the prompt
  // so it's part of the session you're watching.
  async function doWatch(note?: string) {
    setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Thread saved answers into the prompt so it doesn't stop to ask; the user
      // can still edit them in the session before hitting enter.
      let settings = '';
      try {
        const setup = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup?source=${encodeURIComponent(source)}`, { jwt: session?.access_token });
        const schema: Array<{ key: string; question: string }> = Array.isArray(setup?.schema) ? setup.schema : [];
        const answers: Record<string, string> = (setup?.answers && typeof setup.answers === 'object') ? setup.answers : {};
        const pairs = schema
          .filter((f) => (answers[f.key] ?? '').toString().trim() !== '')
          .map((f) => `${f.question} ${answers[f.key]}`);
        if (pairs.length) settings = ` Use these saved answers, do not ask again: ${pairs.join('; ')}.`;
      } catch { /* run without inline settings */ }
      const noteClause = note ? ` For THIS run specifically: ${note}` : '';
      const runCommand = `Run my Implexa agent "${name || slug}".${settings}${noteClause}`;
      try { await navigator.clipboard.writeText(runCommand); } catch { /* best-effort */ }
      const bridge = typeof window !== 'undefined'
        ? (window as Window & { implexaDesktop?: {
            openAgent?: () => Promise<{ ok: boolean }>;
            handoffAgent?: (prompt: string, surface?: string, target?: string) => Promise<{ ok: boolean; mode?: string }>;
          } }).implexaDesktop
        : undefined;
      if (bridge?.handoffAgent) {
        const h = await bridge.handoffAgent(runCommand, undefined, 'code').catch(() => null);
        setMsg(h && h.ok && h.mode === 'deeplink'
          ? 'Opening Claude Code with the run prefilled — review it and hit enter.'
          : 'Opening Claude. Paste the command we copied and hit enter.');
      } else if (bridge?.openAgent) {
        await bridge.openAgent().catch(() => null);
        setMsg('Opening Claude. Paste the command we copied and hit enter.');
      } else {
        setMsg('Copied a run command to your clipboard — paste it into Claude and hit enter.');
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not open a session.');
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
            : state === 'queued' ? 'Queued ✓'
            : '▶ Run now'}
        </button>
      )}
      {/* Secondary: supervise the run live instead of hands-off. Goes through the
          same pop-up (so the note rides into the watched session). Shown only
          before queuing so the paths stay mutually exclusive (no double-run). */}
      {isActive && pendingQuestions === 0 && (state === 'idle' || state === 'error') && (
        <button
          type="button"
          onClick={openWatch}
          className={`text-[11px] text-ink-400 hover:text-ink-200 underline-offset-2 hover:underline ${align === 'end' ? 'text-right' : 'text-left'}`}
        >
          Open in a session to watch ↗
        </button>
      )}
      <span className={`text-[11px] text-ink-500 max-w-[320px] ${align === 'end' ? 'text-right' : 'text-left'}`}>
        {msg || (isActive
          ? (requiresLocal ? 'Runs in Claude Code, on your computer.' : 'Runs in your Claude.')
          : 'Activate once, then run it anytime.')}
      </span>
      {/* While the run is in flight, point the user at where it shows LIVE — the
          "Active Agents" section on the Agents page (polls the live feed). We
          deliberately do NOT deep-link the recurring routine's Claude page here:
          an on-demand Run now fires as a separate one-time task, so that page
          shows the (often paused) schedule with a "Skipped" cron, which reads as
          "broken" (founder hit this). */}
      {(state === 'queued' || state === 'running') && (
        <Link
          href="/workflows"
          className={`text-[11px] text-brand-500 hover:underline ${align === 'end' ? 'text-right' : 'text-left'}`}
        >
          Track it under Active Agents →
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
      {showPermsNote && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs text-ink-200 leading-relaxed">
            <span className="font-medium text-ink-50">Heads up:</span> your first run may pause for a
            permission it can’t auto-approve. Watch Alerts (Active Agents / Home), your email, or a
            desktop notification. Approving is one tap.
          </p>
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={() => { setShowRunModal(false); router.push('/workflows'); }}
          className="btn-success text-sm px-5 py-2"
        >
          Track it under Active Agents →
        </button>
      </div>
    </Modal>

    {/* Setup-review pop-up: shown the first time you run an agent (prefilled), so
        you can confirm/change answers before a hands-off run. Dismissable. */}
    <Modal
      open={showSetupModal}
      onClose={() => { if (!setupSaving) setShowSetupModal(false); }}
      title={preRunMode === 'watch' ? 'Before it opens in Claude' : setupFields.length ? 'Before it runs' : 'Add a note for this run'}
      maxWidth="max-w-md"
    >
      <p className="text-sm text-ink-300 leading-relaxed mb-4">
        {setupFields.length
          ? <>Confirm or change {setupFields.length === 1 ? 'this answer' : 'these answers'} (e.g. swap a reference video) — saved for next time — and add anything for just this run below.</>
          : <>Add anything you want this run to do differently (optional).</>}
        {' '}{preRunMode === 'watch'
          ? 'It opens in Claude Code with your note included, so you can watch.'
          : 'It runs hands-off; the result lands in your inbox.'}
      </p>
      {setupFields.length > 0 && (
        <div className="space-y-4">
          {setupFields.map((f) => (
            <div key={f.key}>
              <label className="block text-sm text-ink-200 mb-1.5">{f.question}</label>
              {f.kind === 'choice' && f.options && f.options.length > 0 ? (
                <select
                  value={setupValues[f.key] ?? ''}
                  onChange={(e) => setSetupValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 focus:border-brand-500/60 focus:outline-none"
                >
                  <option value="">Choose…</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={setupValues[f.key] ?? ''}
                  onChange={(e) => setSetupValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.kind === 'file' ? 'Paste a file path or link' : 'Type your answer'}
                  className={`w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none${f.kind === 'file' ? ' font-mono text-xs' : ''}`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Per-run note: always available, rides into THIS run only (distinct from
          the Setup-tab "Change how this agent works" box, which is permanent). */}
      <div className={setupFields.length ? 'mt-4' : ''}>
        <label className="block text-sm text-ink-200 mb-1">Anything to add for this run? <span className="text-ink-500 font-normal">(just this run)</span></label>
        <p className="text-[11px] text-ink-500 mb-1.5">Steers this one run only — it doesn’t change the agent. To change it for every run, use “Change how this agent works” in Setup.</p>
        <textarea
          value={runNote}
          onChange={(e) => setRunNote(e.target.value)}
          rows={3}
          autoFocus={setupFields.length === 0}
          placeholder="e.g. make the b-roll punchier; lean on the second reference video; keep it under 30s"
          className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-y"
        />

        {/* Attach a screenshot / file for THIS run. The picked file's absolute PATH
            is baked into the note above so the hands-off run can Read it. Desktop-only
            (a browser can't hand over a local path) — disabled with a hint elsewhere. */}
        <AttachFiles files={runFiles} canAttach={canAttach} onAttach={attachFile} onRemove={removeFile} />
      </div>

      {setupFields.length > 0 && (
        <label className="mt-3 flex items-center gap-2 text-xs text-ink-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="accent-brand-500 h-3.5 w-3.5"
          />
          Skip the setup review for this agent next time (you can still add a note)
        </label>
      )}
      <div className="mt-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setShowSetupModal(false)}
          disabled={setupSaving}
          className="btn-outline text-sm px-4 py-2 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submitPreRun}
          disabled={setupSaving || setupFields.some((f) => (setupValues[f.key] ?? '').toString().trim() === '')}
          className="btn-success text-sm px-5 py-2 disabled:opacity-50"
        >
          {setupSaving ? 'Saving…' : preRunMode === 'watch' ? 'Open in Claude →' : setupFields.length ? 'Save & run' : '▶ Run now'}
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
