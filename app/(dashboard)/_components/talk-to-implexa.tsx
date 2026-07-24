'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SuggestedAgent } from '@/lib/workflow-catalog';
import { macDownloadUrl } from '@/lib/app-links';
import { AttachFiles, composeNoteWithFiles, useRunAttachments, ATTACH_BUILD_MARKER } from './run-attachments';
import CreateDecisionGate from './create-decision-gate';

/**
 * The conversation box: "you talk to Implexa". One codebase, two contexts.
 *
 * On submit it enqueues a build-request via the user's session (POST
 * /api/agents/build), which works in a plain browser AND inside the desktop
 * shell. Then, if the native desktop bridge is present (window.implexaDesktop),
 * it opens the user's Claude/Codex so the SessionStart hook builds the agent
 * right away. In a plain browser it tells the user to open their agent. The
 * model work always stays on the user's agent: presence, never runtime.
 *
 * File attachments: the box accepts ANY file (pdf/csv/json/docx/images/…) for
 * parity with run-setup and "Continue this run". In the desktop app it uses the
 * native picker bridge (window.implexaDesktop.pickFile) via the shared
 * <AttachFiles> component, which returns real absolute paths. Those paths are
 * baked into the build `intent` (a "📎 Attached for this build: …" line) so the
 * always-on drainer's generate_workflow sees them when it composes the agent —
 * the same way run-setup threads attachments into a run.
 *
 * Legacy image fallback: in an environment that exposes the older handoffAgent
 * bridge but not pickFile, the box keeps the original image paste/data-URL path
 * (images are written to disk by the desktop main process and their PATH is
 * appended to the interactive "shape it in Claude" prompt). The picker is the
 * primary, any-file path; this is only the fallback where pickFile is absent.
 */

declare global {
  interface Window {
    implexaDesktop?: {
      openAgent?: (surface?: string) => Promise<{ ok: boolean; surface?: string }>;
      handoffAgent?: (
        prompt: string,
        surface?: string,
        target?: string,
        images?: string[],
      ) => Promise<{ ok: boolean; surface?: string; mode?: string; attachments?: number }>;
    };
  }
}

type State = 'idle' | 'sending' | 'queued' | 'opening' | 'error';
type Attachment = { dataUrl: string; name: string };

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // mirror the desktop cap
const CLAUDE_CODE_MAX = 13000; // claude://code/new?q= prompt cap

function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

