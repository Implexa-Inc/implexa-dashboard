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
import { callBackend, BackendError } from '@/lib/api';
import { confirmedRunRequestId } from '@/lib/run-request-receipt';
import Modal from './modal';
import SetupChoiceField from './setup-choice-field';
import { firstRunPermsSeen, markFirstRunPermsSeen } from './first-run-permissions-note';
import { getAgentNoteDraft, clearAgentNoteDraft } from '@/lib/agent-note-draft';
import { AttachFiles, composeNoteWithFiles, desktopBridge, fileName, useRunAttachments } from './run-attachments';
import CapabilityCard, { type CapabilityCardData } from './capability-card';
import {
  acceptsDirectorySnapshot, bindInputValue, missingRequiredInputs, orderedInputFields, reusablePreferences,
  resolvePickerResult, serializeArtifactBindings,
  type ArtifactBinding, type RunInputBindings, type WorkflowInputContract, type WorkflowInputField,
} from '@/lib/workflow-input-contract';
import {
  bindSavedArtifact, displayedInputValue, inputOrigin, savedInputLabel,
  readSavedRunInputs, resolveEffectiveInputs, resolveSavedBindResult,
  type RunInputOverrides,
} from '@/lib/run-input-defaults';

type RunState = 'idle' | 'queuing' | 'queued' | 'running' | 'done' | 'error';
type SetupField = {
  key: string; question: string; kind: 'text' | 'choice' | 'file'; options?: string[];
  /** A PREFERENCE — must never block Run. */
  optional?: boolean;
  /** Used when unanswered. Its presence implies optional (same rule as the server). */
  default?: string | null;
};
// ONE tier rule, matching normalizeConfigSchema on the server: a field is optional
// when the author says so, or when it ships a usable default.
const isOptionalField = (f: SetupField) =>
  !!f.optional || (f.default !== undefined && f.default !== null && f.default !== '');

// COLLAPSE preference for the pre-run settings review (per-device, keyed by slug).
//
// This used to mean HIDE: once ticked, future Run clicks showed only the per-run
// note and the agent's saved answers vanished from the dialog. That is how a user
// ends up re-running with stale inputs and getting duplicate work — they could no
// longer see what the agent was about to use. Settings are now always PRESENT and
// only start collapsed, so the information is one click away instead of gone.
function setupCollapsed(slug: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(`implexa:setup-collapsed:${slug}`) === '1'; } catch { return false; }
}
function markSetupCollapsed(slug: string) {
  try { localStorage.setItem(`implexa:setup-collapsed:${slug}`, '1'); } catch { /* private mode / blocked */ }
}

const POLL_MS = 5000;
const POLL_MAX_MS = 5 * 60 * 1000; // stop after 5 min; the run still lands in the inbox

// The per-run note + attached file PATHS plumbing (the picker, the chips, the note
// composition) is shared with the universal "Continue this run" box — see
// ./run-attachments. The per-run note rides the run-request `note` (a one-off
// channel), never the saved standing note.

