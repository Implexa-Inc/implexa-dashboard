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
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

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
      <p className="text-sm text-ink-300 leading-relaxed mb-1">
        {queued
          ? 'Saved. Implexa will build this the moment you open the app — it runs inside your own Claude or Codex, on your machine.'
          : 'We’ve got your idea. It builds inside your own Claude or Codex, on your machine.'}
      </p>
      <p className="text-sm text-ink-400 mb-5">One thing left: get the Implexa app so it can build and run on your computer.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/install" className="btn-success text-sm px-4 py-2">Download Implexa</Link>
        <span className="text-xs text-ink-500">
          Already installed?{' '}
          <a
            href={`implexa://build?intent=${encodeURIComponent(intent.slice(0, 2000))}`}
            className="text-brand-400 hover:text-brand-300 underline underline-offset-2"
          >
            Open it
          </a>{' '}
          and your agent builds automatically.
        </span>
      </div>
    </section>
  );
}
