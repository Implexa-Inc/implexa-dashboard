import Link from 'next/link';
import { WORK_VIEWS, WORK_VIEW_LABELS, workViewHref, type WorkView } from '@/lib/navigation';

/**
 * Work's three filters (DESIGN.md §8.2): Needs you · Ready for review · Delivered.
 *
 * These are LINKS, not ARIA tabs. A filter changes entry context, not
 * destination ownership (§8.5) — each one is a real URL a notification or a
 * bookmark can point at — so the selected one is marked `aria-current="page"`
 * rather than pretending to be a tab panel it does not control.
 *
 * Only **Ready for review** carries a count, and only when it is knowable. It
 * is the one unresolved-decision count the design asks Work to own (§9.3); the
 * other two would be inventing a number that the surfaces below them already
 * compute for themselves, and two counts that disagree are worse than none.
 * A `null` count renders nothing — never "0", which would claim an all-clear
 * we cannot prove.
 */
export default function WorkFilterTabs({
  current, reviewCount,
}: {
  current: WorkView;
  /** null = we could not read the queue completely. Render no number. */
  reviewCount: number | null;
}) {
  return (
    <nav aria-label="Work filters" className="mb-6 overflow-x-auto">
      <ul className="flex items-center gap-1 min-w-max border-b border-ink-800">
        {WORK_VIEWS.map((view) => {
          const active = view === current;
          const showCount = view === 'review' && reviewCount !== null && reviewCount > 0;
          return (
            <li key={view}>
              <Link
                href={workViewHref(view)}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px flex items-center gap-2 whitespace-nowrap rounded-t-md px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 ${
                  active
                    ? 'border-b-2 border-brand-500 font-medium text-ink-50'
                    : 'border-b-2 border-transparent text-ink-400 hover:text-ink-100'
                }`}
              >
                <span>{WORK_VIEW_LABELS[view]}</span>
                {showCount && (
                  <span
                    className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-ink-950"
                    aria-label={`${reviewCount} waiting for your decision`}
                  >
                    {reviewCount > 99 ? '99+' : reviewCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
