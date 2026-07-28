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
 * THE ACTION DEPENDS ON THE TYPED REQUIREMENT — and this is a correctness matter,
 * not cosmetics (2026-07-19 review):
 *   • provide_information → the user supplies the missing info; continue WITH it.
 *   • grant_permission / open_service → the user removed a PREREQUISITE (granted,
 *     signed in). The agent has NOT finished — it must resume. So these ALWAYS
 *     send a continuation; there is no "handled, queue nothing" path for them,
 *     because that would resolve the block and abandon the run mid-flight — the
 *     exact silent-stop Judge exists to prevent.
 *   • review_result → the user's judgement call. This is the ONLY case where "I
 *     reviewed this — close" may resolve WITHOUT continuing.
 *
 * Continuing queues a continuation and resolves the block only if the enqueue
 * succeeds; a failure surfaces the error and keeps the dialog open, mirroring the
 * backend leaving the block visible. Accuracy feedback is separate and never
 * resolves (see JudgeFeedbackControls).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { AttentionItem, RequiredAction } from '@/lib/attention';
import JudgeFeedbackControls from './judge-feedback-controls';

// The typed human requirement → the primary button, and whether a null
// (no-continuation) close is even allowed.
//
// The RESOLUTION REASON deliberately lives ONLY on the server now: it is derived
// from the judgment's own human_requirement so a client cannot mislabel the
// calibration record. Keeping a second copy here would be the same drift this
// workstream keeps paying for.
const ACTION_UI: Record<RequiredAction, {
  primaryLabel: string;
  requireText: boolean;      // the answer IS the info — cannot continue empty
  resumePrompt: string;      // default continuation if the user leaves the box empty
  prefill: (detail: string | null) => string;
  allowClose: boolean;       // offer "I reviewed this — close" (null continuation)
}> = {
  provide_information: {
    primaryLabel: 'Continue with this answer',
    requireText: true, resumePrompt: '', prefill: () => '', allowClose: false,
  },
  grant_permission: {
    primaryLabel: 'I granted access — continue',
    requireText: false, resumePrompt: 'I’ve granted the access it needed. Please continue where you left off.',
    prefill: () => 'I’ve granted the access it needed. Please continue where you left off.', allowClose: false,
  },
  open_service: {
    primaryLabel: 'I’m signed in — continue',
    requireText: false, resumePrompt: 'I’m signed in now. Please continue where you left off.',
    prefill: () => 'I’m signed in now. Please continue where you left off.', allowClose: false,
  },
  continue_work: {
    primaryLabel: 'Continue the work',
    requireText: false, resumePrompt: 'I approve the staged work. Continue with the remaining steps.',
    prefill: () => 'I approve the staged work. Continue with the remaining steps.', allowClose: false,
  },
  review_result: {
    primaryLabel: 'Continue with this note',
    requireText: false, resumePrompt: 'Please continue.', prefill: () => '', allowClose: true,
  },
};