export default function TalkToImplexa({ hasAgents = false, guided = false, suggestions = [], connected = false }: { hasAgents?: boolean; guided?: boolean; suggestions?: SuggestedAgent[]; connected?: boolean }) {
  const [intent, setIntent] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [msg, setMsg] = useState('');
  const [images, setImages] = useState<Attachment[]>([]);
  const [hasBridge, setHasBridge] = useState(false);
  // Any-file attach via the native picker (desktop). Shared with run-setup and the
  // Continue box. `canAttach` is true only when the pickFile bridge exists; when it
  // does, this is the attach UI (any file type) and the legacy image picker is hidden.
  const { files: runFiles, canAttach, attachFile, removeFile, reset: resetFiles } = useRunAttachments();
  // The just-queued build, kept so the secondary "shape it in Claude" opt-in can
  // hand it off interactively after the hands-off queue has cleared the input.
  const [queuedIntent, setQueuedIntent] = useState('');
  const [queuedImages, setQueuedImages] = useState<string[]>([]);
  // The composed intent whose plan the user is reviewing. Non-null → the plan
  // modal is open; the build is enqueued only when they accept it.
  const [planIntent, setPlanIntent] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Pick a suggestion: an idea (suggested_intent) fills the box so the user can
  // tweak then Build; an existing catalog agent (workflow_slug) jumps to it.
  function pickSuggestion(s: SuggestedAgent) {
    if (s.suggested_intent) {
      setIntent(s.suggested_intent);
      const el = document.getElementById('talk');
      if (el) { (el as HTMLInputElement).focus(); }
    } else if (s.workflow_slug) {
      router.push(`/workflows/${s.workflow_slug}`);
    }
  }
  const chips = suggestions.filter((s) => s.suggested_intent || s.workflow_slug).slice(0, 6);

  // The desktop bridge is only knowable client-side. Gate the attach UI on it.
  useEffect(() => {
    setHasBridge(typeof window !== 'undefined' && !!window.implexaDesktop?.handoffAgent);
  }, []);

  // The first-win moment (and other nudges) can prefill + focus this box so the
  // user re-enters the build loop with zero typing.
  useEffect(() => {
    function onPrefill(e: Event) {
      const text = (e as CustomEvent).detail;
      if (typeof text === 'string' && text.trim()) setIntent(text.trim());
      const el = document.getElementById('talk');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); (el as HTMLInputElement).focus(); }
    }
    window.addEventListener('implexa-prefill-build', onPrefill);
    return () => window.removeEventListener('implexa-prefill-build', onPrefill);
  }, []);

  const addFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/') && f.size <= MAX_IMAGE_BYTES);
    if (!imgs.length) return;
    const read = await Promise.all(imgs.map(async (f) => {
      const dataUrl = await readAsDataUrl(f);
      return dataUrl ? { dataUrl, name: f.name || 'pasted-image' } : null;
    }));
    setImages((prev) => [...prev, ...read.filter(Boolean) as Attachment[]].slice(0, MAX_IMAGES));
  };

  // Image paste is the legacy data-URL path — only when pickFile is absent (any-file
  // mode uses the native picker, which can't accept a pasted in-memory blob as a path).
  const onPaste = (e: React.ClipboardEvent) => {
    if (!hasBridge || canAttach) return;
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); void addFiles(files); }
  };

  const removeImage = (i: number) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  // Step 1 of Create: open the plan review. Nothing is enqueued yet — the user
  // sees the tools and confirms (or changes them) before any build is created.
  const submit = () => {
    const t = intent.trim();
    if (!t || state === 'sending' || state === 'opening') return;
    setMsg('');
    // Bake any attached file PATHS into the build intent (same plumbing run-setup
    // uses for a run): the drainer's generate_workflow reads them back from the
    // request's `intent` when it composes the agent. No-op when nothing's attached.
    const buildIntent = composeNoteWithFiles(t, runFiles, ATTACH_BUILD_MARKER);
    setPlanIntent(buildIntent);
  };

  // Step 2: the plan modal already enqueued the build (with the confirmed
  // toolPreferences). Run the post-queue UI transitions the direct POST used to.
  const onPlanCreated = (info?: { disclosures?: { text: string }[] }) => {
    const buildIntent = planIntent || '';
    // A `disclose` build carries a compact confirmation ("Using your signed-in
    // Gmail. Change in Setup.") — fold it into the queued message rather than a
    // separate toast, so it survives this component unmounting.
    const discloseNote = (info?.disclosures || []).map((d) => d.text).join(' ');
    const sentImages = images.map((im) => im.dataUrl);
    setPlanIntent(null);
    setIntent('');
    setImages([]);
    resetFiles();
    const bridge = typeof window !== 'undefined' ? window.implexaDesktop : undefined;
    // Not connected to any Claude/Codex yet → the agent is SAVED but nothing
    // can build it. Don't show a false "queued, open your Claude" (the founder
    // hit exactly this dead-end). Warn instead and point to the app.
    if (!connected && !bridge?.handoffAgent) {
      setState('queued');
      setMsg('');
      setShowConnect(true);
      return;
    }
    // HANDS-OFF (primary): the build is queued on the run-request bus and the
    // always-on drainer composes it via generate_workflow on the user's own
    // Claude/Codex. Remember the intent so the secondary "shape it in Claude"
    // opt-in can still hand it off interactively for power users.
    setQueuedIntent(buildIntent);
    setQueuedImages(sentImages);
    setState('queued');
    setMsg(`Queued.${discloseNote ? ` ${discloseNote}` : ''} Your agent will appear under Your agents when the runner builds it (usually a few minutes).`);
  };

  // Secondary opt-in: open the user's Claude with the queued build prefilled so a
  // power user can shape it interactively. Desktop uses the native bridge (and can
  // carry image attachments by path); a plain browser falls back to a claude://
  // deep link. Never auto-sends; the user reviews and hits send.
  const shapeInClaude = async () => {
    const t = queuedIntent;
    if (!t) return;
    setState('opening');
    const imageCount = queuedImages.length;
    const imageNote = imageCount > 0
      ? ` I attached ${imageCount} image${imageCount === 1 ? '' : 's'} as reference (paths are listed at the end of this prompt — Read them).`
      : '';
    const handoff = `Build my new Implexa agent. Use Implexa's get_pending_run_requests tool to find the request I just queued ("${t}"), then call generate_workflow to build the agent, then resolve_run_request to clear it. Then tell me what you built.${imageNote}`;
    const bridge = typeof window !== 'undefined' ? window.implexaDesktop : undefined;
    if (bridge?.handoffAgent) {
      const r = await bridge.handoffAgent(handoff, undefined, 'code', imageCount ? queuedImages : undefined).catch(() => ({ ok: false }));
      setState('queued');
      setMsg(r?.ok
        ? `Opening your Claude with the build ready${imageCount ? ` and ${imageCount} image${imageCount === 1 ? '' : 's'} attached` : ''}. Review it and hit send.`
        : 'Open your Claude or Codex and Implexa will build it.');
    } else {
      setState('queued');
      setMsg('Opening Claude with the build prefilled. Review it and hit send.');
      window.location.href = `claude://code/new?q=${encodeURIComponent(handoff.slice(0, CLAUDE_CODE_MAX))}`;
    }
  };

  const busy = state === 'sending' || state === 'opening';
  const label = state === 'sending' ? 'Queuing' : state === 'opening' ? 'Opening' : 'Build it';

  return (
    <section>
      {planIntent && (
        <CreateDecisionGate
          intent={planIntent}
          onCancel={() => setPlanIntent(null)}
          onCreated={onPlanCreated}
        />
      )}
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-50">
          {hasAgents ? 'Build an agent' : 'Build your first agent'}
        </h1>
        <p className="text-sm text-ink-400 mt-1.5 mb-2">
          {guided
            ? 'Just tell us a job you do over and over, in plain words. We build the agent and walk you through turning it on. No setup knowledge needed.'
            : 'Describe a recurring job in a sentence. Implexa builds the agent; it runs in your Claude or Codex, on a schedule, as you.'}
        </p>
        <p className="text-xs text-ink-500 mb-5">
          Claude Code runs in the background, so you don&apos;t work there. Build, run, and approve every agent right here in Implexa.
        </p>
        <div className="flex gap-2.5">
          <input
            id="talk"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            onPaste={onPaste}
            placeholder="e.g. every morning, send me my key numbers"
            disabled={busy}
            className="flex-1 rounded-lg bg-ink-900 border border-ink-700 px-4 py-3 text-[15px] text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-ink-500 disabled:opacity-60"
          />
          {/* Legacy inline image picker — only when pickFile is absent (no any-file
              bridge). When pickFile exists, the shared <AttachFiles> below handles
              any file type and this is hidden. */}
          {hasBridge && !canAttach && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => { void addFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy || images.length >= MAX_IMAGES}
                title="Attach an image (or paste one into the box)"
                aria-label="Attach an image"
                className="rounded-lg border border-ink-700 text-ink-300 px-3 py-3 text-sm hover:border-ink-500 hover:text-ink-100 transition-colors disabled:opacity-40"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-5-5L5 21M3 16V5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
                </svg>
              </button>
            </>
          )}
          <button
            onClick={submit}
            disabled={busy || !intent.trim()}
            className="rounded-lg bg-brand-500 text-ink-950 px-6 py-3 text-sm font-medium hover:bg-brand-400 whitespace-nowrap transition-colors disabled:opacity-50"
          >
            {label}
          </button>
        </div>

        {/* Any-file attach (desktop, via the native picker) — shared with run-setup
            and the Continue box. Paths are baked into the build intent on submit. */}
        {canAttach && (
          <AttachFiles
            files={runFiles}
            canAttach={canAttach}
            onAttach={attachFile}
            onRemove={removeFile}
            hint="Attach a file — a screenshot, a doc, a spec — and your agent can use it."
          />
        )}

        {/* Attached image thumbnails — legacy image-only path (pickFile absent). Paths
         * are written locally on submit; here we just preview + let the user remove. */}
        {!canAttach && images.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {images.map((im, i) => (
              <div key={i} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={im.dataUrl}
                  alt={im.name}
                  className="h-14 w-14 object-cover rounded-md border border-ink-700"
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  aria-label={`Remove ${im.name}`}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink-950 border border-ink-600 text-ink-300 text-xs flex items-center justify-center hover:text-rose-400 hover:border-rose-400"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {hasBridge && !canAttach && images.length === 0 && (
          <p className="text-[11px] text-ink-500 mt-2">Tip: paste or attach a file — a screenshot, a doc, a spec — and your agent can use it.</p>
        )}

        {/* Suggested for you — one-tap idea chips. An idea fills the box; an
            existing agent jumps to its page. Right where you'd start typing. */}
        {chips.length > 0 && (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-ink-500 mr-0.5">Suggested:</span>
            {chips.map((s, i) => {
              // What it actually does — the run-driven idea carries the full build
              // prompt (suggested_intent); a popular workflow just gets added. Show
              // this on hover/focus so the chip isn't a "wild guess what's it for".
              const what = s.suggested_intent
                || (s.workflow_slug ? `Adds the "${s.title}" agent to your account in one tap.` : '');
              return (
                <span
                  key={`${s.workflow_slug || s.skill_slug || s.title}-${i}`}
                  className="group relative inline-block"
                >
                  <button
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className="text-xs rounded-full border border-ink-700 px-3 py-1 text-ink-300 hover:border-ink-500 hover:text-ink-100 transition-colors"
                  >
                    {s.workflow_slug && !s.suggested_intent ? '▶ ' : '+ '}{s.title}
                  </button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 hidden w-72 max-w-[80vw] rounded-lg border border-ink-700 bg-ink-950 p-3 text-left shadow-xl group-hover:block group-focus-within:block"
                  >
                    <span className="block text-xs font-medium text-ink-100">{s.title}</span>
                    {s.reason && (
                      <span className="mt-1 block text-[11px] italic text-ink-400">{s.reason}</span>
                    )}
                    {what && (
                      <span className="mt-1.5 block text-[11px] leading-relaxed text-ink-300">{what}</span>
                    )}
                    <span className="mt-2 block text-[10px] text-ink-500">
                      {s.suggested_intent ? 'Tap to drop this into the box →' : 'Tap to add this agent →'}
                    </span>
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {msg && (
          <p className={`text-xs mt-3 ${state === 'error' ? 'text-rose-400' : 'text-ink-300'}`}>{msg}</p>
        )}

        {/* Secondary opt-in for power users: shape the queued build interactively
            in Claude. The hands-off queue above is the primary path. */}
        {state === 'queued' && queuedIntent && (
          <button
            type="button"
            onClick={shapeInClaude}
            className="text-[11px] text-ink-400 hover:text-ink-200 underline-offset-2 hover:underline mt-1.5"
          >
            …or shape it in Claude ↗
          </button>
        )}
      </div>

      {/* Not-connected warning. Clicking Build with no Claude/Codex linked used
          to silently "queue" with nothing to build it (the dead-end the founder
          hit). The agent IS saved server-side; this explains the one step left. */}
      {showConnect && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowConnect(false)}
        >
          <div className="card max-w-md w-full p-6 relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setShowConnect(false)}
              aria-label="Close"
              className="absolute top-3 right-3 text-ink-500 hover:text-ink-200 text-lg leading-none"
            >
              ×
            </button>
            <h2 className="text-lg font-semibold text-ink-50 mb-2">Your agent is saved. One step to build it.</h2>
            <p className="text-sm text-ink-300 leading-relaxed mb-4">
              We recommend installing the Implexa desktop app, the control plane for your agents. It installs the Implexa plugin into your own Claude or Codex, then helps you build and run your agents there, as you, free. Your agent stays queued until you connect.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a href={macDownloadUrl()} className="btn-success text-sm px-5 py-2.5 inline-flex items-center gap-2">
                ↓ Download the Implexa app
              </a>
              <a href="/install" className="text-xs text-ink-400 hover:text-ink-200">
                Prefer the terminal? Connect with one command →
              </a>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
