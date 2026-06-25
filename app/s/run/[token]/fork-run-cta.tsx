'use client';

/**
 * <ForkRunCta /> — the public Run Card's "fork & run" CTA, session-aware.
 *
 *   - LOGGED IN  → one tap forks the agent into the user's own library (POST
 *     /api/v2/me/fork-agent, autoRun) — a new generated copy they own, Tier-2 perms
 *     default-granted, activated on-demand, and a run enqueued (the always-on
 *     drainer executes it on their own Claude). Then lands them on their new agent.
 *   - LOGGED OUT → /signup carrying the agent, so post-auth they land on that agent
 *     page (signup routes intent=adopt&agent=<slug> → next=/workflows/<slug>).
 *
 * While the session check is in flight we show the signup path (safe default for a
 * cold share viewer); it flips to the in-app fork button once resolved.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export default function ForkRunCta({ skillSlug }: { skillSlug: string }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session)).catch(() => setAuthed(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fork() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/fork-agent', {
        jwt: session?.access_token,
        method: 'POST',
        body: { slug: skillSlug, autoRun: true },
      });
      if (res?.ok && res.forkedSlug) {
        // It's now in Your Agents and a run is queued (the drainer runs it on your
        // own Claude). Land on the new agent so the user watches it run.
        router.push(`/workflows/${encodeURIComponent(res.forkedSlug)}`);
        return;
      }
      setMsg(res?.error || 'Could not fork this agent. Try again.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not fork this agent.');
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <Link
        href={`/signup?intent=adopt&agent=${encodeURIComponent(skillSlug)}`}
        className="btn-success inline-block mt-3 px-5 py-2 text-sm"
      >
        Run this agent in your subscription →
      </Link>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={fork}
        disabled={busy}
        className="btn-success inline-block px-5 py-2 text-sm disabled:opacity-60"
      >
        {busy ? 'Forking…' : 'Fork & run on your Claude →'}
      </button>
      {msg ? <p className="mt-2 text-xs text-amber-300">{msg}</p> : null}
    </div>
  );
}
