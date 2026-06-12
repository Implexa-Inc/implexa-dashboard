'use client';

/**
 * <GetStartedIntent /> — closes the website → first-agent loop.
 *
 * A visitor typed a job in the homepage hero box and signed up; the prompt rode
 * ?intent= into app-origin localStorage (surviving the auth round-trip). Here,
 * once the account exists, we turn it into a build run-request (so it's waiting
 * the moment they open Implexa) and show them their saved idea + the one thing
 * left: download the app. Renders nothing when there's no pending intent.
 *
 * The prompt is consumed exactly once: we read+clear localStorage synchronously
 * before the async POST, so a re-render can't double-submit.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import ConnectCommand from './connect-command';

const KEY = 'implexa_pending_intent';

export default function GetStartedIntent() {
  const params = useSearchParams();
  const supabase = createClient();
  const [intent, setIntent] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    // URL param (logged-in path) OR localStorage (fresh-signup path). Read+clear
    // before the async work so it can never fire twice.
    let pending: string | null = params.get('intent');
    try {
      if (!pending) pending = window.localStorage.getItem(KEY);
      window.localStorage.removeItem(KEY);
    } catch { /* private mode */ }
    pending = (pending || '').trim();
    if (!pending) return;
    setIntent(pending);

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await callBackend('/api/v2/me/run-requests', {
          jwt: session?.access_token,
          method: 'POST',
          body: { kind: 'build', intent: pending, source: 'website' },
        });
        setQueued(true);
      } catch { /* the prompt is still shown; the user can rebuild from Home */ }
    })();
  }, [params, supabase]);

  if (!intent) return null;

  return (
    <section className="card-glow mb-8">
      <div className="text-xs uppercase tracking-wider text-brand-500 mb-2 font-mono">Your agent is ready to build</div>
      <blockquote className="text-lg text-ink-50 font-medium leading-snug border-l-2 border-brand-500/50 pl-3 mb-3">
        “{intent}”
      </blockquote>
      <p className="text-sm text-ink-300 leading-relaxed mb-4">
        {queued
          ? 'Saved. One step left: connect Implexa to your own Claude or Codex. It runs there, as you, free on the plan you already pay for. The moment you connect, this agent builds itself.'
          : 'We’ve got your idea. Connect your own Claude or Codex below and it builds itself, runs as you, free.'}
      </p>

      <ConnectCommand />

      {/* The macOS app is not released yet, so it has not registered the
          implexa:// scheme on anyone's machine. A "Open it" deep link here
          resolves to a browser 404 for ~everyone. Re-add the implexa://build
          link (the desktop already routes it) only once the app ships. */}
      <p className="text-xs text-ink-500 mt-4">
        Prefer one click? A one-step macOS app is coming soon.
      </p>
    </section>
  );
}