export default function AgentActions({ slug, name, isActive, requiresLocal, source = 'generated', nextRunAt, pendingQuestions = 0, blockingQuestions, claudeTaskId, align = 'end', inFlight = null, revisePending = false, workflowVersionId = null, inputContract = null, inputContractDigest = null }: {
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
  /** Required-only. Optional PREFERENCES must never block Run — that was the whole
   *  point of splitting the tiers. Absent (older backend) → fall back to the
   *  total, which is the pre-change behaviour. */
  blockingQuestions?: number;
  /** Claude routine id — lets "Running…" deep-link the routine's page in Claude. */
  claudeTaskId?: string | null;
  /** 'end' on the detail page header; 'start' inside the activation card. */
  align?: 'start' | 'end';
  /** Server-observed in-flight run for THIS agent (a queued run-request the drainer
   *  hasn't picked up, or a live run) — so opening the agent shows Queued/Running
   *  instead of always "Run now". Kept fresh by a live-feed poll below. */
  inFlight?: 'queued' | 'running' | null;
  /** A queued/in-progress EDIT (kind='revise') is rewriting this agent's steps.
   *  While true, Run now is disabled (running the OLD version mid-rewrite is a
   *  footgun) and relabelled "Updating…". Cleared server-side once the rewrite
   *  lands; we poll router.refresh() so the button frees up without a reload. */
  revisePending?: boolean;
  workflowVersionId?: string | null;
  inputContract?: WorkflowInputContract | null;
  inputContractDigest?: string | null;
}) {
  // ONE gate expression. Optional preferences never stop a run.
  const blocking = blockingQuestions ?? pendingQuestions;
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
  const [setupOpen, setSetupOpen] = useState(true);
  // Duplicate-work backstop: the prior run this one would repeat, if any.
  const [dupe, setDupe] = useState<{ message: string; runId: string | null; fingerprint: string | null } | null>(null);
  // Free-text note the user attaches to THIS run (a tweak/comment), rides into it.
  const [runNote, setRunNote] = useState('');
  // The agent's STANDING note ("Notes for this agent", honored every run). Shown in
  // the pop-up so it's visibly in effect and not lost when the user edits it in
  // Setup and hits Run before Save; saved on submit. Distinct from runNote above.
  const [standingNote, setStandingNote] = useState('');
  const [loadedStandingNote, setLoadedStandingNote] = useState('');
  // Per-run file attachments (absolute paths) via the native picker — shared with
  // the Continue box. Their paths are baked into the note so the hands-off run reads them.
  const { files: runFiles, setFiles: setRunFiles, canAttach, canAttachFolder, attachFile, attachFolder, removeFile, error: attachError } = useRunAttachments();
  // What the pre-run pop-up does on submit: queue it hands-off, or open a session
  // to watch (so the note is pushed into the live session you're watching).
  const [preRunMode, setPreRunMode] = useState<'queue' | 'watch'>('queue');
  // The pre-run capability ask (backend 409 + needsCapability): this agent needs
  // something the engine it would run on doesn't have. Not an error state — a choice
  // (switch engine / grant it / run anyway), so it renders as a card, not a failure.
  const [capCard, setCapCard] = useState<CapabilityCardData | null>(null);
  const typedFields = orderedInputFields(inputContract);
  // TWO LAYERS, kept apart on purpose (see lib/run-input-defaults).
  //   inputDefaults  — what the user SAVED in Setup. Reused on every run.
  //   inputOverrides — what they changed in THIS pop-up. This run only, and
  //                    never written back to the saved answer.
  // Merged (blanks dropped) into the bindings the run receives. Before this,
  // there was only the second layer and it started empty — so an agent whose
  // setup was complete still opened Run now with every control blank.
  const [inputDefaults, setInputDefaults] = useState<RunInputBindings>({});
  const [inputOverrides, setInputOverrides] = useState<RunInputOverrides>({});
  /** The saved answers as text, for naming the source a file field starts from. */
  const [savedInputValues, setSavedInputValues] = useState<Record<string, string>>({});
  /** File keys whose saved path this machine is still verifying. */
  const [verifyingInputs, setVerifyingInputs] = useState<string[]>([]);
  const [inputSessionId, setInputSessionId] = useState<string | null>(null);
  // React state is not a synchronization primitive. Saved-file verification
  // and the manual picker can run concurrently, so both read/write this ref and
  // are bound to one session chosen before either async bridge call starts.
  const inputSessionRef = useRef<string | null>(null);
  const inputBindings = resolveEffectiveInputs(inputContract, inputDefaults, inputOverrides);
  // Per-field picker/registration failures. Keyed by contract field key so the
  // message lands on the field the user was actually filling in.
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  function setInputError(key: string, message: string | null) {
    setInputErrors((previous) => {
      if (!message) {
        if (!(key in previous)) return previous;
        const next = { ...previous };
        delete next[key];
        return next;
      }
      return { ...previous, [key]: message };
    });
  }
  // The note the blocked attempt carried, so a retry after switching/granting keeps it.
  const lastNote = useRef<string | undefined>(undefined);
  // The fingerprint computed by the LAST precheck, kept alongside lastNote because
  // every retry path replays this run and must carry it. `force` deliberately skips
  // the precheck (so the confirm cannot loop), which means a forced retry has no
  // other way to obtain one — and a request stored without a fingerprint can never
  // trigger a future duplicate warning. Retries that silently drop it make the
  // backstop leaky in exactly the case where the user already hit friction.
  const lastFingerprint = useRef<string | null>(null);
  const requestId = useRef<string | null>(null);
  const pollStart = useRef(0);
  // Mirrors `state`, readable inside the mount-once external-poll effect below
  // without putting `state` in its dependency array (that would tear down and
  // restart the interval — and lose `misses` — on every status flip).
  const stateRef = useRef<RunState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const supabase = createClient();
  const router = useRouter();

  // Preserve semantic identity across remount/back navigation. Only opaque ids,
  // digests, and display names are stored; local paths remain Desktop-local.
  //
  // OVERRIDES ONLY. The saved defaults are the server's to state and are reloaded
  // whenever the pop-up opens; keeping a copy here would let a stale one outlive
  // an edit made in Setup. What must survive a remount is the per-run change the
  // user made in this pop-up and would otherwise silently lose.
  useEffect(() => {
    if (!workflowVersionId || typeof window === 'undefined') return;
    const key = `implexa:run-inputs:${slug}:${workflowVersionId}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || '{}');
      if (saved?.overrides && typeof saved.overrides === 'object') setInputOverrides(saved.overrides);
      if (typeof saved?.inputSessionId === 'string') {
        inputSessionRef.current = saved.inputSessionId;
        setInputSessionId(saved.inputSessionId);
      }
    } catch { /* malformed/stale browser state is ignored */ }
  }, [slug, workflowVersionId]);

  useEffect(() => {
    if (!workflowVersionId || typeof window === 'undefined') return;
    const key = `implexa:run-inputs:${slug}:${workflowVersionId}`;
    try { sessionStorage.setItem(key, JSON.stringify({ overrides: inputOverrides, inputSessionId })); } catch { /* private mode */ }
  }, [slug, workflowVersionId, inputOverrides, inputSessionId]);

  async function chooseTypedInput(field: WorkflowInputField, selection: 'file' | 'directory' = 'file') {
    const bridge = desktopBridge();
    if (!bridge?.pickRunInput) return;
    setInputError(field.key, null);
    const sessionId = inputSessionRef.current || crypto.randomUUID();
    inputSessionRef.current = sessionId;
    setInputSessionId(sessionId);
    const current = inputBindings[field.key];
    const replaced = field.cardinality === 'one' && current && typeof current === 'object' && !Array.isArray(current)
      ? current as ArtifactBinding : null;
    const result = await bridge.pickRunInput({
      inputKey: field.key,
      inputSessionId: sessionId,
      selection,
      ...(replaced ? { replacesArtifactId: replaced.artifactId } : {}),
      ...(field.accept ? { accept: field.accept } : {}),
    }).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : 'bridge_unavailable' }));
    // The requested kind is passed through so a Desktop too old to freeze
    // folders — which ignores `selection` and returns a file from its FILE
    // dialog — fails honestly instead of binding what the user did not ask for.
    const outcome = resolvePickerResult(result, field, selection);
    // A cancel changes nothing: no error, and any file already bound to this
    // field stays bound.
    if (outcome.kind === 'canceled') return;
    if (outcome.kind === 'failed') { setInputError(field.key, outcome.message); return; }
    if (outcome.inputSessionId !== sessionId) {
      setInputError(field.key, 'The Desktop returned this file for a different run-input session. Please choose it again.');
      return;
    }
    inputSessionRef.current = sessionId;
    setInputSessionId(outcome.inputSessionId);
    // A picked file is a change made HERE, so it lands in the override layer and
    // affects this run alone. The saved answer stays exactly as Setup left it.
    setInputOverrides((previous) => bindInputValue(previous, field, outcome.binding));
  }

  /**
   * Turn the paths the user saved for file inputs into bindings this run can use.
   *
   * Verification, not trust: Desktop re-hashes the saved file and registers it
   * afresh, so the run receives a digest of the bytes on disk now rather than a
   * promise made when the path was typed. A browser has no way to do that, which
   * is why the saved path is still SHOWN there — a valid saved source must never
   * read as missing just because a native file control is empty.
   */
  async function verifySavedFileInputs(fields: WorkflowInputField[], sessionId: string) {
    const bridge = desktopBridge();
    if (!bridge?.bindSavedRunInput || !fields.length) return;
    setVerifyingInputs(fields.map((field) => field.key));
    for (const field of fields) {
      const result = await bridge.bindSavedRunInput({
        slug, source, inputKey: field.key,
        inputSessionId: sessionId,
        ...(field.accept ? { accept: field.accept } : {}),
      }).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : 'bridge_unavailable' }));
      setVerifyingInputs((previous) => previous.filter((key) => key !== field.key));
      const outcome = resolveSavedBindResult(result, field);
      // Say why. A saved source that silently fails to bind is the blank form
      // again, one layer down — an empty control and no reason for it.
      if (outcome.kind === 'failed') { setInputError(field.key, outcome.message); continue; }
      if (outcome.inputSessionId !== sessionId) {
        setInputError(field.key, 'The saved file was verified for a different run-input session. Choose it again for this run.');
        continue;
      }
      inputSessionRef.current = sessionId;
      setInputSessionId(sessionId);
      // A verified saved file is still the DEFAULT, not an override: the user
      // did not choose it in this pop-up, they saved it once in Setup.
      setInputDefaults((previous) => bindSavedArtifact(previous, field, outcome.binding));
    }
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

  // Externally-observed in-flight run: queued/running came from the SERVER (the
  // `inFlight` prop) OR from a run queued on a DIFFERENT surface in this same
  // session — most notably <RunContinueBox/> on the run detail page's "Continue
  // this run" (2026-07-18 founder report: queuing a continue, closing that
  // pop-up, and coming back to the agent page still showed "Run now" instead of
  // "Queued ✓"). Either way there's no requestId to poll (this component didn't
  // start the run), so track it via the live feed instead — polling UNCONDITIONALLY
  // from mount (not gated on state already being queued/running) is what lets it
  // DISCOVER a run that started elsewhere, not just follow one it already knew
  // about. So the button follows idle → queued → running → done without a reload.
  useEffect(() => {
    if (requestId.current) return;            // user-initiated runs use the poll above
    let alive = true;
    let misses = 0;
    const t = setInterval(async () => {
      if (requestId.current) return;          // a run started from THIS component mid-poll — defer to its own poll
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
        } else if (stateRef.current === 'queued' || stateRef.current === 'running') {
          // Only reset to idle once we'd SEEN a queued/running card and then lost
          // it twice in a row (finished) — never reset on a plain "still idle,
          // never found anything" tick (that's the common case now this effect
          // polls unconditionally), or a slow first poll could flash the button
          // back to "Run now" for a run that just hasn't shown up in the feed yet.
          if (++misses >= 2) {
            clearInterval(t);
            setState('idle');
            setMsg('');
          }
        }
      } catch { /* transient — keep polling */ }
    }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a rewrite (kind='revise') is pending, poll the server view so the
  // "Updating…" state clears on its own once the user's Claude lands the new
  // version (revisePending is computed server-side). Bounded so a stuck revise
  // doesn't refresh forever; the user can always reload.
  useEffect(() => {
    if (!revisePending) return;
    const start = Date.now();
    const t = setInterval(() => {
      if (Date.now() - start > 10 * 60 * 1000) { clearInterval(t); return; }
      router.refresh();
    }, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisePending]);

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
    if (blocking > 0) { surfaceQuestions(); return; }
    // Run now ALWAYS opens the pre-run pop-up so you can add a note for this run
    // (and review setup until you've dismissed it for this agent).
    await openPreRun('queue');
  }

  // "Open in a session to watch" also goes through the pop-up, so your note is
  // pushed into the live session you're about to supervise.
  async function openWatch() {
    await openPreRun('watch');
  }

  // The ONE gate expression for the dialog. Optional preferences are excluded by
  // construction, so no later edit can accidentally re-require them.
  const blankRequired = setupFields.filter((f) => !isOptionalField(f) && (setupValues[f.key] ?? '').toString().trim() === '');

  async function openPreRun(mode: 'queue' | 'watch') {
    if (state === 'queuing' || state === 'running') return;
    setPreRunMode(mode);
    setDontShowAgain(false);
    // A fresh attempt: drop the previous fingerprint so a stale one can never be
    // stamped onto a run whose note or files have since changed.
    lastFingerprint.current = null;
    // ALWAYS load and keep the settings — before launching work the user must be
    // able to see and adjust what the agent will use. The preference only decides
    // whether the section starts collapsed.
    const { schema, answers, note, runInputDefaults } = await loadSetup();
    // Preferences only. A question this contract has superseded — by sharing its
    // key or by naming it in `replaces` — belongs to the Run Inputs section
    // below, and rendering it here too is how the form came to ask for the raw
    // video twice under two names.
    const durableSetup = reusablePreferences(schema, inputContract);
    setSetupFields(durableSetup);
    setSetupValues(Object.fromEntries(durableSetup.map((f) => [f.key, (answers[f.key] ?? '').toString()])));
    // …and the other half of that same split: the questions this contract DID
    // take over are answered here, from the answers the user already saved under
    // those very keys. Filtering them out of the section above without seeding
    // them here is what made the pop-up open blank on a fully-configured agent.
    const savedInputs = readSavedRunInputs(inputContract, runInputDefaults);
    setSavedInputValues(savedInputs.values);
    setInputDefaults(savedInputs.bindable);
    setInputErrors({});
    // Freeze one identity before either automatic verification or a user click
    // can start. Reuse a restored session only while its per-run overrides are
    // still alive; a successful queue clears both below.
    const modalInputSessionId = inputSessionRef.current || crypto.randomUUID();
    inputSessionRef.current = modalInputSessionId;
    setInputSessionId(modalInputSessionId);
    setSetupOpen(!setupCollapsed(slug));
    // Seed the standing note: prefer the live (possibly unsaved) draft the Setup
    // card mirrored, so a note typed-but-not-saved before clicking Run is carried;
    // else the saved note. loadedStandingNote tracks the SAVED baseline for dirty
    // detection on submit.
    const draft = getAgentNoteDraft(slug);
    setLoadedStandingNote(note);
    setStandingNote(draft !== undefined ? draft : note);
    // The per-run note + attachments are ONE-OFF (they ride the run-request, not the
    // saved standing note) — so they always start empty here, never pre-loaded from
    // the saved note. The standing note is edited in the Setup card, not this pop-up.
    setRunNote('');
    setRunFiles([]);
    setShowSetupModal(true);
    // Files are verified on the machine that holds them, so the pop-up opens
    // NOW and each saved source resolves into it. Blocking the dialog on a
    // several-hundred-megabyte hash would trade one bad Run click for another.
    void verifySavedFileInputs(savedInputs.filesToVerify, modalInputSessionId);
  }

  async function loadSetup(): Promise<{
    schema: SetupField[]; answers: Record<string, string>; note: string;
    runInputDefaults: Record<string, string>;
  }> {
    const empty = { schema: [], answers: {}, note: '', runInputDefaults: {} };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const setup = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup?source=${encodeURIComponent(source)}`, { jwt: session?.access_token });
      const schema: SetupField[] = Array.isArray(setup?.schema) ? setup.schema : [];
      const answers: Record<string, string> = (setup?.answers && typeof setup.answers === 'object') ? setup.answers : {};
      const note: string = typeof setup?.note === 'string' ? setup.note : '';
      // The server resolves this against the contract version THIS user is
      // pinned to, and it already excludes every retired key — so a superseded
      // answer cannot arrive here and stand in for the input that replaced it.
      // An older backend that does not send it leaves the form asking, which is
      // the behaviour that existed before this field did.
      const runInputDefaults: Record<string, string> = (setup?.runInputDefaults && typeof setup.runInputDefaults === 'object')
        ? setup.runInputDefaults : {};
      return { schema, answers, note, runInputDefaults };
    } catch { return empty; }
  }

  // Submit the pop-up: save any reviewed setup (+ remember the dismissal), then
  // either queue it hands-off or open a session to watch — carrying the note.
  async function submitPreRun() {
    // REQUIRED-ONLY. Blocking on every displayed field made an optional preference
    // — correctly skippable during activation — required again at the first Run
    // click, which silently undid the whole tier split one surface later.
    if (blankRequired.length || missingRequiredInputs(inputContract, inputBindings).length) return;
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
      const perRunNote = typedFields.length ? runNote.trim() : composeNoteWithFiles(runNote, runFiles);
      // Persist reviewed setup answers AND the (explicit, clearly-labeled) standing
      // note — the ONE-OFF runNote above is still never written to the standing note.
      // Saving the standing note here is what stops a note typed in Setup (or edited
      // in this pop-up) from being lost when the user clicks Run before Save.
      const noteDirty = standingNote.trim() !== loadedStandingNote.trim();
      if (setupFields.length || noteDirty) {
        await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup`, {
          jwt: session?.access_token,
          method: 'POST',
          body: { answers: { ...setupValues, __agent_note: standingNote.trim() }, source },
        });
        clearAgentNoteDraft(slug); // persisted — drop the cross-component draft
        if (dontShowAgain) markSetupCollapsed(slug);
      }
      setShowSetupModal(false);
      // Carry the per-run note into the run: the queue path sends it as the run-request
      // `note`; the watch path puts it (paths included) in the prefilled prompt of the
      // session you're about to supervise.
      if (preRunMode === 'watch' && !typedFields.length) await doWatch(perRunNote || undefined);
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
  /**
   * Ask the server whether these exact inputs already ran. ADVISORY — it returns
   * the fingerprint to stamp on the request either way, and any failure returns
   * nothing, because a backstop that can block Run is worse than no backstop.
   */
  async function precheckDuplicate(note: string | undefined, files: string[]) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/run-precheck`, {
        jwt: session?.access_token, method: 'POST',
        // Paths only for now — the desktop has no content-digest bridge yet, so the
        // server reports digestQuality:'weak' and phrases its warning accordingly
        // ("same file locations, contents not checked") rather than overclaiming.
        body: { source, note: note || '', files: files.map((path) => ({ path })) },
      });
      return { fingerprint: (r?.fingerprint as string) ?? null, duplicate: r?.duplicate ?? null };
    } catch { return { fingerprint: null, duplicate: null }; }
  }

  async function doQueue(note?: string, opts?: { force?: boolean; fingerprint?: string | null }) {
    if (state === 'queuing' || state === 'running') return;
    // Remember the note BEFORE the duplicate check can early-return, or "Run again
    // anyway" replays the run with the note dropped — silently different work.
    lastNote.current = note;
    // Check ONCE, before queuing. `force` is the user having already seen the
    // warning and said run anyway — never re-ask, or the confirm becomes a loop.
    // On a forced retry prefer the explicit value, then the remembered one — never
    // fall through to null just because this call skipped the precheck.
    let fingerprint = opts?.fingerprint ?? lastFingerprint.current ?? null;
    if (!opts?.force) {
      const pre = await precheckDuplicate(note, runFiles);
      fingerprint = pre.fingerprint;
      lastFingerprint.current = pre.fingerprint;
      if (pre.duplicate) {
        const d = pre.duplicate as { message: string; runId: string | null };
        setDupe({ message: d.message, runId: d.runId ?? null, fingerprint });
        return; // wait for the user; nothing is queued
      }
    }
    setState('queuing');
    setMsg('');
    setCapCard(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: {
          workflowSlug: slug, source: 'dashboard', kind: 'run',
          ...(note ? { note } : {}),
          // Stamp what these inputs hash to, so the NEXT identical ask is recognised.
          ...(fingerprint ? { inputFingerprint: fingerprint } : {}),
          // Carries the card's "Run anyway" through. We ask, we never forbid.
          ...(opts?.force ? { force: true } : {}),
          ...(typedFields.length && workflowVersionId && inputContractDigest ? {
            workflowVersionId,
            inputContractDigest,
            inputBindings: serializeArtifactBindings(inputBindings),
            inputSessionId,
          } : {}),
        },
      });
      // A 2xx transport response is not a queue receipt.  Do not clear inputs,
      // redirect, or render Queued unless the server confirms the one request it
      // created.  This also protects against a proxy accidentally normalising a
      // typed refusal into HTTP 200 with {ok:false}.
      const confirmedRequestId = confirmedRunRequestId(res);
      if (!confirmedRequestId) {
        throw new Error(res?.error || 'The server did not create a run request.');
      }
      requestId.current = confirmedRequestId;
      pollStart.current = Date.now();
      // The override belonged to the run that just went out. Keeping it would
      // make the NEXT Run open on a value the user chose for a different run and
      // never asked to keep — exactly the carried-over input a per-run contract
      // exists to prevent. The saved defaults stay; they are the standing answer.
      setInputOverrides({});
      inputSessionRef.current = null;
      setInputSessionId(null);
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
      // A capability refusal is NOT an error — it's a decision the user can make
      // right here (switch engine / grant it / run anyway), so it gets the card
      // rather than a red dead-end sentence.
      const cap = e instanceof BackendError && e.status === 409 ? e.body?.needsCapability : null;
      if (cap) {
        setState('idle');
        setMsg('');
        setCapCard(cap as CapabilityCardData);
        return;
      }
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
        // Same filter as the pop-up: this string becomes the prompt of the
        // session the user is about to watch, so a superseded answer here is a
        // stale value put in front of the agent by another route.
        const pairs = reusablePreferences(schema, inputContract)
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
      ) : revisePending ? (
        // A rewrite is in flight — block Run now so the OLD version can't fire
        // mid-edit. Auto-frees once the new version lands (poll above).
        <button
          type="button"
          disabled
          className="btn-success text-sm px-4 py-2 opacity-60 cursor-not-allowed"
          title="This agent is being rewritten with your edit — it'll be runnable once the new version lands."
        >
          ✎ Updating…
        </button>
      ) : state === 'done' ? (
        <Link href="/inbox" className="btn-success text-sm px-4 py-2">
          ✓ Done — view result
        </Link>
      ) : blocking > 0 ? (
        // Unanswered questions: the primary action IS answering them. The button
        // surfaces + flashes the question card rather than firing a dead run.
        <button
          type="button"
          onClick={surfaceQuestions}
          className="text-sm px-4 py-2 rounded-md border border-amber-500/60 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 font-medium"
        >
          Answer {blocking} question{blocking === 1 ? '' : 's'} to run ↑
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
      {isActive && !revisePending && blocking === 0 && (state === 'idle' || state === 'error') && (
        <button
          type="button"
          onClick={openWatch}
          className={`text-[11px] text-ink-400 hover:text-ink-200 underline-offset-2 hover:underline ${align === 'end' ? 'text-right' : 'text-left'}`}
        >
          Open in a session to watch ↗
        </button>
      )}
      <span className={`text-[11px] text-ink-500 max-w-[320px] ${align === 'end' ? 'text-right' : 'text-left'}`}>
        {revisePending
          ? 'Being rewritten with your edit — runnable once the new version lands (usually a minute or two).'
          : (msg || (isActive
            ? (requiresLocal ? 'Runs in Claude Code, on your computer.' : 'Runs in your Claude.')
            : 'Activate once, then run it anytime.'))}
      </span>
      {/* The pre-run capability ask. A MODAL, not inline: this is a rare, occasional
          gate (most agents never trip it), and an inline block shoved the whole card
          layout down every time it happened — the founder's own call after seeing it
          fire live (2026-07-14). Modal keeps the layout stable and reads as the
          one-off interruption it is. */}
      <Modal
        open={!!capCard}
        onClose={() => setCapCard(null)}
        title={capCard?.label ? `${capCard.label} needed` : 'One thing before this runs'}
      >
        {capCard && (
          <CapabilityCard
            card={capCard}
            // Carry the remembered fingerprint through the capability retry. Without
            // it, a run that hit a capability gate and was then forced through would
            // be stored unstamped and never recognised as a duplicate later.
            onRetry={(o) => doQueue(lastNote.current, { ...o, fingerprint: lastFingerprint.current })}
          />
        )}
      </Modal>
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

    {/* Duplicate-work confirm. Deliberately a QUESTION, never a block: repeating a
        run is often exactly what the user wants (a failed render, changed upstream
        data), and only they can tell. */}
    <Modal
      open={!!dupe}
      onClose={() => setDupe(null)}
      title="Run this again?"
      maxWidth="max-w-md"
    >
      <p className="text-sm text-ink-300 leading-relaxed">{dupe?.message}</p>
      <p className="text-sm text-ink-400 leading-relaxed mt-2">
        Running it again will redo that work — and spend whatever it costs again.
      </p>
      {dupe?.runId && (
        <Link href={`/runs/${dupe.runId}`} className="inline-block text-sm text-brand-500 hover:underline mt-2">
          See what that run produced →
        </Link>
      )}
      <div className="mt-4 flex items-center justify-end gap-3">
        <button type="button" onClick={() => setDupe(null)} className="btn-outline text-sm px-4 py-2">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            const fp = dupe?.fingerprint ?? null;
            setDupe(null);
            // force: the user has seen the warning. Carry the fingerprint through so
            // the repeat is still stamped and a THIRD identical run is caught too.
            void doQueue(lastNote.current, { force: true, fingerprint: fp });
          }}
          className="btn-success text-sm px-5 py-2"
        >
          Run again anyway
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
          ? <>Confirm or change {setupFields.length === 1 ? 'this preference' : 'these preferences'} — kept and reused on every run{typedFields.length ? ', separate from the inputs this run needs fresh' : ''} — and add anything for just this run below.</>
          : <>Add anything you want this run to do differently (optional).</>}
        {' '}{preRunMode === 'watch'
          ? 'It opens in Claude Code with your note included, so you can watch.'
          : 'It runs hands-off; the result lands in your inbox.'}
      </p>
      {setupFields.length > 0 && (
        <div className="rounded-md border border-ink-800 bg-ink-950/40 px-3 py-2.5 mb-4">
          {/* A COLLAPSE toggle, never a hide. The settings are always here so the
              user can see what the agent is about to use — running with stale
              inputs they could not see is how duplicate work happens. */}
          <button
            type="button"
            onClick={() => setSetupOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              Saved preferences
              {blankRequired.length > 0 && (
                <span className="ml-2 normal-case text-[11px] text-amber-700 dark:text-amber-300">
                  {blankRequired.length} needed
                </span>
              )}
            </span>
            <span className="text-xs text-ink-500">{setupOpen ? 'Hide' : 'Show'}</span>
          </button>
          {!setupOpen && (
            <p className="text-[11px] text-ink-500 mt-1 truncate">
              {setupFields.map((f) => `${f.question.replace(/\?$/, '')}: ${(setupValues[f.key] ?? '').toString().trim() || (f.default ? String(f.default) : '—')}`).join(' · ')}
            </p>
          )}
        </div>
      )}
      {setupFields.length > 0 && setupOpen && (
        <div className="space-y-4">
          {setupFields.map((f) => (
            <div key={f.key}>
              <label className="block text-sm text-ink-200 mb-1.5">
                {f.question}
                <span className={isOptionalField(f) ? 'ml-1.5 text-[11px] text-ink-500' : 'ml-1.5 text-[11px] text-amber-700 dark:text-amber-300'}>
                  {isOptionalField(f) ? 'optional' : 'required'}
                </span>
              </label>
              {f.kind === 'choice' && f.options && f.options.length > 0 ? (
                // THE SAME control the Setup card uses (2026-07-24). This dialog
                // used to render ONLY the canned options — so a saved "Other"
                // answer matched nothing, showed blank, and on Run got POSTed back
                // over the user's real answer. One shared field, so it can't drift.
                <SetupChoiceField
                  value={setupValues[f.key] ?? ''}
                  options={f.options}
                  onChange={(next) => setSetupValues((v) => ({ ...v, [f.key]: next }))}
                  ariaLabel={f.question}
                  selectClassName="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 focus:border-brand-500/60 focus:outline-none"
                  inputClassName="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none"
                />
              ) : (
                <input
                  type="text"
                  value={setupValues[f.key] ?? ''}
                  onChange={(e) => setSetupValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.kind === 'file' ? 'Paste a file path or link' : 'Type your answer'}
                  className={`w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none${f.kind === 'file' ? ' font-mono text-xs' : ''}`}
                />
              )}
              {/* An optional preference needs a visible way OUT, or a blank field
                  still reads as an unfinished form the user must clear. */}
              {isOptionalField(f) && (setupValues[f.key] ?? '').toString().trim() === '' && (
                <div className="flex items-center gap-3 mt-1.5">
                  {f.default ? (
                    <button
                      type="button"
                      onClick={() => setSetupValues((v) => ({ ...v, [f.key]: String(f.default) }))}
                      className="text-xs text-brand-500 hover:underline"
                    >
                      Use default ({f.default})
                    </button>
                  ) : (
                    <span className="text-[11px] text-ink-500">The agent will decide this itself.</span>
                  )}
                  <span className="text-[11px] text-ink-500">Skipping won’t block this run.</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {typedFields.length > 0 && (
        <div className="mt-4 rounded-md border border-ink-700 bg-ink-950/50 p-3 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">Run inputs</p>
            <p className="text-[11px] text-ink-500 mt-1">
              What this run works from. These start from what you saved in Setup; change one here and it applies to
              this run only. Files are bound to their named role, so upload order is irrelevant.
            </p>
          </div>
          {typedFields.map((field) => {
            const value = displayedInputValue(field.key, inputDefaults, inputOverrides);
            const origin = inputOrigin(field.key, inputDefaults, inputOverrides);
            const artifact = value && !Array.isArray(value) && typeof value === 'object' ? value : null;
            const artifacts = Array.isArray(value) ? value.filter((entry): entry is ArtifactBinding => typeof entry === 'object') : artifact ? [artifact] : [];
            const scalar = typeof value === 'string' ? value : '';
            const scalarMany = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
            const savedPath = savedInputValues[field.key];
            const verifying = verifyingInputs.includes(field.key);
            // A change made here, in the override layer. Blank IS the clear: it
            // takes the saved value out of this run without touching what is saved.
            const override = (next: string | string[]) => setInputOverrides((previous) => ({ ...previous, [field.key]: next }));
            const useSaved = () => {
              setInputError(field.key, null);
              setInputOverrides((previous) => {
                const next = { ...previous };
                delete next[field.key];
                return next;
              });
            };
            return (
              <div key={field.key} className="rounded-md border border-ink-800 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <label className="text-sm font-medium text-ink-100">{field.label}</label>
                    <span className={field.required ? 'ml-2 text-[11px] text-amber-300' : 'ml-2 text-[11px] text-ink-500'}>
                      {field.required ? 'required' : 'optional'}
                    </span>
                    {/* WHICH LAYER this value came from. Without it, "kept from
                        your setup" and "changed for this run" look identical, and
                        the user cannot tell what the next run will use. */}
                    {origin === 'saved' && (
                      <span className="ml-2 text-[11px] text-ink-400 border border-ink-700 rounded px-1.5 py-0.5">from your setup</span>
                    )}
                    {origin === 'override' && (
                      <span className="ml-2 text-[11px] text-brand-500 border border-brand-500/40 rounded px-1.5 py-0.5">this run only</span>
                    )}
                    {origin === 'cleared' && savedPath && (
                      <span className="ml-2 text-[11px] text-ink-400 border border-ink-700 rounded px-1.5 py-0.5">cleared for this run</span>
                    )}
                    <p className="text-xs text-ink-400 mt-1 leading-relaxed">{field.description}</p>
                  </div>
                  {field.kind === 'file' && <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void chooseTypedInput(field)}
                      disabled={!desktopBridge()?.pickRunInput}
                      className="btn-outline text-xs px-3 py-1.5 disabled:opacity-40"
                    >
                      {field.cardinality === 'many' ? 'Add file' : artifacts.length ? 'Replace file' : 'Choose file'}
                    </button>
                    {acceptsDirectorySnapshot(field) && <button
                      type="button"
                      onClick={() => void chooseTypedInput(field, 'directory')}
                      disabled={!desktopBridge()?.pickRunInput}
                      className="btn-outline text-xs px-3 py-1.5 disabled:opacity-40"
                    >
                      {field.cardinality === 'many' ? 'Add folder' : artifacts.length ? 'Replace with folder' : 'Choose folder'}
                    </button>}
                  </div>}
                </div>
                {field.kind === 'text' ? (
                  <input
                    value={field.cardinality === 'many' ? scalarMany.join(', ') : scalar}
                    onChange={(event) => override(field.cardinality === 'many'
                      ? event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean)
                      : event.target.value)}
                    className="mt-2 w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 focus:border-brand-500/60 focus:outline-none"
                  />
                ) : field.kind === 'choice' ? (
                  <select
                    value={field.cardinality === 'many' ? scalarMany : scalar}
                    multiple={field.cardinality === 'many'}
                    onChange={(event) => override(field.cardinality === 'many'
                      ? Array.from(event.target.selectedOptions, (option) => option.value).filter(Boolean)
                      : event.target.value)}
                    className="mt-2 w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 focus:border-brand-500/60 focus:outline-none"
                  >
                    <option value="">Select…</option>
                    {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : artifacts.length ? (
                  <div className="mt-2 space-y-1">
                    {artifacts.map((item) => <div key={item.artifactId} className="flex items-center justify-between gap-2 text-xs text-ink-300">
                      <span className="truncate min-w-0" title={item.displayName}>
                        <span className="text-emerald-400">✓</span> {item.displayName}
                        {' '}<span className="text-ink-500">
                          {/* WHERE IT CAME FROM. Without this, a folder the user
                              chose reads back as a .zip they never picked, and
                              there is nothing on screen to explain the rename. */}
                          — {item.origin === 'directory-snapshot' ? 'frozen from a folder' : 'file'}, verified, bound to {field.key}
                        </span>
                      </span>
                      <button type="button" onClick={() => {
                        setInputError(field.key, null);
                        // Removing a file is a decision about THIS run. The saved
                        // source is untouched and "Use saved file" brings it back.
                        if (field.cardinality === 'many') {
                          setInputOverrides((previous) => ({
                            ...previous,
                            [field.key]: artifacts.filter((candidate) => candidate.artifactId !== item.artifactId),
                          }));
                        } else override('');
                      }} className="text-ink-500 hover:text-rose-400 shrink-0">Remove</button>
                    </div>)}
                  </div>
                ) : verifying ? (
                  <p className="text-[11px] text-ink-400 mt-2">
                    Checking the file you saved{savedPath ? <> — <span className="font-mono">{fileName(savedPath)}</span></> : null}…
                  </p>
                ) : field.kind === 'file' && savedPath && !desktopBridge()?.bindSavedRunInput ? (
                  // A valid saved source must never read as missing just because
                  // a native file control is empty. Name it, and say what has to
                  // happen for the run to use it.
                  <p className="text-[11px] text-ink-400 mt-2">
                    Saved source: <span className="font-mono text-ink-300">{fileName(savedPath)}</span>
                    {' '}<span className="text-amber-300">— open this agent in the Implexa desktop app to use it for a run.</span>
                  </p>
                ) : field.kind === 'file' && !desktopBridge()?.pickRunInput ? (
                  <p className="text-[11px] text-amber-300 mt-2">Open this agent in the Implexa desktop app to choose a local file.</p>
                ) : null}
                {/* The way BACK, and the explicit way OUT. Without a route to the
                    saved value an override is a one-way door and a clear looks
                    like data loss; without a Clear, taking a saved value out of
                    one run means deleting it in Setup and typing it again. */}
                {savedPath && (
                  <div className="mt-2">
                    {origin === 'saved' ? (
                      <button
                        type="button"
                        onClick={() => { setInputError(field.key, null); override(''); }}
                        className="text-[11px] text-ink-500 hover:text-ink-300 hover:underline"
                      >
                        Clear for this run
                      </button>
                    ) : (
                      <button type="button" onClick={useSaved} className="text-[11px] text-brand-500 hover:underline">
                        Use saved {field.kind === 'file' ? 'file' : 'value'} ({savedInputLabel(field, savedPath)})
                      </button>
                    )}
                  </div>
                )}
                {inputErrors[field.key] && (
                  <p role="alert" className="text-[11px] text-rose-300 mt-2">{inputErrors[field.key]}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Standing note: the agent's "Notes for this agent" (honored on EVERY run).
          Shown here so it's visibly in effect and an edit made in Setup right before
          clicking Run isn't lost. Saving here writes the standing note — distinct
          from the one-off field below. */}
      <div className={setupFields.length ? 'mt-4' : ''}>
        <label className="block text-sm text-ink-200 mb-1">Notes for this agent <span className="text-ink-500 font-normal">(every run)</span></label>
        <p className="text-[11px] text-ink-500 mb-1.5">Standing instructions the agent follows on every run. Editing here updates them for good.</p>
        <textarea
          value={standingNote}
          onChange={(e) => setStandingNote(e.target.value)}
          rows={3}
          placeholder="e.g. keep the b-roll punchy; never use stock-looking footage; the judge verifies each shot"
          className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-y"
        />
      </div>

      {/* Per-run note: always available, rides into THIS run only (distinct from
          the standing note above). */}
      <div className="mt-4">
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
        {!typedFields.length && <AttachFiles files={runFiles} canAttach={canAttach} canAttachFolder={canAttachFolder}
          onAttach={attachFile} onAttachFolder={attachFolder} onRemove={removeFile} error={attachError} />}
      </div>

      {setupFields.length > 0 && (
        <label className="mt-3 flex items-center gap-2 text-xs text-ink-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="accent-brand-500 h-3.5 w-3.5"
          />
          Start with settings collapsed next time (they stay one click away)
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
          disabled={setupSaving || blankRequired.length > 0 || missingRequiredInputs(inputContract, inputBindings).length > 0}
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
