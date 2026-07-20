'use client';

/**
 * <JudgeFeedbackControls /> — "Was this review accurate?" for ONE judgment.
 *
 * Reusable on purpose: the Needs You review dialog shows it for blocked verdicts,
 * and the run's Judge card shows it for EVERY verdict (pass/repair/blocked/
 * uncertain). Observe mode collects representative verdict-quality data only if a
 * wrong `pass` is as rateable as a block — exposing this for blocks alone biases
 * the calibration set toward the one verdict type that already stops the loop.
 *
 * CALIBRATION, NOT ACTION. This posts to the FEEDBACK endpoint, which is
 * deliberately separate from resolve: rating a verdict wrong must never clear the
 * block or imply the work is done. It shows the SAVED rating when one exists, and
 * lets the user intentionally change it.
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Rating = 'accurate' | 'not_accurate';

export default function JudgeFeedbackControls({
  judgmentId, initial = null, className = '',
}: {
  judgmentId: string;
  initial?: Rating | null;
  className?: string;
}) {
  const supabase = createClient();
  const [saved, setSaved] = useState<Rating | null>(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<Rating | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rate(value: Rating) {
    setBusy(value); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend(`/api/v2/me/judge-blocks/${encodeURIComponent(judgmentId)}/feedback`, {
        jwt: session?.access_token, method: 'POST', body: { feedback: value },
      }) as { ok?: boolean; error?: string };
      if (!res || res.ok !== true) { setError((res && res.error) || 'Could not save your feedback.'); setBusy(null); return; }
      setSaved(value); setEditing(false); setBusy(null);
    } catch { setError('Could not save your feedback.'); setBusy(null); }
  }

  const showButtons = saved === null || editing;

  return (
    <div className={className}>
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-xs text-ink-400">Was this review accurate?</span>
        {showButtons ? (
          <>
            <button type="button" disabled={busy !== null} onClick={() => rate('accurate')}
              className={`text-xs px-2 py-1 rounded border ${saved === 'accurate' ? 'border-emerald-500/60 text-emerald-300' : 'border-ink-700 text-ink-300 hover:border-emerald-500/50'} disabled:opacity-50`}>
              {busy === 'accurate' ? 'Saving…' : 'Accurate'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => rate('not_accurate')}
              className={`text-xs px-2 py-1 rounded border ${saved === 'not_accurate' ? 'border-amber-500/60 text-amber-300' : 'border-ink-700 text-ink-300 hover:border-amber-500/50'} disabled:opacity-50`}>
              {busy === 'not_accurate' ? 'Saving…' : 'Not accurate'}
            </button>
          </>
        ) : (
          <span className="text-xs text-ink-300">
            You rated this <span className={saved === 'accurate' ? 'text-emerald-400' : 'text-amber-400'}>{saved === 'accurate' ? 'accurate' : 'not accurate'}</span>.
            <button type="button" onClick={() => setEditing(true)} className="ml-2 text-ink-500 hover:text-ink-300 underline">Change</button>
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
      <p className="mt-1 text-[11px] text-ink-600">Your feedback tunes the Judge. It doesn’t change this run.</p>
    </div>
  );
}
