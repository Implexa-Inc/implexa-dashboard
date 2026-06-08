'use client';

/**
 * Client list for /inbox. Holds the pending items in state so an approve or
 * dismiss can optimistically drop the card the moment the user acts, with a
 * rollback if the backend call fails.
 *
 * The mutation follows the established access-token pattern (see
 * settings/data/data-rights-form.tsx): read the Supabase session client-side,
 * pull session.access_token, and POST to the backend via callBackend with the
 * JWT. Endpoint: POST /api/v2/runs/:id/review { status }.
 *
 * Markdown is rendered with react-markdown + remark-gfm + rehype-highlight (all
 * already dependencies, same stack the skill-detail and share pages use) inside
 * a `prose` block whose tokens are already wired to the dark ink palette.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export type InboxItem = {
  id:              string;
  slug:            string;
  source:          string;
  name:            string;
  why:             string | null;
  output_markdown: string | null;
  ran_at:          string;
  pending:         boolean;
};

function rel(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)        return 'just now';
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function InboxList({ initialItems }: { initialItems: InboxItem[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  // id -> 'approved' | 'dismissed' for the brief confirmation toast that
  // replaces the card before it animates out.
  const [done, setDone] = useState<Record<string, 'approved' | 'dismissed'>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  async function review(id: string, status: 'approved' | 'dismissed') {
    setError((e) => ({ ...e, [id]: '' }));
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      await callBackend(`/api/v2/runs/${id}/review`, { jwt, method: 'POST', body: { status } });

      // Results is the full recent feed, not a queue: keep the card in place and
      // flip it to reviewed (which drops its action row) rather than removing it.
      // The sidebar badge is server-rendered, so refresh it (cheap, force-dynamic)
      // once the state settles to keep the pending count honest.
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

  return (
    <ul className="space-y-5">
      {items.map((item) => {
        const confirmed = done[item.id];
        return (
          <li
            key={item.id}
            className={`card transition-opacity duration-500 ${confirmed ? 'opacity-50' : 'opacity-100'}`}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-base font-medium text-ink-50 truncate">{item.name}</h2>
                {item.why ? (
                  <p className="text-sm text-ink-300 mt-0.5">{item.why}</p>
                ) : (
                  <p className="text-xs text-ink-500 mt-0.5 font-mono">{item.slug}</p>
                )}
              </div>
              <span className="text-xs text-ink-500 flex-none whitespace-nowrap mt-1">{rel(item.ran_at)}</span>
            </div>

            {item.output_markdown ? (
              <div className="prose prose-sm max-w-none rounded-lg border border-ink-800 bg-ink-950/60 p-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {item.output_markdown}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-ink-400 italic">No deliverable recorded for this run.</p>
            )}

            <div className="mt-4 flex items-center gap-3">
              {confirmed ? (
                <span className="text-sm text-success-700 dark:text-success-400">
                  {confirmed === 'approved' ? '✓ Approved' : '✓ Dismissed'}
                </span>
              ) : item.pending ? (
                <>
                  <button
                    type="button"
                    onClick={() => review(item.id, 'approved')}
                    disabled={busy[item.id]}
                    className="btn-success"
                  >
                    {busy[item.id] ? 'Saving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => review(item.id, 'dismissed')}
                    disabled={busy[item.id]}
                    className="btn-outline"
                  >
                    Dismiss
                  </button>
                  {error[item.id] && (
                    <span className="text-xs text-rose-600 dark:text-rose-400">{error[item.id]}</span>
                  )}
                </>
              ) : (
                <span className="text-xs text-ink-500">reviewed</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
