'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SuggestedAgent } from '@/lib/workflow-catalog';

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
 * Image attachments: in the desktop shell the box accepts pasted or picked
 * images. They can't ride the claude://code/new?q= deep link (text-only), so
 * the desktop main process writes each to ~/Implexa Agents/attachments and
 * appends its PATH to the prompt — Claude Code's Read tool opens images with
 * vision. The attach control only shows when the desktop bridge is present,
 * because the file-path trick needs the local agent runtime.
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

function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

export default function TalkToImplexa({ hasAgents = false, guided = false, suggestions = [] }: { hasAgents?: boolean; guided?: boolean; suggestions?: SuggestedAgent[] }) {
  const [intent, setIntent] = useState('');
  const [state, setState] = useState<State>('idle');
  const [msg, setMsg] = useState('');
  const [images, setImages] = useState<Attachment[]>([]);
  const [hasBridge, setHasBridge] = useState(false);
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

  const onPaste = (e: React.ClipboardEvent) => {
    if (!hasBridge) return;
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); void addFiles(files); }
  };

  const removeImage = (i: number) => setImages((prev) => prev.filter((_, idx) => idx !== i));

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
      const sentImages = images.map((im) => im.dataUrl);
      const imageCount = sentImages.length;
      setIntent('');
      setImages([]);
      const bridge = typeof window !== 'undefined' ? window.implexaDesktop : undefined;
      // Desktop shell: open the agent with the build PREFILLED for review (GUI
      // path, no terminal). For Claude this is a new-chat deep link; the user
      // reviews and sends, and Claude builds it via the Implexa connector. Any
      // attached images are materialized to disk by the desktop and referenced
      // by path in the prompt (see handoffAgent), so the agent can Read them.
      if (bridge?.handoffAgent) {
        setState('opening');
        const imageNote = imageCount > 0
          ? ` I attached ${imageCount} image${imageCount === 1 ? '' : 's'} as reference (paths are listed at the end of this prompt — Read them).`
          : '';
        const handoff = `Build my new Implexa agent. Use Implexa's get_pending_run_requests tool to find the request I just queued ("${t}"), then call generate_workflow to build the agent, then resolve_run_request to clear it. Then tell me what you built.${imageNote}`;
        const r = await bridge.handoffAgent(handoff, undefined, 'code', imageCount ? sentImages : undefined).catch(() => ({ ok: false }));
        setState('queued');
        setMsg(r?.ok
          ? `Opening your agent with the build ready${imageCount ? ` and ${imageCount} image${imageCount === 1 ? '' : 's'} attached` : ''}. Review it and hit send, then it appears under Your agents below.`
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
    <section>
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-50">
          {hasAgents ? 'Build an agent' : 'Build your first agent'}
        </h1>
        <p className="text-sm text-ink-400 mt-1.5 mb-5">
          {guided
            ? 'Just tell us a job you do over and over, in plain words. We build the agent and walk you through turning it on. No setup knowledge needed.'
            : 'Describe a recurring job in a sentence. Implexa builds the agent; it runs in your Claude or Codex, on a schedule, as you.'}
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
          {hasBridge && (
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

        {/* Attached image thumbnails (desktop only). Paths are written locally on
         * submit; here we just preview + let the user remove before sending. */}
        {images.length > 0 && (
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
        {hasBridge && images.length === 0 && (
          <p className="text-[11px] text-ink-500 mt-2">Tip: paste or attach an image (a screenshot, a design) and your agent can see it.</p>
        )}

        {/* Suggested for you — one-tap idea chips. An idea fills the box; an
            existing agent jumps to its page. Right where you'd start typing. */}
        {chips.length > 0 && (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-ink-500 mr-0.5">Suggested:</span>
            {chips.map((s, i) => (
              <button
                key={`${s.workflow_slug || s.skill_slug || s.title}-${i}`}
                type="button"
                onClick={() => pickSuggestion(s)}
                title={s.reason || s.title}
                className="text-xs rounded-full border border-ink-700 px-3 py-1 text-ink-300 hover:border-ink-500 hover:text-ink-100 transition-colors"
              >
                {s.workflow_slug && !s.suggested_intent ? '▶ ' : '+ '}{s.title}
              </button>
            ))}
          </div>
        )}

        {msg && (
          <p className={`text-xs mt-3 ${state === 'error' ? 'text-rose-400' : 'text-ink-300'}`}>{msg}</p>
        )}
      </div>
    </section>
  );
}
