'use client';

/**
 * <GetStartedIntent /> — the VISIBLE half of the website → first-agent loop.
 *
 * A visitor typed a job in the hero box and signed up; the prompt rode ?intent=
 * into app-origin localStorage. The build run-request is now persisted by
 * <PersistIntent /> (mounted in the dashboard layout, so it fires on /install
 * and every authed page, not only here).
 *
 * Two cases, by connection state:
 *   - NOT connected → show the saved idea + the one step left (connect). The
 *     connect card is the right next action.
 *   - ALREADY connected → the connect card is useless ("it's already
 *     connected"). Instead, drop the idea straight into the build box
 *     (TalkToImplexa, via the implexa-prefill-build event) and render nothing.
 * Renders nothing when there's no pending intent. Dismiss clears the saved idea.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { macDownloadUrl } from '@/lib/app-links';

const KEY = 'implexa_pending_intent';
const POSTED = 'implexa_intent_posted';

export default function GetStartedIntent({ connected = false }: { connected?: boolean }) {
  const params = useSearchParams();
  const [intent, setIntent] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    let pending = (params.get('intent') || '').trim();
    try {
      if (!pending) pending = (window.localStorage.getItem(KEY) || '').trim();
      if (pending) setQueued((window.localStorage.getItem(POSTED) || '') === pending);
    } catch { /* private mode */ }
    if (!pending) return;

    // Already connected: skip the connect card entirely and prefill the build
    // box. Fire once now and once after a tick, in case TalkToImplexa attaches
    // its listener on the same render pass as this one.
    if (connected) {
      const fire = () => {
        try { window.dispatchEvent(new CustomEvent('implexa-prefill-build', { detail: pending })); } catch { /* ignore */ }
      };
      fire();
      const t = setTimeout(fire, 150);
      return () => clearTimeout(t);
    }

    setIntent(pending);
  }, [params, connected]);

  function dismiss() {
    try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
    setIntent(null);
  }

  if (!intent) return null;

  return (
    <section className="card-glow mb-8 relative">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 text-ink-500 hover:text-ink-200 text-lg leading-none"
      >
        ×
      </button>
      <div className="text-xs uppercase tracking-wider text-brand-500 mb-2 font-mono">Your agent is ready to build</div>
      <blockquote className="text-lg text-ink-50 font-medium leading-snug border-l-2 border-brand-500/50 pl-3 mb-3">
        “{intent}”
      </blockquote>
      <p className="text-sm text-ink-300 leading-relaxed mb-4">
        {queued
          ? 'Saved. One step left: get the Implexa app. It connects your own Claude or Codex, then this agent builds itself and runs there, as you, free on the plan you already pay for.'
          : 'We’ve got your idea. Get the Implexa app and it builds itself, runs as you on your own Claude or Codex, free.'}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <a href={macDownloadUrl()} className="btn-success text-sm px-5 py-2.5 inline-flex items-center gap-2">
          ↓ Download the Implexa app
        </a>
        <a href="/install" className="text-xs text-ink-400 hover:text-ink-200">
          Prefer the terminal? Connect with one command →
        </a>
      </div>
    </section>
  );
}
