'use client';

/**
 * <RunChainSuggestions /> — "this agent chains with…" surfaced on a run page.
 *
 * The standalone "Chain your agents" board (chain-suggestions.tsx) shows ALL the
 * user's chain ideas. Here we want the focused version: right after reading a
 * run's output, tell the user the agent they just watched run feeds naturally
 * into one of their OTHER agents — "your weekly SEO agent's output feeds your
 * blog-publisher" — so a one-off result becomes a pipeline.
 *
 * Reuses the same backend (GET /me/chain-suggestions to discover, POST /me/chains
 * to compose) and filters to suggestions that involve THIS run's agent on either
 * side. Renders nothing when this agent isn't part of any suggested chain.
 */

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Suggestion = {
  fromSlug: string; fromSource: string; fromName: string;
  toSlug: string; toSource: string; toName: string;
  rationale: string;
  existingSlug: string | null;
};

export default function RunChainSuggestions({ slug }: { slug: string }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await callBackend('/api/v2/me/chain-suggestions', { jwt: session.access_token });
        if (!cancelled && res?.ok && Array.isArray(res.suggestions)) {
          // Only the chains this run's agent takes part in — that's what makes the
          // suggestion feel "about what you just ran" rather than a generic board.
          setSuggestions(res.suggestions.filter((s: Suggestion) => s.fromSlug === slug || s.toSlug === slug));
        }
      } catch { /* fail-quiet */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

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
      if (res?.ok && res.workflow?.slug) setCreated((m) => ({ ...m, [key]: res.workflow.slug }));
      else setErr('Could not create that chain. Try again.');
    } catch {
      setErr('Could not create that chain. Try again.');
    } finally {
      setBusy(null);
    }
  }

  if (!suggestions.length) return null;

  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider mb-1">Chain this agent</h2>
      <p className="text-xs text-ink-500 mb-3">This agent&apos;s output feeds naturally into one of your others. One tap builds the pipeline.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {suggestions.map((s) => {
          const key = `${s.fromSlug}>${s.toSlug}`;
          const existing = created[key] || s.existingSlug;
          // Frame it from the run's perspective: is this agent the source or the sink?
          const lead = s.fromSlug === slug
            ? <><span className="font-medium">This agent</span><span className="text-brand-500 mx-1" aria-hidden>→</span><span className="font-medium">{s.toName}</span></>
            : <><span className="font-medium">{s.fromName}</span><span className="text-brand-500 mx-1" aria-hidden>→</span><span className="font-medium">This agent</span></>;
          return (
            <div key={key} className="card p-4 flex flex-col">
              <div className="text-sm text-ink-100 flex items-center flex-wrap">{lead}</div>
              {s.rationale && <p className="text-xs text-ink-400 mt-1.5 leading-relaxed flex-1">{s.rationale}</p>}
              <div className="mt-3">
                {existing ? (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Saved</span>
                    <a href={`/workflows/${existing}`} className="text-xs font-medium text-brand-500 hover:underline">
                      Open it — run or schedule →
                    </a>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => createChain(s)}
                    disabled={!!busy}
                    className="btn-success text-xs px-3 py-1.5 disabled:opacity-60"
                  >
                    {busy === key ? 'Building…' : 'Create chain'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}
    </section>
  );
}
