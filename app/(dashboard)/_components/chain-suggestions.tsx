'use client';

/**
 * <ChainSuggestions /> — "chain your agents" on the Agents page. Two parts:
 *
 *  - Recommended chains: Haiku-proposed A→B chains among the user's own agents
 *    (GET /me/chain-suggestions). One tap (POST /me/chains) composes them into a
 *    new chained agent. When a chain already exists (server sets existingSlug, or
 *    we just created it this session), the card flips to "Open it →" instead of
 *    re-offering "Create chain".
 *  - Create custom chain: a vertical builder — pick an agent, its output feeds
 *    into the next, add as many hops as you want, then build.
 *
 * Renders nothing only when there's neither a suggestion nor enough agents to
 * build a custom chain.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import Modal from './modal';

type AgentRef = { slug: string; source: string; name: string };

type Suggestion = {
  fromSlug: string; fromSource: string; fromName: string;
  toSlug: string; toSource: string; toName: string;
  rationale: string;
  existingSlug: string | null;
};

export default function ChainSuggestions({ agents = [] }: { agents?: AgentRef[] }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<Record<string, string>>({}); // suggestion key -> new slug
  const [err, setErr] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { if (!cancelled) setLoading(false); return; }
        const res = await callBackend('/api/v2/me/chain-suggestions', { jwt: session.access_token });
        if (!cancelled && res?.ok && Array.isArray(res.suggestions)) setSuggestions(res.suggestions);
      } catch { /* fail-quiet */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function postChain(orderedAgents: AgentRef[], name: string, busyKey: string): Promise<string | null> {
    if (busy) return null;
    setBusy(busyKey);
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/chains', {
        jwt: session?.access_token,
        method: 'POST',
        body: { agents: orderedAgents.map((a) => ({ source: a.source, slug: a.slug, name: a.name })), name },
      });
      setBusy(null);
      if (res?.ok && res.workflow?.slug) return res.workflow.slug;
      setErr('Could not create that chain. Try again.');
      return null;
    } catch {
      setBusy(null);
      setErr('Could not create that chain. Try again.');
      return null;
    }
  }

  async function createRecommended(s: Suggestion) {
    const key = `${s.fromSlug}>${s.toSlug}`;
    const slug = await postChain(
      [{ slug: s.fromSlug, source: s.fromSource, name: s.fromName }, { slug: s.toSlug, source: s.toSource, name: s.toName }],
      `${s.fromName} → ${s.toName}`,
      key,
    );
    if (slug) setCreated((m) => ({ ...m, [key]: slug })); // flip card in place
  }

  const canCustom = agents.length >= 2;
  if (!loading && !suggestions.length && !canCustom) return null;

  return (
    <section className="mb-7">
      <h2 className="text-xs font-medium text-ink-400 uppercase tracking-wider mb-1">Chain your agents</h2>
      <p className="text-xs text-ink-500 mb-3">One agent&apos;s output feeds the next. One tap builds the pipeline.</p>

      {loading && !suggestions.length && (
        <div className="flex items-center gap-2 text-xs text-ink-500 mb-4" aria-live="polite">
          <span className="inline-block w-3.5 h-3.5 border-2 border-ink-600 border-t-brand-500 rounded-full animate-spin" aria-hidden="true" />
          Looking for chains you can build…
        </div>
      )}

      {suggestions.length > 0 && (
        <>
          <h3 className="text-[11px] font-medium text-ink-500 mb-2">Recommended chains</h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            {suggestions.map((s) => {
              const key = `${s.fromSlug}>${s.toSlug}`;
              const existing = created[key] || s.existingSlug;
              return (
                <div key={key} className="card p-4 flex flex-col">
                  <div className="flex items-center gap-2 text-sm text-ink-100 flex-wrap">
                    <span className="font-medium">{s.fromName}</span>
                    <span className="text-brand-500" aria-hidden="true">→</span>
                    <span className="font-medium">{s.toName}</span>
                  </div>
                  {s.rationale && <p className="text-xs text-ink-400 mt-1.5 leading-relaxed flex-1">{s.rationale}</p>}
                  <div className="mt-3">
                    {existing ? (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-success-600 dark:text-success-400">✓ Created</span>
                        <a href={`/workflows/${existing}`} className="text-xs font-medium text-brand-500 hover:underline">
                          Open it — run or schedule →
                        </a>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => createRecommended(s)}
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
        </>
      )}

      {canCustom && (
        <button
          type="button"
          onClick={() => setShowCustom(true)}
          className="btn-outline text-xs px-3 py-1.5"
        >
          + Create custom chain
        </button>
      )}

      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}

      <Modal
        open={showCustom}
        onClose={() => setShowCustom(false)}
        title="Create custom chain"
        subtitle="Pick an agent, its output feeds the next, add as many hops as you want."
        maxWidth="max-w-xl"
      >
        <CustomChainBuilder
          agents={agents}
          build={postChain}
          busy={busy}
          onCancel={() => setShowCustom(false)}
          onCreated={(slug) => { setShowCustom(false); router.push(`/workflows/${slug}`); }}
        />
      </Modal>
    </section>
  );
}

/** The vertical "Create custom chain" builder — rendered inside the modal. */
function CustomChainBuilder({
  agents, onCreated, onCancel, build, busy,
}: {
  agents: AgentRef[];
  onCreated: (slug: string) => void;
  onCancel: () => void;
  build: (ordered: AgentRef[], name: string, busyKey: string) => Promise<string | null>;
  busy: string | null;
}) {
  const [slots, setSlots] = useState<string[]>(['', '']); // selected slugs, in order

  const bySlug = new Map(agents.map((a) => [a.slug, a]));
  const chosen = slots.map((sl) => bySlug.get(sl)).filter(Boolean) as AgentRef[];
  const distinct = new Set(chosen.map((a) => a.slug));
  const valid = chosen.length >= 2 && distinct.size === chosen.length;

  function setSlot(i: number, slug: string) {
    setSlots((s) => s.map((v, idx) => (idx === i ? slug : v)));
  }
  function addSlot() { setSlots((s) => [...s, '']); }
  function removeSlot(i: number) { setSlots((s) => (s.length > 2 ? s.filter((_, idx) => idx !== i) : s)); }

  async function create() {
    if (!valid) return;
    const ordered = slots.map((sl) => bySlug.get(sl)).filter(Boolean) as AgentRef[];
    const name = ordered.map((a) => a.name).join(' → ');
    const slug = await build(ordered, name, '__custom__');
    if (slug) onCreated(slug);
  }

  return (
    <div>
      <div className="space-y-1">
        {slots.map((sl, i) => (
          <div key={i}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-ink-600 w-4 tabular-nums">{i + 1}</span>
              <select
                value={sl}
                onChange={(e) => setSlot(i, e.target.value)}
                // min-w-0 lets the select shrink inside the flex row — without it a
                // long agent/chain name gives the <select> an intrinsic min-width
                // that overflows the modal (the default flex min-width:auto). The
                // browser then truncates the long option to the box width.
                className="flex-1 min-w-0 truncate rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-ink-500"
              >
                <option value="">{i === 0 ? 'Select an agent…' : 'Chain to an agent…'}</option>
                {agents.map((a) => (
                  <option key={a.slug} value={a.slug}>{a.name}</option>
                ))}
              </select>
              {slots.length > 2 && (
                <button type="button" onClick={() => removeSlot(i)} aria-label="Remove" className="text-ink-500 hover:text-rose-400 text-sm px-1">×</button>
              )}
            </div>
            {i < slots.length - 1 && (
              <div className="flex items-center gap-2 pl-6 my-0.5">
                <span className="text-brand-500" aria-hidden="true">↓</span>
                <span className="text-[11px] text-ink-500">output feeds into</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={addSlot}
          className="text-xs text-ink-300 hover:text-ink-100 border border-ink-700 hover:border-ink-500 rounded-md px-2.5 py-1.5"
        >
          + Add agent
        </button>
      </div>
      <div className="mt-5 flex items-center justify-end gap-3 border-t border-ink-800 pt-4">
        {!valid && <span className="text-[11px] text-ink-600 mr-auto">Pick at least 2 different agents.</span>}
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-ink-400 hover:text-ink-200 px-3 py-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={create}
          disabled={!valid || !!busy}
          className="btn-success text-sm px-4 py-2 disabled:opacity-50"
        >
          {busy === '__custom__' ? 'Building…' : 'Create chain'}
        </button>
      </div>
    </div>
  );
}
