'use client';

/**
 * <ChainSuggestions /> — "chain your agents" on the Agents page.
 *
 * Fetches GET /me/chain-suggestions (Haiku-proposed A→B chains among the user's
 * own agents). Each card is one tap: POST /me/chains composes the two agents into
 * a new chained agent (nested-workflow primitive) and routes to it. Renders
 * nothing when there's nothing worth chaining, so it never adds noise.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Suggestion = {
  fromSlug: string; fromSource: string; fromName: string;
  toSlug: string; toSource: string; toName: string;
  rationale: string;
};

export default function ChainSuggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await callBackend('/api/v2/me/chain-suggestions', { jwt: session.access_token });
        if (!cancelled && res?.ok && Array.isArray(res.suggestions)) setSuggestions(res.suggestions);
      } catch { /* fail-quiet: the section just doesn't show */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createChain(s: Suggestion) {
    const key = `${s.fromSlug}>${s.toSlug}`;
    if (busy) return;
    setBusy(key);
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/chains', {
        jwt: session?.access_token,
        method: 'POST',
        body: {
          agents: [
            { source: s.fromSource, slug: s.fromSlug, name: s.fromName },
            { source: s.toSource, slug: s.toSlug, name: s.toName },
          ],
          name: `${s.fromName} → ${s.toName}`,
        },
      });
      if (res?.ok && res.workflow?.slug) {
        router.push(`/workflows/${res.workflow.slug}`);
      } else {
        setErr('Could not create that chain. Try again.');
        setBusy(null);
      }
    } catch {
      setErr('Could not create that chain. Try again.');
      setBusy(null);
    }
  }

  if (!suggestions.length) return null;

  return (
    <section className="mb-7">
      <h2 className="text-xs font-medium text-ink-400 uppercase tracking-wider mb-1">Chain your agents</h2>
      <p className="text-xs text-ink-500 mb-3">
        One agent&apos;s output feeds the next. One tap builds the pipeline.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        {suggestions.map((s) => {
          const key = `${s.fromSlug}>${s.toSlug}`;
          return (
            <div key={key} className="card p-4 flex flex-col">
              <div className="flex items-center gap-2 text-sm text-ink-100 flex-wrap">
                <span className="font-medium">{s.fromName}</span>
                <span className="text-brand-500" aria-hidden="true">→</span>
                <span className="font-medium">{s.toName}</span>
              </div>
              {s.rationale && <p className="text-xs text-ink-400 mt-1.5 leading-relaxed flex-1">{s.rationale}</p>}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => createChain(s)}
                  disabled={!!busy}
                  className="btn-success text-xs px-3 py-1.5 disabled:opacity-60"
                >
                  {busy === key ? 'Building…' : 'Create chain'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}
    </section>
  );
}
