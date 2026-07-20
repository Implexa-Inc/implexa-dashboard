'use client';

/**
 * <JudgeReviewCard /> — the source-specific review/fix surface for an Implexa
 * Judge block, launched from the Needs You strip.
 *
 * The plain Attention card only NAVIGATES to the run; a Judge block needs the user
 * to actually DO the typed action, so this renders the card and opens a modal that
 * executes it. A blocked verdict is a rare, consequential interruption, so it is a
 * MODAL (not inline) — inline would shove the steady-state Needs You list around.
 *
 * THREE things the modal does, and one it must NEVER do:
 *   • CONTINUE WITH THIS FIX — an editable textarea prefilled with the Judge's
 *     suggested next step. The user refines it and continues; this queues a
 *     continuation (POST resolve { continuePrompt, resolution }) and, only if that
 *     enqueue succeeds, resolves the block. A failed enqueue keeps the block
 *     visible — the backend guarantees this and the dialog surfaces the error
 *     instead of closing.
 *   • I'VE HANDLED THIS — resolve WITHOUT a continuation, for a grant/open-service
 *     the user did out of band.
 *   • ACCURATE / NOT ACCURATE — calibration, DELIBERATELY ORTHOGONAL to
 *     resolution. "Not accurate" records the signal and NEVER clears the block:
 *     a wrong verdict does not mean the work is done. Feedback and resolution are
 *     separate endpoints for exactly this reason.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { AttentionItem, RequiredAction } from '@/lib/attention';

// The typed human requirement → the resolution reason the backend records. This
// is the calibration signal for whether blocked verdicts are actionable, so it
// must say HOW it was resolved, not a generic "done".
const RESOLUTION_BY_ACTION: Record<RequiredAction, string> = {
  provide_information: 'provided_information',
  grant_permission: 'granted_permission',
  open_service: 'opened_service',
  review_result: 'reviewed',
};

export default function JudgeReviewCard({ item }: { item: AttentionItem }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);

  const who = item.agentName || item.agentSlug || 'An agent';
  const judgmentId = item.sourceId;
  const resolution = RESOLUTION_BY_ACTION[item.requiredAction] || 'manually_resolved';
  const runHref = item.runId ? `/runs/${item.runId}` : '/connections';

  return (
    <div className="card flex items-center justify-between gap-3 border-amber-500/40">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-100 truncate">{who}</p>
        <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">{item.whatHappened}</p>
        {item.actionDetail && <p className="text-[11px] mt-1 text-ink-400">{item.actionDetail}</p>}
      </div>
      <button type="button" onClick={() => setOpen(true)} className="btn-outline text-xs px-3 py-1.5 flex-none">
        {item.primaryAction.label}
      </button>
      {open && (
        <JudgeReviewModal
          item={item}
          who={who}
          judgmentId={judgmentId}
          resolution={resolution}
          runHref={runHref}
          onClose={() => setOpen(false)}
          onResolved={() => { setOpen(false); router.refresh(); }}
          supabase={supabase}
        />
      )}
    </div>
  );
}

function JudgeReviewModal({
  item, who, judgmentId, resolution, runHref, onClose, onResolved, supabase,
}: {
  item: AttentionItem; who: string; judgmentId: string; resolution: string;
  runHref: string; onClose: () => void; onResolved: () => void; supabase: ReturnType<typeof createClient>;
}) {
  // Prefill the editable fix with the Judge's own suggested next step. The user
  // refines it — it is a suggestion, not a mandate.
  const [fix, setFix] = useState(item.actionDetail || '');
  const [busy, setBusy] = useState<null | 'continue' | 'handled'>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<null | 'accurate' | 'not_accurate'>(null);
  const [feedbackErr, setFeedbackErr] = useState<string | null>(null);

  async function jwt() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  }

  async function resolve(continuePrompt: string | null, which: 'continue' | 'handled') {
    setBusy(which); setError(null);
    try {
      const res = await callBackend(`/api/v2/me/judge-blocks/${encodeURIComponent(judgmentId)}/resolve`, {
        jwt: await jwt(), method: 'POST', body: { resolution, continuePrompt },
      }) as { ok?: boolean; error?: string };
      // A failed enqueue must NOT close the card — the backend leaves the block
      // open on purpose, and the user needs to see why.
      if (!res || res.ok !== true) { setError((res && res.error) || 'Could not do that. Try again.'); setBusy(null); return; }
      onResolved();
    } catch {
      setError('Could not reach the server. Try again.'); setBusy(null);
    }
  }

  async function rate(value: 'accurate' | 'not_accurate') {
    setFeedback(value); setFeedbackErr(null); // optimistic — feedback never blocks
    try {
      const res = await callBackend(`/api/v2/me/judge-blocks/${encodeURIComponent(judgmentId)}/feedback`, {
        jwt: await jwt(), method: 'POST', body: { feedback: value },
      }) as { ok?: boolean; error?: string };
      if (!res || res.ok !== true) { setFeedback(null); setFeedbackErr((res && res.error) || 'Could not save your feedback.'); }
    } catch { setFeedback(null); setFeedbackErr('Could not save your feedback.'); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal="true" aria-label="Review Implexa Judge finding"
      onClick={onClose}
    >
      <div className="card max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-ink-50">{who}</h2>
              <span className="text-[10px] uppercase tracking-wide rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-orange-300">Implexa Judge</span>
            </div>
            <p className="text-xs text-ink-400 mt-0.5">This run stopped instead of guessing. Review it, then continue.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-500 hover:text-ink-300 text-lg leading-none flex-none">×</button>
        </div>

        <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/50 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">What happened</div>
          <p className="text-sm text-ink-200 whitespace-pre-wrap">{item.whatHappened}</p>
        </div>

        <label className="block mt-3">
          <span className="text-[10px] uppercase tracking-wide text-ink-500">{item.primaryAction.label} — edit before continuing</span>
          <textarea
            value={fix}
            onChange={(e) => setFix(e.target.value)}
            rows={4}
            placeholder="Tell it exactly what to do next…"
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950/70 px-3 py-2 text-sm text-ink-100 focus:border-brand-500 focus:outline-none"
          />
        </label>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null || !fix.trim()}
            onClick={() => resolve(fix.trim(), 'continue')}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
          >
            {busy === 'continue' ? 'Continuing…' : 'Continue with this fix'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => resolve(null, 'handled')}
            title="You did this yourself (granted a permission, signed in, handled it) — just close it."
            className="btn-outline text-sm px-3 py-2 disabled:opacity-50"
          >
            {busy === 'handled' ? 'Closing…' : 'I’ve handled this'}
          </button>
          <Link href={runHref} className="text-xs text-ink-500 hover:text-ink-300 underline ml-auto">View run</Link>
        </div>

        {/* Calibration — separate from everything above. It records whether the
            verdict was right and NEVER resolves the block. */}
        <div className="mt-4 pt-3 border-t border-ink-800">
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-400">Was this review accurate?</span>
            {feedback ? (
              <span className="text-xs text-emerald-400">Thanks — noted.</span>
            ) : (
              <>
                <button type="button" onClick={() => rate('accurate')} className="text-xs px-2 py-1 rounded border border-ink-700 hover:border-emerald-500/50 text-ink-300">Accurate</button>
                <button type="button" onClick={() => rate('not_accurate')} className="text-xs px-2 py-1 rounded border border-ink-700 hover:border-amber-500/50 text-ink-300">Not accurate</button>
              </>
            )}
          </div>
          {feedbackErr && <p className="mt-1 text-[11px] text-red-400">{feedbackErr}</p>}
          <p className="mt-1 text-[11px] text-ink-600">Your feedback tunes the Judge. It doesn’t change this run.</p>
        </div>
      </div>
    </div>
  );
}
