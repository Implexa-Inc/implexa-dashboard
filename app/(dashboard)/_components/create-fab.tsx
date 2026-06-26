'use client';

/**
 * <CreateFab /> — the omnipresent "create an agent from anywhere" button.
 *
 * A small floating "+ Create" pinned bottom-right on every dashboard page. Click
 * it and a compact build box drops up right there: type what you want, hit Build,
 * and it queues on your own Claude/Codex (POST /api/agents/create) — no navigating
 * to a separate page. Mounted once in the dashboard layout so it's truly global.
 *
 * Keeps the surface tiny: just an intent textarea + Build. For the full builder
 * (attachments, suggestions, schedule shaping) the /create page still exists; this
 * is the "I have an idea right now" shortcut.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type State = 'idle' | 'sending' | 'queued' | 'error';

export default function CreateFab() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => taRef.current?.focus(), 50);
  }, [open]);

  // Esc closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function submit() {
    const text = intent.trim();
    if (!text || state === 'sending') return;
    setState('sending'); setError(null);
    try {
      const res = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Could not queue the build.');
      setState('queued');
      setTimeout(() => { setOpen(false); setIntent(''); setState('idle'); router.refresh(); }, 1600);
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Could not queue the build.');
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 print:hidden">
      {open && (
        <div className="absolute bottom-14 right-0 w-[min(92vw,26rem)] card !p-4 shadow-2xl border border-ink-700">
          {state === 'queued' ? (
            <div className="py-3 text-center">
              <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">✓ Building your agent</div>
              <p className="text-xs text-ink-400 mt-1">It’s composing on your own Claude — it’ll appear in Your Agents shortly.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink-50">Describe an agent to build</h3>
                <button onClick={() => setOpen(false)} className="text-ink-500 hover:text-ink-300 text-sm" aria-label="Close">✕</button>
              </div>
              <textarea
                ref={taRef}
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
                rows={3}
                placeholder="e.g. every morning, scan my competitors’ blogs and send me what changed"
                className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-y"
              />
              {error && <p className="text-xs text-rose-500 mt-1.5">{error}</p>}
              <div className="flex items-center justify-between mt-2.5">
                <span className="text-[11px] text-ink-500">Runs on your own Claude · ⌘↵ to build</span>
                <button
                  onClick={submit}
                  disabled={!intent.trim() || state === 'sending'}
                  className={!intent.trim() || state === 'sending' ? 'btn-outline text-xs px-3 py-1.5 opacity-50 cursor-not-allowed' : 'btn-primary text-xs px-3 py-1.5'}
                >
                  {state === 'sending' ? 'Queuing…' : 'Build it'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-primary rounded-full shadow-lg px-4 py-3 text-sm font-medium flex items-center gap-2"
        title="Create an agent"
      >
        {open ? '✕' : '＋'} <span className="hidden sm:inline">{open ? 'Close' : 'Create'}</span>
      </button>
    </div>
  );
}
