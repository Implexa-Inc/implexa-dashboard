/**
 * <RunVerificationBadge /> — the Completion Controller's verdict for a run
 * (migration 0102, skill_runs.verification_status). A DIFFERENT axis from
 * <RunStateBadge>: that one says whether the run is running/done/failed
 * (liveness); this one says whether it actually PRODUCED its deliverable, and
 * with what confidence — from server-side DETERMINISTIC evidence (its real exit
 * code, its output artifact), NOT a model grading the prose. That distinction is
 * the founder-locked stance and it lives in the tooltip copy verbatim.
 *
 * LABEL IS "Delivered", NOT "Verified" (2026-07-21 fix). A real run showed
 * "Verified" on this badge at the same time Implexa Judge's own verdict was
 * `uncertain` — plain "Verified" reads as "Judge approved this", but this badge
 * has never meant that; it means the deliverable EXISTS, a narrower and
 * different claim. Renaming removes the collision instead of asking the user to
 * reconcile two badges that sound like they disagree. The Judge verdict is a
 * separate card (see RunJudgmentCard) precisely so the two claims never merge
 * into one word.
 *
 * Only the three post-completion verdicts render here:
 *   verified_complete       → green "Delivered"  (evidence the deliverable exists)
 *   incomplete_recoverable  → amber "May be incomplete" (force-closed / no finish signal)
 *   complete_unverified     → muted "Unverified" (delivered, but can't be confirmed)
 * A 'failed' verification is intentionally NOT rendered — <RunStateBadge> already
 * shows "Failed", and a second red chip would just be noise. NULL (not yet
 * verified) renders nothing.
 */

export type VerificationStatus =
  | 'verified_complete'
  | 'complete_unverified'
  | 'incomplete_recoverable'
  | 'failed'
  | 'blocked_permission'
  | 'blocked_user_action'
  | 'exhausted_paths'
  | 'cancelled'
  | null;

const SPEC: Record<string, { label: string; classes: string; dot: string; tip: string; icon?: 'check' }> = {
  verified_complete: {
    label: 'Delivered',
    icon: 'check',
    classes: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/25',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
    tip: 'Implexa confirmed this run produced its deliverable — checked from the run’s own output and exit, not a model’s opinion of the text. This is separate from Implexa Judge review, shown in its own card below.',
  },
  incomplete_recoverable: {
    label: 'May be incomplete',
    classes: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/25',
    dot: 'bg-amber-500 dark:bg-amber-400',
    tip: 'This run was force-closed or exited without signalling it finished, so we can’t confirm it completed the job. It’s safe to run it again.',
  },
  complete_unverified: {
    label: 'Unverified',
    classes: 'bg-ink-500/12 text-ink-400 ring-1 ring-inset ring-ink-500/20',
    dot: 'bg-ink-500',
    tip: 'Delivered, but this agent’s real success (a published URL, a sent message, a saved record) can’t be confirmed from the output alone.',
  },
};

export function RunVerificationBadge({
  status,
  size = 'sm',
}: {
  status: VerificationStatus;
  size?: 'sm' | 'xs';
}) {
  if (!status) return null;
  const spec = SPEC[status];
  if (!spec) return null; // failed + blocked_* are covered by the state badge / action surfaces
  const pad = size === 'xs' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  return (
    <span
      title={spec.tip}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${pad} ${spec.classes}`}
    >
      {spec.icon === 'check' ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M2.5 6.5l2.5 2.5 4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${spec.dot}`} aria-hidden="true" />
      )}
      {spec.label}
    </span>
  );
}
