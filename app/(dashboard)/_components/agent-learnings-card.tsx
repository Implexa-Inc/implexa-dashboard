'use client';

/**
 * <AgentLearningsCard /> — the agent's private LEARNINGS, in the dashboard.
 *
 * The per-(user, agent) memory layer (backend migration 0105): durable
 * preferences that accumulate as the agent runs — distilled from your feedback,
 * proposed by a run itself, or typed here — and injected into EVERY future run
 * next to the standing note. Private to you; never touches the shared public
 * agent definition.
 *
 * Self-fetches GET /api/v2/agents/:slug/learnings; add via POST; retire via
 * POST :id/retire. Shows an empty-state with the add box (this is a management
 * surface — you may want to seed a preference before the first run).
 */

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Learning = {
  id: string;
  learning: string;
  source: 'feedback' | 'revision' | 'self' | 'manual' | string;
  weight: number;
  created_at: string;
};

// How each learning got here, in plain language (shown as a small badge).
const SOURCE_LABEL: Record<string, string> = {
  feedback: 'from your feedback',
  self: 'learned from a run',
  manual: 'you added',
  revision: 'from a change request',
};

const MIN_LEN = 12;
const MAX_LEN = 400;

export default function AgentLearningsCard({ slug }: { slug: string }) {
  const supabase = createClient();
  const [learnings, setLearnings] = useState<Learning[] | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function jwt() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await callBackend(
          `/api/v2/agents/${encodeURIComponent(slug)}/learnings`,
          { jwt: await jwt() },
        );
        if (!cancelled) setLearnings((res?.learnings as Learning[]) || []);
      } catch {
        if (!cancelled) setLearnings([]); // degrade quietly (e.g. table not migrated)
      }
    })();
    return () => { cancelled = true; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (learnings === null) return null; // still loading — no flash

  async function add() {
    const text = draft.trim();
    if (text.length < MIN_LEN) { setError(`Add at least ${MIN_LEN} characters.`); return; }
    setSaving(true); setError(null);
    try {
      const res = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/learnings`, {
        jwt: await jwt(), method: 'POST', body: { text },
      });
      setLearnings((res?.learnings as Learning[]) || []);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function retire(id: string) {
    setBusyId(id); setError(null);
    try {
      const res = await callBackend(
        `/api/v2/agents/${encodeURIComponent(slug)}/learnings/${encodeURIComponent(id)}/retire`,
        { jwt: await jwt(), method: 'POST' },
      );
      setLearnings((res?.learnings as Learning[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not retire. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  const inputCls = 'w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none';

  return (
    <div className="card max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold text-ink-50">What this agent has learned</h2>
        {learnings.length > 0 && (
          <span className="flex-none text-[11px] text-ink-400">{learnings.length} active</span>
        )}
      </div>
      <p className="text-xs text-ink-400 mb-4 leading-snug">
        Private preferences that build up as this agent runs — from your feedback, from the agent noticing what you want, or added here. Every future run honors them. Only you see these; they never change the shared agent.
      </p>

      {learnings.length === 0 ? (
        <p className="text-xs text-ink-500 mb-4 italic">
          Nothing learned yet — this fills in as you run the agent and leave feedback. You can also add a preference now.
        </p>
      ) : (
        <ul className="space-y-2 mb-4">
          {learnings.map((l) => (
            <li key={l.id} className="flex items-start gap-3 rounded-md border border-ink-800 bg-ink-900/50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-100 leading-snug">{l.learning}</p>
                <span className="text-[10px] uppercase tracking-wide text-ink-500">
                  {SOURCE_LABEL[l.source] || l.source}
                </span>
              </div>
              <button
                type="button"
                onClick={() => retire(l.id)}
                disabled={busyId === l.id}
                className="flex-none text-xs text-ink-400 hover:text-rose-500 disabled:opacity-50"
                title="Retire this learning — it stops applying to future runs"
              >
                {busyId === l.id ? '…' : 'Retire'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !saving) add(); }}
          maxLength={MAX_LEN}
          placeholder="e.g. Always lead the brief with the single most important metric"
          className={inputCls}
        />
        <button
          type="button"
          onClick={add}
          disabled={saving || draft.trim().length < MIN_LEN}
          className={saving || draft.trim().length < MIN_LEN
            ? 'btn-outline text-sm px-4 py-2 opacity-50 cursor-not-allowed flex-none'
            : 'btn-success text-sm px-4 py-2 flex-none'}
        >
          {saving ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
