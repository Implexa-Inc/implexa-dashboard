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
import { firstRunPermsSeen, markFirstRunPermsSeen } from './first-run-permissions-note';

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

const MAX_RUN_FILES = 8;
// Marker for the per-run attachment line we bake into the saved note. The note is
// honored on the run via payload.userNote (the saved __agent_note) — the drainer
// runs run_agent_now without the run-request note, so the SAVED note is the path
// that reaches the hands-off run. We strip this line when re-loading the note so
// the textarea only ever shows the user's own prose; it is recomposed on submit.
const ATTACH_MARKER = '📎 Attached for this run';

/** Drop any previously-baked attachment line so the textarea shows only prose. */
function stripAttachLine(note: string): string {
  const i = note.indexOf(ATTACH_MARKER);
  return (i === -1 ? note : note.slice(0, i)).replace(/\s+$/, '');
}

/** Bake the attached file paths into the note that gets saved + honored on the run. */
function composeNoteWithFiles(note: string, files: string[]): string {
  const base = stripAttachLine(note).trim();
  if (!files.length) return base;
  const line = `${ATTACH_MARKER} (read these files as context/feedback): ${files.join(', ')}`;
  return base ? `${base}\n\n${line}` : line;
}

// The desktop bridge (window.implexaDesktop). pickFile opens the native OS picker
// and returns a real absolute path Claude can Read — the same bridge the kind="file"
// config question uses. It only exists inside the Implexa desktop app, so the attach
// affordance is gated on it (a plain browser can't hand Claude a local path).
type DesktopBridge = {
  openAgent?: () => Promise<{ ok: boolean }>;
  handoffAgent?: (prompt: string, surface?: string, target?: string) => Promise<{ ok: boolean; mode?: string }>;
  pickFile?: (opts?: unknown) => Promise<{ ok: boolean; path?: string }>;
};
function desktopBridge(): DesktopBridge | undefined {
  return typeof window !== 'undefined'
    ? (window as Window & { implexaDesktop?: DesktopBridge }).implexaDesktop
    : undefined;
}
function fileName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

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
  // Absolute paths of files the user attaches for THIS run (a screenshot, a doc).
  // Their paths are baked into the note so the hands-off run can Read them.
  const [runFiles, setRunFiles] = useState<string[]>([]);
  // Whether the native file picker bridge is present (desktop app only) — gates
  // the attach affordance, since a plain browser can't give Claude a local path.
  const [canAttach, setCanAttach] = useState(false);
  // What the pre-run pop-up does on submit: queue it hands-off, or open a session
  // to watch (so the note is pushed into the live session you're watching).
  const [preRunMode, setPreRunMode] = useState<'queue' | 'watch'>('queue');
  const requestId = useRef<string | null>(null);
  const pollStart = useRef(0);
  const supabase = createClient();

  // The desktop bridge is only knowable client-side. Gate the attach UI on it.
  useEffect(() => {
    setCanAttach(!!desktopBridge()?.pickFile);
  }, []);

  // Attach a file for this run via the native OS picker (returns an absolute path
  // Claude can Read). One file per click; click again to add more.
  async function attachFile() {
    const bridge = desktopBridge();
    if (!bridge?.pickFile) return;
    const r = await bridge.pickFile().catch(() => null);
    if (r?.ok && r.path) {
      setRunFiles((prev) => (prev.includes(r.path!) ? prev : [...prev, r.path!].slice(0, MAX_RUN_FILES)));
    }
  }
  function removeFile(i: number) {
    setRunFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

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
    // Always fetch (for the saved note). Show the setup fields until the user has
    // dismissed the review for this agent; pre-load the note either way.
    const reviewed = setupReviewed(slug);
    const { schema, answers, note } = await loadSetup();
    setSetupFields(reviewed ? [] : schema);
    setSetupValues(reviewed ? {} : Object.fromEntries(schema.map((f) => [f.key, (answers[f.key] ?? '').toString()])));
    // Show only the user's prose; any attachment line from a prior run is dropped
    // (attachments are per-run — they start empty and re-bake fresh on submit).
    setRunNote(stripAttachLine(note));
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
      // Bake any attached file PATHS into the note. The drainer runs run_agent_now
      // without the run-request note, so run_agent_now honors payload.userNote (this
      // saved note) — making the saved note the channel that carries the paths to
      // the hands-off run, where Claude is told to Read them as context/feedback.
      const noteWithFiles = composeNoteWithFiles(runNote, runFiles);
      // Persist the standing note (always — so it's saved + shown in Setup + honored
      // on every run) plus any reviewed setup answers, in one save.
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup`, {
        jwt: session?.access_token,
        method: 'POST',
        body: { answers: { ...(setupFields.length ? setupValues : {}), __agent_note: noteWithFiles }, source },
      });
      if (setupFields.length && dontShowAgain) markSetupReviewed(slug);
      setShowSetupModal(false);
      // The saved note is injected server-side on every run, so the hands-off queue
      // path needs no per-run note; the watch path puts it (paths included) in the
      // prefilled prompt of the session you're about to supervise.
      if (preRunMode === 'watch') await doWatch(noteWithFiles || undefined);
      else await doQueue();
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
      // First queued run ever → surface the one-time permissions heads-up.
      if (!firstRunPermsSeen()) { setShowPermsNote(true); markFirstRunPermsSeen(); }
      setShowRunModal(true);
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
          onClick={() => setShowRunModal(false)}
          className="btn-success text-sm px-5 py-2"
        >
          OK
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
          ? <>Confirm or change {setupFields.length === 1 ? 'this answer' : 'these answers'} (e.g. swap a reference video), and add anything specific for this run. Saved for next time.</>
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

      {/* Per-run note: always available, rides into THIS run (distinct from the
          saved last-run feedback loop). */}
      <div className={setupFields.length ? 'mt-4' : ''}>
        <label className="block text-sm text-ink-200 mb-1.5">Anything to add for this run? <span className="text-ink-500 font-normal">(optional)</span></label>
        <textarea
          value={runNote}
          onChange={(e) => setRunNote(e.target.value)}
          rows={3}
          autoFocus={setupFields.length === 0}
          placeholder="e.g. make the b-roll punchier; lean on the second reference video; keep it under 30s"
          className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-y"
        />

        {/* Attach a screenshot / file for THIS run. Mirrors the Build box's attach:
            the picked file's absolute PATH is baked into the note above, so the
            hands-off run can Read it. Desktop-only (a browser can't hand over a
            local path) — disabled with a hint everywhere else. */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={attachFile}
            disabled={!canAttach || runFiles.length >= MAX_RUN_FILES}
            title={canAttach
              ? 'Attach a screenshot or file for this run'
              : 'Attach files in the Implexa desktop app'}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 text-ink-300 px-2.5 py-1.5 text-xs hover:border-ink-500 hover:text-ink-100 transition-colors disabled:opacity-40 disabled:hover:border-ink-700 disabled:hover:text-ink-300"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.2 9.19a1 1 0 01-1.41-1.41l8.49-8.49" />
            </svg>
            Attach file
          </button>
          {canAttach && (
            <span className="text-[11px] text-ink-500">A screenshot, PDF, doc — the run reads it as context.</span>
          )}
        </div>

        {/* Attached files as chips (filename + remove). The path is what reaches
            the run; we show only the name to keep it readable. */}
        {runFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {runFiles.map((p, i) => (
              <span
                key={p}
                title={p}
                className="inline-flex items-center gap-1.5 max-w-[220px] rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-200"
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9l-7-7z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 2v7h7" />
                </svg>
                <span className="truncate">{fileName(p)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`Remove ${fileName(p)}`}
                  className="text-ink-500 hover:text-rose-400 leading-none"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
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
