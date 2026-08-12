import Link from 'next/link';
import {
  reasonLabel, primaryActionLabel, versionSummary, unresolvedIssueLabel,
  reviewQueueWarning, canClaimAllClear, unavailableSources,
  type ReviewQueue,
} from '@/lib/review';

/**
 * The **Ready for review** filter of Work.
 *
 * This is the surface that replaces the old top-level Review entry (DESIGN.md
 * §9.3: "There is no top-level Review navigation entry. Work owns a Ready for
 * review filter and an unresolved-decision count"). It is a LIST ONLY — every
 * row links straight into `/review/[runId]`, which remains the canonical
 * artifact-aware review mode and is untouched by this change. Nothing here
 * decides, resolves, submits, or renders an artifact.
 *
 * The honesty rule it inherits from the queue page: an unreadable source must
 * never render as "nothing to review". The backend reports each source
 * three-valued and returns a null issue count when it could not count, so the
 * warning is rendered ABOVE the list and the empty state distinguishes "nothing
 * is waiting" from "we could not look".
 */
export default function ReadyForReviewList({
  queue, nameBySlug,
}: {
  queue: ReviewQueue;
  nameBySlug: Map<string, string>;
}) {
  const warning = reviewQueueWarning(queue);
  const allClear = canClaimAllClear(queue);
  const broken = unavailableSources(queue.sources);

  return (
    <section aria-label="Ready for review">
      {warning && (
        <div
          role="status"
          className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          <p>{warning}</p>
          {broken.length > 0 && (
            <p className="mt-1 text-xs text-amber-200/70">
              Could not read: {broken.join(', ')}.
            </p>
          )}
        </div>
      )}

      {queue.items.length === 0 && (
        allClear ? (
          <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-10 text-center">
            <p className="text-sm text-ink-300">Nothing is waiting for your review.</p>
            <p className="mt-1 text-xs text-ink-500">
              New results appear here when an agent delivers something.
            </p>
          </div>
        ) : (
          // NOT an all-clear: we could not see everything, so we say so instead
          // of implying the queue is empty.
          <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-10 text-center">
            <p className="text-sm text-ink-300">We can&apos;t show your review queue right now.</p>
            <p className="mt-1 text-xs text-ink-500">This is not the same as having nothing to review.</p>
          </div>
        )
      )}

      <ul className="space-y-3">
        {queue.items.map((item) => {
          const name = (item.slug ? nameBySlug.get(item.slug) : null) || item.slug || 'Unnamed agent';
          const isApproval = item.reason === 'approval' || item.holdKind === 'approval_before_action';
          return (
            <li
              key={item.rootRunId}
              className="rounded-lg border border-ink-800 bg-ink-900/40 p-4 transition-colors hover:border-ink-700"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* Agent name leads. Run/revision text is secondary context. */}
                  <h3 className="truncate text-base font-medium text-ink-100">{name}</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
                    <span
                      className={
                        isApproval
                          ? 'rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300'
                          : item.reason.startsWith('judge')
                            ? 'rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300'
                            : 'rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300'
                      }
                    >
                      {reasonLabel(item.reason)}
                    </span>
                    <span>{versionSummary(item)}</span>
                    <span aria-hidden>·</span>
                    <span>{unresolvedIssueLabel(item.unresolvedIssueCount)}</span>
                    {item.judgeVerdict && (
                      <>
                        <span aria-hidden>·</span>
                        {/* Judge is a MACHINE opinion, labelled as such — never merged
                            with the human review state or with verification. */}
                        <span>Judge: {item.judgeVerdict}</span>
                      </>
                    )}
                  </p>
                </div>

                <Link
                  href={`/review/${item.latestRunId}`}
                  className="shrink-0 rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-white focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
                >
                  {primaryActionLabel(item)}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      {queue.truncated && queue.items.length > 0 && (
        <p className="mt-4 text-xs text-ink-500">
          Showing {queue.visibleCount}
          {typeof queue.total === 'number' ? ` of ${queue.total}` : ''}. There is more review work than fits here.
        </p>
      )}
    </section>
  );
}
