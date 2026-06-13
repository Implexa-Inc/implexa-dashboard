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
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import Modal from '../_components/modal';
import { RunStateBadge } from '../_components/run-state-badge';
import { categorizeAgent } from '@/lib/agent-category';
import type { RunStateInfo } from '@/lib/run-state';

export type FeedbackQuestion = { key: string; question: string; kind?: 'choice' | 'text'; options?: string[] };

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
  /** The run's own feedback questions about this output (improvement loop). */
  feedbackQuestions: FeedbackQuestion[] | null;
  feedbackAnswers:   Record<string, string> | null;
  feedbackAt:        string | null;
};

// Traffic-light status so Results reads as a clear-it-to-zero todo list:
//   red    = the run needs action (failed / stalled).
//   amber  = the run wants YOU (feedback not yet given, or held for review).
//   green  = done, nothing owed.
type Light = 'red' | 'amber' | 'green';
function lightOf(it: InboxItem, answered: boolean): Light {
  if (it.state.attention) return 'red';
  // Any delivered run you haven't given feedback on (or that's held for review)
  // wants you. Feedback is available on EVERY run, not only ones the agent wrote
  // questions for, so a bare "Done" run can still be rated and improved.
  if (it.pending || !answered) return 'amber';
  return 'green';
}
const LIGHT_DOT: Record<Light, string> = {
  red:   'bg-rose-500',
  amber: 'bg-amber-400',
  green: 'bg-emerald-500',
};
// The label next to the dot, so the colour isn't a guessing game (founder:
// "just a yellow dot is not intuitive — say Give Feedback").
const LIGHT_LABEL: Record<Light, string> = {
  red:   'Take action',
  amber: 'Give feedback',
  green: 'Done',
};
const LIGHT_TEXT: Record<Light, string> = {
  red:   'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-700 dark:text-amber-300',
  green: 'text-ink-500',
};

// Generic feedback questions for a run whose agent didn't write its own (old
// runs, or agents that produced none). So you can always rate + improve a run.
const GENERIC_FEEDBACK: FeedbackQuestion[] = [
  { key: '_rating', question: 'How was this run?', kind: 'choice', options: ['👍 Good', '👎 Needs work'] },
  { key: 'change', question: 'Anything to change next time?', kind: 'text' },
];

// An always-present free-text answer key, appended to EVERY feedback form so the
// agent's pre-filled questions are never the only way to respond.
const FREEFORM_KEY = '_freeform';

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

