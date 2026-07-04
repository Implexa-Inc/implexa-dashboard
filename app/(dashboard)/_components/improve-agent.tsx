'use client';

/**
 * <ImproveAgent /> — the "edit / improve this agent" form.
 *
 * There was no way to change what an agent DOES (only config answers + a standing
 * note). This takes a plain-language instruction ("add a step that posts to
 * Instagram", "make the research deeper", "email me the result too") and queues a
 * kind='revise' request: the user's own Claude loads the current steps and calls
 * revise_workflow with the full revised chain, so every future run uses the new
 * steps. A new version — the original is preserved.
 *
 * `bare` renders just the form (no card wrapper, no internal title, textarea open
 * immediately) — used inside <AgentEditButton>'s Modal, which already supplies
 * the card chrome + title + close button. Without `bare` it's the old
 * self-contained collapsed/expand card (kept for any other embedding).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type State = 'idle' | 'sending' | 'queued' | 'error';

export default function ImproveAgent({ slug, bare = false }: { slug: string; bare?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(bare);
  const [note, setNote] = useState('');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = note.trim();
    if (!text || state === 'sending') return;
    setState('sending'); setError(null);
    try {
      const res = await fetch('/api/agents/revise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, note: text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Could not queue the change.');
      setState('queued');
      // Re-render the agent page behind the modal so the "Rewrite in progress"
      // indicator shows and Run now disables immediately — without a manual reload.
      router.refresh();
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Could not queue the change.');
    }
  }

  if (state === 'queued') {
    const body = (
      <>
        <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">✓ Change queued</div>
        <p className="text-xs text-ink-400 mt-1">
          Your Claude will rewrite this agent’s steps with your change — every future run uses the new version.
          The original is kept.
        </p>
      </>
    );
    return bare ? body : <div className="card max-w-2xl !border-emerald-500/30">{body}</div>;
  }

  const content = (
    <>
      {!bare && (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink-50">Edit this agent</h2>
            <p className="text-xs text-ink-400 mt-0.5 leading-snug">
              Tell it what to change — in plain words. It rewrites the steps into a new version (the original is kept).
            </p>
          </div>
          {!open && (
            <button onClick={() => setOpen(true)} className="btn-outline text-sm px-3 py-1.5 flex-none">Edit</button>
          )}
        </div>
      )}
      {bare && (
        <p className="text-xs text-ink-400 leading-snug mb-3">
          Tell it what to change — in plain words. It rewrites the steps into a new version (the original is kept).
        </p>
      )}

      {open && (
        <div className={bare ? '' : 'mt-3'}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
            rows={3}
            autoFocus
            placeholder="e.g. add a final step that posts the result to Instagram · make the research cover the last 30 days · also email me a summary"
            className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-y"
          />
          {error && <p className="text-xs text-rose-500 mt-1.5">{error}</p>}
          <div className="flex items-center justify-between mt-2.5">
            <span className="text-[11px] text-ink-500">Rewrites the agent on your own Claude · ⌘↵</span>
            <div className="flex items-center gap-2">
              {!bare && (
                <button onClick={() => { setOpen(false); setNote(''); setState('idle'); setError(null); }} className="text-xs text-ink-400 hover:text-ink-200">Cancel</button>
              )}
              <button
                onClick={submit}
                disabled={!note.trim() || state === 'sending'}
                className={!note.trim() || state === 'sending' ? 'btn-outline text-xs px-3 py-1.5 opacity-50 cursor-not-allowed' : 'btn-primary text-xs px-3 py-1.5'}
              >
                {state === 'sending' ? 'Queuing…' : 'Apply change'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return bare ? content : <div className="card max-w-2xl">{content}</div>;
}
