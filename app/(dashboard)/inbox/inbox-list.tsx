'use client';

/**
 * Client list for /inbox (Results) — compact cards + a per-run overlay.
 *
 * The feed used to render every run's FULL markdown inline, which made Results
 * a wall of text (founder: "each section should be tied to a run ... opens the
 * run in a pop up window so that it's clean"). Now each run is a compact card
 * (name, state, time, first-line snippet); clicking opens the deliverable in an
 * overlay. The overlay syncs `?run=<id>` into the URL so a notification or
 * email can deep-link straight to one result, and Esc/backdrop closes it.
 *
 * Approve/dismiss lives in the overlay footer (same optimistic POST
 * /api/v2/runs/:id/review pattern as before).
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { RunStateBadge } from '../_components/run-state-badge';
import { categorizeAgent } from '@/lib/agent-category';
import type { RunStateInfo } from '@/lib/run-state';

export type InboxItem = {
  id:              string;
  slug:            string;
  source:          string;
  name:            string;
  why:             string | null;
  output_markdown: string | null;
  ran_at:          string;
  pending:         boolean;
  state:           RunStateInfo;
};

function rel(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)        return 'just now';
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Calendar-day grouping (in the viewer's local tz), so Results reads as a
// journal: "what did my agents do today / yesterday / Monday".
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (diff === 0) return `Today · ${date}`;
  if (diff === 1) return `Yesterday · ${date}`;
  return date;
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// First readable line of a markdown deliverable, for the compact card. Strips
// heading/emphasis/link syntax; never tries to be a full renderer.
function snippet(md: string | null): string | null {
  if (!md) return null;
  const line = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]+/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0] || '';
  if (!line) return null;
  return line.length > 180 ? `${line.slice(0, 177).trimEnd()}…` : line;
}

export default function InboxList({ initialItems }: { initialItems: InboxItem[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get('run'));
  const [done, setDone] = useState<Record<string, 'approved' | 'dismissed'>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const open = useCallback((id: string) => {
    setOpenId(id);
    router.replace(`/inbox?run=${id}`, { scroll: false });
  }, [router]);

  const close = useCallback(() => {
    setOpenId(null);
    router.replace('/inbox', { scroll: false });
  }, [router]);

  // Esc closes the overlay.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, close]);

  const openItem = useMemo(() => items.find((it) => it.id === openId) || null, [items, openId]);

  async function review(id: string, status: 'approved' | 'dismissed') {
    setError((e) => ({ ...e, [id]: '' }));
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      await callBackend(`/api/v2/runs/${id}/review`, { jwt, method: 'POST', body: { status } });
      setDone((d) => ({ ...d, [id]: status }));
      setBusy((b) => ({ ...b, [id]: false }));
      setTimeout(() => {
        setItems((list) => list.map((it) => (it.id === id ? { ...it, pending: false } : it)));
        startTransition(() => router.refresh());
      }, 900);
    } catch (err) {
      setBusy((b) => ({ ...b, [id]: false }));
      setError((e) => ({ ...e, [id]: err instanceof Error ? err.message : 'Action failed' }));
    }
  }

  // Group items (already newest-first) by calendar day, with a per-day summary.
  const days = useMemo(() => {
    const out: { key: string; label: string; items: InboxItem[] }[] = [];
    for (const it of items) {
      const k = dayKey(it.ran_at);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(it);
      else out.push({ key: k, label: dayLabel(it.ran_at), items: [it] });
    }
    return out;
  }, [items]);

  return (
    <>
      <div className="space-y-8">
        {days.map((day) => {
          const delivered = day.items.filter((i) => i.output_markdown).length;
          const review = day.items.filter((i) => i.pending && !done[i.id]).length;
          return (
            <section key={day.key}>
              <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-ink-950/85 backdrop-blur-sm flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink-200">{day.label}</h2>
                <span className="text-xs text-ink-500">
                  {day.items.length} run{day.items.length === 1 ? '' : 's'} · {delivered} delivered
                  {review > 0 && <span className="text-amber-600 dark:text-amber-400"> · {review} to review</span>}
                </span>
              </div>
              <ul className="space-y-2 mt-2">
                {day.items.map((item) => {
                  const line = snippet(item.output_markdown);
                  const cat = categorizeAgent([item.name, item.why]);
                  const scheduled = item.source === 'scheduled';
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => open(item.id)}
                        className="card w-full text-left hover:border-ink-600 transition-colors cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-ink-500 tabular-nums">{timeOf(item.ran_at)}</span>
                              <h3 className="text-sm font-medium text-ink-50 truncate">
                                <span aria-hidden className="mr-1">{cat.emoji}</span>{item.name}
                              </h3>
                              <span className="text-[10px] uppercase tracking-wide text-ink-500">{scheduled ? 'scheduled' : 'manual'}</span>
                            </div>
                            {line ? (
                              <p className="text-sm text-ink-400 mt-1 line-clamp-2">{line}</p>
                            ) : item.why ? (
                              <p className="text-sm text-ink-400 mt-1 line-clamp-2">{item.why}</p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2.5 flex-none mt-0.5">
                            {item.pending && !done[item.id] && (
                              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-700 dark:text-amber-300">review</span>
                            )}
                            <RunStateBadge info={item.state} size="xs" />
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {openItem && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm px-4 py-10"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={openItem.name}
        >
          <div
            className="card w-full max-w-3xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-ink-50">{openItem.name}</h2>
                <div className="flex items-center gap-2.5 mt-1">
                  <RunStateBadge info={openItem.state} size="xs" />
                  <span className="text-xs text-ink-500">{rel(openItem.ran_at)}</span>
                  <span className="text-xs text-ink-600 font-mono truncate">{openItem.slug}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                className="flex-none text-ink-400 hover:text-ink-100 text-xl leading-none px-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {openItem.output_markdown ? (
              <div className="prose prose-sm max-w-none rounded-lg border border-ink-800 bg-ink-950/60 p-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {openItem.output_markdown}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-ink-400 italic">No deliverable recorded for this run.</p>
            )}

            <div className="mt-5 flex items-center gap-3">
              {done[openItem.id] ? (
                <span className="text-sm text-success-700 dark:text-success-400">
                  {done[openItem.id] === 'approved' ? '✓ Marked reviewed' : '✓ Dismissed'}
                </span>
              ) : openItem.pending ? (
                <>
                  <button
                    type="button"
                    onClick={() => review(openItem.id, 'approved')}
                    disabled={busy[openItem.id]}
                    className="btn-success"
                  >
                    {busy[openItem.id] ? 'Saving…' : 'Mark reviewed'}
                  </button>
                  <button
                    type="button"
                    onClick={() => review(openItem.id, 'dismissed')}
                    disabled={busy[openItem.id]}
                    className="btn-outline"
                  >
                    Dismiss
                  </button>
                  {error[openItem.id] && (
                    <span className="text-xs text-rose-600 dark:text-rose-400">{error[openItem.id]}</span>
                  )}
                </>
              ) : (
                <span className="text-xs text-ink-500">reviewed</span>
              )}
              <button type="button" onClick={close} className="ml-auto text-xs text-ink-400 hover:text-ink-200">
                Close
              </button>
            </div>
            {openItem.pending && !done[openItem.id] && (
              <p className="mt-2 text-xs text-ink-500">
                Marking only records this run as reviewed. It will not re-run the
                agent or post anything.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
