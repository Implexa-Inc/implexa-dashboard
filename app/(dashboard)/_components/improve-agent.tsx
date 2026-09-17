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
import { canSubmitAgentRevision, confirmedAgentRevisionRequestId } from '@/lib/run-request-receipt';

type State = 'idle' | 'sending' | 'queued' | 'error';

export default function ImproveAgent({ slug, bare = false, statusUnavailable = false, revisePending = false }: { slug: string; bare?: boolean; statusUnavailable?: boolean; revisePending?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(bare);
  const [note, setNote] = useState('');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [queuedRequestId, setQueuedRequestId] = useState<string | null>(null);

  async function submit() {
    const text = note.trim();
    if (!canSubmitAgentRevision({ statusUnavailable, revisionPending: revisePending, busy: state === 'sending', note: text })) return;
    setState('sending'); setError(null);
    try {
      const res = await fetch('/api/agents/revise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, note: text }),
      });
      const data = await res.json().catch(() => null);
      const requestId = confirmedAgentRevisionRequestId(res.ok, data);
      if (!requestId) throw new Error(data?.error || 'Could not confirm the queued change.');
      setQueuedRequestId(requestId);
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
        <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">✓ Edit request queued</div>
        <p className="text-xs text-ink-400 mt-1">
          The request is saved. A new agent version does not exist yet; your execution engine must process the edit
          and save it first. The original stays active until that succeeds.
        </p>
        {queuedRequestId && (
          <p className="mt-1 text-[10px] font-mono text-ink-500" title={queuedRequestId}>
            Request {queuedRequestId.slice(0, 8)}
          </p>
        )}
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
            <button onClick={() => setOpen(true)} disabled={statusUnavailable || revisePending} className="btn-outline text-sm px-3 py-1.5 flex-none disabled:opacity-50 disabled:cursor-not-allowed">Edit</button>
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
            disabled={statusUnavailable || revisePending}
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
                disabled={!canSubmitAgentRevision({ statusUnavailable, revisionPending: revisePending, busy: state === 'sending', note })}
                className={!canSubmitAgentRevision({ statusUnavailable, revisionPending: revisePending, busy: state === 'sending', note }) ? 'btn-outline text-xs px-3 py-1.5 opacity-50 cursor-not-allowed' : 'btn-primary text-xs px-3 py-1.5'}
              >
                {state === 'sending' ? 'Queuing…' : 'Apply change'}
              </button>
            </div>
          </div>
        </div>
      )}
      {statusUnavailable && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Edit status is unavailable. Reload before queueing another permanent change.
        </p>
      )}
      {!statusUnavailable && revisePending && (
        <p className="mt-2 text-xs text-violet-600 dark:text-violet-400">
          An edit is already queued. Wait for it to create a new version before adding another.
        </p>
      )}
    </>
  );

  return bare ? content : <div className="card max-w-2xl">{content}</div>;
}
