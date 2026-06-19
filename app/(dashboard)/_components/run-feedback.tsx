'use client';

/**
 * <RunFeedback /> — the run improvement-loop feedback form, factored out of
 * inbox-list so EVERY surface that shows a run can rate it (the Results overlay,
 * the focused "Rate" pop-out, AND the /runs/[id] permalink). Previously this
 * machinery lived inline in inbox-list, so a user who landed on /runs/[id] (from
 * an Active-Agents card, an email/Telegram link, or the runs calendar) saw no
 * way to rate the run and had to detour through the agent's Runs tab.
 *
 * Renders the run's own feedback questions (choice chips + free text), falls back
 * to a GENERIC_FEEDBACK set when the run wrote none (so every run is rateable),
 * always appends a free-comment box, and optimistically POSTs to
 * /api/v2/runs/:id/feedback. Once answered (the run already has feedback_at, or
 * we just submitted) it collapses to the "thanks" state.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export type FeedbackQuestion = {
  key: string;
  question: string;
  kind?: 'choice' | 'text';
  options?: string[];
};

// Generic feedback questions for a run whose agent didn't write its own (old
// runs, or agents that produced none). So you can always rate + improve a run.
export const GENERIC_FEEDBACK: FeedbackQuestion[] = [
  { key: '_rating', question: 'How was this run?', kind: 'choice', options: ['👍 Good', '👎 Needs work'] },
  { key: 'change', question: 'Anything to change next time?', kind: 'text' },
];

// An always-present free-text answer key, appended to EVERY feedback form so the
// agent's pre-filled questions are never the only way to respond.
export const FREEFORM_KEY = '_freeform';

export default function RunFeedback({
  runId,
  feedbackQuestions,
  feedbackAnswers: _feedbackAnswers,
  feedbackAt,
  heading = false,
  onSubmitted,
}: {
  runId: string;
  feedbackQuestions: FeedbackQuestion[] | null;
  /** The run's stored answers (unused in the form today, kept for parity/future). */
  feedbackAnswers?: Record<string, string> | null;
  feedbackAt: string | null;
  /** Show the "How did this run do?" inline header (overlay + permalink). The
   *  focused modal's title already says this, so it passes heading={false}. */
  heading?: boolean;
  /** Optimistic hook so a parent list can flip the row to "answered". */
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>('');
  const [, startTransition] = useTransition();

  // The questions for this run: its own when the agent wrote them, else a
  // generic set so EVERY run can be rated.
  const qs = feedbackQuestions?.length ? feedbackQuestions : GENERIC_FEEDBACK;

  // A run is "answered" once it has stored feedback OR we just submitted it.
  const answered = !!feedbackAt || done;

  async function submit() {
    if (Object.keys(draft).length === 0) return;
    setError('');
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/runs/${runId}/feedback`, {
        jwt: session?.access_token, method: 'POST', body: { answers: draft },
      });
      setDone(true);
      onSubmitted?.();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save feedback');
    } finally {
      setBusy(false);
    }
  }

  if (answered) {
    return (
      <p className="text-sm text-success-700 dark:text-success-400">
        ✓ Thanks. The agent will use this to improve on its next run.
      </p>
    );
  }

  const answeredCount = qs.filter((q) => (draft[q.key] ?? '').toString().trim() !== '').length;
  // An always-present free-text box, so you are never boxed into the agent's
  // pre-filled questions — say anything and it rides into the next run too.
  const freeform = (draft[FREEFORM_KEY] ?? '').toString();
  const hasFreeform = freeform.trim() !== '';
  const setFreeform = (v: string) => setDraft((d) => ({ ...d, [FREEFORM_KEY]: v }));
  const canSend = (answeredCount > 0 || hasFreeform) && !busy;

  return (
    <>
      {/* Shown only inline (overlay / permalink); the focused modal's title
          already says this. */}
      {heading && (
        <div className="mb-3">
          <span className="text-sm font-medium text-ink-100">How did this run do?</span>{' '}
          <span className="text-xs text-ink-500">Your answers ride into the next run.</span>
        </div>
      )}
      <div className="space-y-3">
        {qs.map((q, i) => {
          const val = draft[q.key] ?? '';
          const setVal = (v: string) => setDraft((d) => ({ ...d, [q.key]: v }));
          const qDone = val.toString().trim() !== '';
          return (
            <div key={q.key} className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`flex-none inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold tabular-nums mt-0.5 transition-colors ${
                    qDone
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-ink-800 text-ink-400'
                  }`}
                >
                  {qDone ? '✓' : i + 1}
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
          onClick={submit}
          disabled={!canSend}
          className={
            canSend
              ? 'btn-success text-sm px-5 py-2'
              : 'btn-outline text-sm px-5 py-2 opacity-50 cursor-not-allowed'
          }
        >
          {busy ? 'Saving…' : 'Send feedback'}
        </button>
        <span className="text-xs text-ink-500">
          {error ? (
            <span className="text-rose-600 dark:text-rose-400">{error}</span>
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
