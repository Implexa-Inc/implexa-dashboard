'use client';

/**
 * <ExtendChain /> — "Add a step" for an existing chain agent, the cycle-checked
 * counterpart to building a chain from scratch.
 *
 * Shown on a chain's detail page (only when the agent IS a chain). Pick one of
 * your other agents and it's appended to the END of THIS chain in place — same
 * agent, same slug, schedule + run history preserved — via POST /me/chains/extend.
 * The backend flattens to leaf agents and refuses anything that would re-introduce
 * the chain (no cycle), so this never spawns a duplicate or a self-referential mess
 * (the failure mode of the old edit-on-extend-during-creation path).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Candidate = { slug: string; source: string; name: string };

export default function ExtendChain({ slug, candidates }: { slug: string; candidates: Candidate[] }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  if (!candidates.length) return null;

  async function add() {
    const c = candidates.find((x) => x.slug === pick);
    if (!c || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/chains/extend', {
        jwt: session?.access_token,
        method: 'POST',
        body: { chainSlug: slug, agents: [{ source: c.source, slug: c.slug, name: c.name }] },
      });
      if (res?.ok) { setOpen(false); setPick(''); router.refresh(); }
      else setErr(res?.error || 'Could not add that step.');
    } catch {
      setErr('Could not add that step.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-ink-400 hover:text-ink-100 border border-ink-700 hover:border-ink-500 rounded-md px-2.5 py-1.5 transition-colors"
      >
        + Add a step
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="min-w-0 max-w-[260px] truncate bg-ink-900 border border-ink-700 rounded-md text-sm px-2 py-1.5 text-ink-100 focus:border-brand-500/60 focus:outline-none"
      >
        <option value="">Append an agent…</option>
        {candidates.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
      </select>
      <button
        type="button"
        onClick={add}
        disabled={!pick || busy}
        className="btn-success text-xs px-3 py-1.5 disabled:opacity-50"
      >
        {busy ? 'Adding…' : 'Add to chain'}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setErr(null); setPick(''); }}
        disabled={busy}
        className="text-xs text-ink-500 hover:text-ink-200 px-2 py-1.5"
      >
        Cancel
      </button>
      {err && <span className="text-xs text-rose-600 dark:text-rose-400 w-full">{err}</span>}
    </div>
  );
}