export default function InboxList({
  initialItems,
  basePath = '/inbox',
}: {
  initialItems: InboxItem[];
  /** Route the `?run=` deep-link syncs to. Home embeds this list at /overview. */
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get('run'));
  // The focused feedback pop-out (separate from the output overlay) , opened by a
  // row's "Give feedback" chip, so feedback is one tap with no output wall.
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'approved' | 'dismissed'>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Record<string, string>>({});
  // Feedback: per-run draft answers, submitting flag, and the thank-you state.
  const [fbDraft, setFbDraft] = useState<Record<string, Record<string, string>>>({});
  const [fbBusy, setFbBusy] = useState<Record<string, boolean>>({});
  const [fbDone, setFbDone] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  // A run is "answered" once it has stored feedback OR we just submitted it.
  const isAnswered = useCallback(
    (it: InboxItem) => !!it.feedbackAt || !!fbDone[it.id],
    [fbDone],
  );

  async function submitFeedback(it: InboxItem) {
    const draft = fbDraft[it.id] || {};
    if (Object.keys(draft).length === 0) return;
    setFbBusy((b) => ({ ...b, [it.id]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/runs/${it.id}/feedback`, {
        jwt: session?.access_token, method: 'POST', body: { answers: draft },
      });
      setFbDone((d) => ({ ...d, [it.id]: true }));
      setItems((list) => list.map((x) => (x.id === it.id ? { ...x, feedbackAt: new Date().toISOString() } : x)));
      startTransition(() => router.refresh());
    } catch (err) {
      setError((e) => ({ ...e, [it.id]: err instanceof Error ? err.message : 'Could not save feedback' }));
    } finally {
      setFbBusy((b) => ({ ...b, [it.id]: false }));
    }
  }

  const open = useCallback((id: string) => {
    setOpenId(id);
    router.replace(`${basePath}?run=${id}`, { scroll: false });
  }, [router, basePath]);

  const close = useCallback(() => {
    setOpenId(null);
    router.replace(basePath, { scroll: false });
  }, [router, basePath]);

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

  // The questions for a run: its own when the agent wrote them, else a generic
  // set so EVERY run can be rated.
  const feedbackQsFor = (it: InboxItem): FeedbackQuestion[] =>
    it.feedbackQuestions?.length ? it.feedbackQuestions : GENERIC_FEEDBACK;

  // The feedback form body, shared by the focused feedback pop-out AND the output
  // overlay so there is one implementation. Closes over the per-run draft state.
  // Each question is a numbered card so a 3-question form reads as 3 small steps,
  // not a wall; the footer shows answered-count so Send's state is never a mystery.
  function feedbackInner(it: InboxItem, opts: { heading?: boolean } = {}) {
    if (isAnswered(it)) {
      return (
        <p className="text-sm text-success-700 dark:text-success-400">
          ✓ Thanks. The agent will use this to improve on its next run.
        </p>
      );
    }
    const qs = feedbackQsFor(it);
    const answeredCount = qs.filter((q) => (fbDraft[it.id]?.[q.key] ?? '').toString().trim() !== '').length;
    // An always-present free-text box, so you are never boxed into the agent's
    // pre-filled questions — say anything and it rides into the next run too.
    const freeform = (fbDraft[it.id]?.[FREEFORM_KEY] ?? '').toString();
    const hasFreeform = freeform.trim() !== '';
    const setFreeform = (v: string) =>
      setFbDraft((d) => ({ ...d, [it.id]: { ...(d[it.id] || {}), [FREEFORM_KEY]: v } }));
    const canSend = (answeredCount > 0 || hasFreeform) && !fbBusy[it.id];
    return (
      <>
        {/* Shown only inside the output overlay; the focused modal's title
            already says this. */}
        {opts.heading && (
          <div className="mb-3">
            <span className="text-sm font-medium text-ink-100">How did this run do?</span>{' '}
            <span className="text-xs text-ink-500">Your answers ride into the next run.</span>
          </div>
        )}
        <div className="space-y-3">
          {qs.map((q, i) => {
            const val = fbDraft[it.id]?.[q.key] ?? '';
            const setVal = (v: string) =>
              setFbDraft((d) => ({ ...d, [it.id]: { ...(d[it.id] || {}), [q.key]: v } }));
            const done = val.toString().trim() !== '';
            return (
              <div key={q.key} className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={`flex-none inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold tabular-nums mt-0.5 transition-colors ${
                      done
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                        : 'bg-ink-800 text-ink-400'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <label className="block text-sm text-ink-100 leading-relaxed">{q.question}</label>
                    <div className="mt-2.5">
                      {q.kind === 'text' ? (
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => setVal(e.target.value)}
                          placeholder="A short note (optional)"
                          className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none"
                        />
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(q.options && q.options.length ? q.options : ['Yes', 'No']).map((o) => (
                            <button
                              key={o}
                              type="button"
                              onClick={() => setVal(val === o ? '' : o)}
                              aria-pressed={val === o}
                              className={`text-[13px] px-3.5 py-1.5 rounded-full border transition-colors ${
                                val === o
                                  ? 'border-brand-500 bg-brand-500/15 text-brand-600 dark:text-brand-300 font-medium'
                                  : 'border-ink-700 text-ink-300 hover:border-ink-400 hover:text-ink-100'
                              }`}
                            >
                              {o}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Always-on free comment: never be boxed into the agent's questions. */}
          <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={`flex-none inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-semibold mt-0.5 transition-colors ${
                  hasFreeform
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-ink-800 text-ink-400'
                }`}
              >
                {hasFreeform ? '✓' : '+'}
              </span>
              <div className="min-w-0 flex-1">
                <label className="block text-sm text-ink-100 leading-relaxed">
                  Anything else?{' '}
                  <span className="text-ink-500 font-normal">in your own words (optional)</span>
                </label>
                <textarea
                  value={freeform}
                  onChange={(e) => setFreeform(e.target.value)}
                  rows={2}
                  placeholder="Tell the agent anything — what to do differently, what you liked, a new instruction…"
                  className="mt-2.5 w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none resize-y"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => submitFeedback(it)}
            disabled={!canSend}
            className={
              canSend
                ? 'btn-success text-sm px-5 py-2'
                : 'btn-outline text-sm px-5 py-2 opacity-50 cursor-not-allowed'
            }
          >
            {fbBusy[it.id] ? 'Saving…' : 'Send feedback'}
          </button>
          <span className="text-xs text-ink-500">
            {error[it.id] ? (
              <span className="text-rose-600 dark:text-rose-400">{error[it.id]}</span>
            ) : answeredCount === 0 && !hasFreeform ? (
              'Answer any one, or just write a comment, to send.'
            ) : (
              `${answeredCount} of ${qs.length} answered${hasFreeform ? ' + your comment' : ''}`
            )}
          </span>
        </div>
      </>
    );
  }

  const feedbackItem = useMemo(() => items.find((it) => it.id === feedbackId) || null, [items, feedbackId]);

  // The row's ONE next-action button (the colored chip). Each opens its own
  // focused pop-out: amber -> the feedback modal; red (permission-blocked) ->
  // the agent's grant UI; otherwise -> the output overlay.
  function renderAction(it: InboxItem) {
    const light = lightOf(it, isAnswered(it));
    const dot = <span className={`inline-block size-2 rounded-full ${LIGHT_DOT[light]}`} aria-hidden />;
    const base = 'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors';
    if (light === 'amber') {
      return (
        <button
          type="button"
          onClick={() => setFeedbackId(it.id)}
          className={`${base} border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10`}
        >
          {dot} Give feedback
        </button>
      );
    }
    if (light === 'red') {
      if (it.state.permissionBlocked) {
        return (
          <Link
            href={`/workflows/${encodeURIComponent(it.slug)}/activate`}
            className={`${base} border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10`}
          >
            {dot} Fix
          </Link>
        );
      }
      return (
        <button
          type="button"
          onClick={() => open(it.id)}
          className={`${base} border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10`}
        >
          {dot} View
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => open(it.id)}
        className={`${base} border-ink-700 text-ink-400 hover:text-ink-100 hover:border-ink-500`}
      >
        {dot} View
      </button>
    );
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

  const needYou = items.filter((it) => lightOf(it, isAnswered(it)) !== 'green').length;

  return (
    <>
      {/* Inbox-zero header: a count that nudges you to clear the colored todos. */}
      <div className="mb-5 flex items-center gap-2 text-sm">
        {needYou > 0 ? (
          <>
            <span className="inline-block size-2 rounded-full bg-amber-400" aria-hidden />
            <span className="text-ink-200 font-medium">{needYou} run{needYou === 1 ? '' : 's'} need you</span>
            <span className="text-ink-500">— give quick feedback or take action to clear them.</span>
          </>
        ) : (
          <>
            <span className="inline-block size-2 rounded-full bg-emerald-500" aria-hidden />
            <span className="text-ink-300">You&apos;re all caught up. Nothing needs you.</span>
          </>
        )}
      </div>

      <div className="space-y-8">
        {days.map((day) => {
          const delivered = day.items.filter((i) => i.output_markdown).length;
          const needYouDay = day.items.filter((i) => lightOf(i, isAnswered(i)) !== 'green').length;
          return (
            <section key={day.key}>
              <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-ink-950/85 backdrop-blur-sm flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink-200">{day.label}</h2>
                <span className="text-xs text-ink-500">
                  {day.items.length} run{day.items.length === 1 ? '' : 's'} · {delivered} delivered
                  {needYouDay > 0 && <span className="text-amber-600 dark:text-amber-400"> · {needYouDay} need you</span>}
                </span>
              </div>
              <ul className="space-y-2 mt-2">
                {day.items.map((item) => {
                  const line = snippet(item.output_markdown);
                  const cat = categorizeAgent([item.name, item.why]);
                  const scheduled = item.source === 'scheduled';
                  return (
                    <li key={item.id}>
                      <div className="card hover:border-ink-600 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          {/* body opens the output overlay; the chip on the right
                              does the one focused next-action */}
                          <button
                            type="button"
                            onClick={() => open(item.id)}
                            className="min-w-0 flex-1 text-left cursor-pointer"
                          >
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
                          </button>
                          <div className="flex items-center gap-2 flex-none mt-0.5">
                            {renderAction(item)}
                            {/* keep the specific state only for a run that needs action */}
                            {item.state.attention && <RunStateBadge info={item.state} size="xs" />}
                          </div>
                        </div>
                      </div>
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

            {/* Per-run feedback , the same focused-popout form, inline here too
                so you can rate without leaving the output. */}
            {openItem.output_markdown && (
              <div className="mt-5 rounded-lg border border-ink-800 bg-ink-900/40 p-4">
                {feedbackInner(openItem, { heading: true })}
              </div>
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

      {/* The focused feedback pop-out , opened by a row's "Give feedback" chip.
          One tap to rate, no output wall. Shares feedbackInner with the overlay. */}
      <Modal
        open={!!feedbackItem}
        onClose={() => setFeedbackId(null)}
        title="How did this run do?"
        maxWidth="max-w-xl"
        subtitle={
          <span className="text-xs text-ink-500">
            <span className="text-ink-300">{feedbackItem?.name}</span>
            {' · your answers ride into its next run'}
          </span>
        }
      >
        {feedbackItem && feedbackInner(feedbackItem)}
      </Modal>
    </>
  );
}