export default function JudgeReviewCard({ item }: { item: AttentionItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The saved rating lives HERE, not only inside the control: the modal unmounts
  // on close, so a control-local value would be lost and an immediate reopen would
  // show blank buttons (inviting a second, conflicting vote). `item.feedback` only
  // catches up after a server refresh.
  const [feedback, setFeedback] = useState(item.feedback ?? null);

  const who = item.agentName || item.agentSlug || 'An agent';

  return (
    <div className="card flex items-center justify-between gap-3 border-amber-500/40">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-100 truncate">{who}</p>
        <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">{item.whatHappened}</p>
        {item.actionDetail && <p className="text-[11px] mt-1 text-ink-400">{item.actionDetail}</p>}
      </div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className="btn-outline text-xs px-3 py-1.5 flex-none">
        {item.primaryAction.label}
      </button>
      {open && (
        <JudgeReviewModal
          item={item}
          who={who}
          feedback={feedback}
          onFeedbackSaved={setFeedback}
          onClose={() => setOpen(false)}
          onResolved={() => { setOpen(false); router.refresh(); }}
          restoreFocusTo={triggerRef}
        />
      )}
    </div>
  );
}

function JudgeReviewModal({
  item, who, onClose, onResolved, restoreFocusTo, feedback, onFeedbackSaved,
}: {
  item: AttentionItem; who: string;
  onClose: () => void; onResolved: () => void;
  restoreFocusTo: React.RefObject<HTMLElement>;
  feedback: 'accurate' | 'not_accurate' | null;
  onFeedbackSaved: (v: 'accurate' | 'not_accurate') => void;
}) {
  const supabase = createClient();
  const judgmentId = item.sourceId;
  const ui = ACTION_UI[item.requiredAction] || ACTION_UI.review_result;

  const [fix, setFix] = useState(ui.prefill(item.actionDetail));
  const [busy, setBusy] = useState<null | 'continue' | 'close'>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // ── Accessibility: initial focus, focus trap, Escape, restore focus ────────
  const stableClose = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const node = dialogRef.current;
    const focusables = () => node
      ? Array.from(node.querySelectorAll<HTMLElement>('button, [href], textarea, input, [tabindex]:not([tabindex="-1"])'))
          .filter((el) => !el.hasAttribute('disabled'))
      : [];
    // Initial focus goes into the dialog (its container is focusable via tabIndex).
    (focusables()[0] || node)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); stableClose(); return; }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (!els.length) { e.preventDefault(); node?.focus(); return; }
      const first = els[0]; const last = els[els.length - 1];
      // CONTAINMENT FALLBACK. Handling only first/last leaks: clicking a feedback
      // button REMOVES it from the DOM (it is replaced by the saved-state text), so
      // focus falls to <body> — which is neither first nor last, and every
      // subsequent Tab then walks the page BEHIND the modal. If focus is anywhere
      // outside the dialog, pull it back in.
      const active = document.activeElement;
      if (!node || !active || !node.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Restore focus to the control that opened the modal.
      restoreFocusTo.current?.focus?.();
    };
  }, [stableClose, restoreFocusTo]);

  async function jwt() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  }

  async function resolve(continuePrompt: string | null, which: 'continue' | 'close') {
    setBusy(which); setError(null);
    try {
      const res = await callBackend(`/api/v2/me/judge-blocks/${encodeURIComponent(judgmentId)}/resolve`, {
        jwt: await jwt(), method: 'POST', body: { continuePrompt },
      }) as { ok?: boolean; error?: string };
      // A failed enqueue must NOT close the card — the backend leaves the block
      // open on purpose, and the user needs to see why.
      if (!res || res.ok !== true) { setError((res && res.error) || 'Could not do that. Try again.'); setBusy(null); return; }
      onResolved();
    } catch {
      setError('Could not reach the server. Try again.'); setBusy(null);
    }
  }

  // The primary button ALWAYS continues. For a prerequisite (grant/sign-in) an
  // empty box still resumes via resumePrompt — it must never queue nothing.
  const canContinue = ui.requireText ? !!fix.trim() : true;
  const onContinue = () => resolve(fix.trim() || ui.resumePrompt, 'continue');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation" onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="judge-review-title"
        className="card max-w-lg w-full max-h-[85vh] overflow-y-auto focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="judge-review-title" className="text-sm font-semibold text-ink-50">{who}</h2>
              <span className="text-[10px] uppercase tracking-wide rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-orange-300">Implexa Judge</span>
            </div>
            <p className="text-xs text-ink-400 mt-0.5">Implexa Judge found something that needs your attention.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-500 hover:text-ink-300 text-lg leading-none flex-none">×</button>
        </div>

        <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/50 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">What happened</div>
          <p className="text-sm text-ink-200 whitespace-pre-wrap">{item.whatHappened}</p>
        </div>

        {item.actionDetail && (
          <div className="mt-2 rounded-lg border border-ink-800 bg-ink-950/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Best next step</div>
            <p className="text-xs text-ink-300 whitespace-pre-wrap">{item.actionDetail}</p>
          </div>
        )}

        <label className="block mt-3">
          <span className="text-[10px] uppercase tracking-wide text-ink-500">
            {item.requiredAction === 'provide_information' ? 'Your answer — it continues with this' : 'What to tell it next (edit if needed)'}
          </span>
          <textarea
            value={fix}
            onChange={(e) => setFix(e.target.value)}
            rows={4}
            placeholder={item.requiredAction === 'provide_information' ? 'Tell it exactly what it needs to continue…' : 'Add anything it should know before continuing…'}
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950/70 px-3 py-2 text-sm text-ink-100 focus:border-brand-500 focus:outline-none"
          />
        </label>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null || !canContinue}
            onClick={onContinue}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
          >
            {busy === 'continue' ? 'Continuing…' : ui.primaryLabel}
          </button>
          {/* Null-continuation close is offered ONLY for review_result — a
              judgement call the user actually completed, not a prerequisite. */}
          {ui.allowClose && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => resolve(null, 'close')}
              title="You reviewed this and there's nothing to re-run — just close it."
              className="btn-outline text-sm px-3 py-2 disabled:opacity-50"
            >
              {busy === 'close' ? 'Closing…' : 'I reviewed this — close'}
            </button>
          )}
          <Link href={item.runId ? `/runs/${item.runId}` : '/connections'} className="text-xs text-ink-500 hover:text-ink-300 underline ml-auto">View run</Link>
        </div>

        <div className="mt-4 pt-3 border-t border-ink-800">
          <JudgeFeedbackControls judgmentId={judgmentId} initial={feedback} onSaved={onFeedbackSaved} />
        </div>
      </div>
    </div>
  );
}
