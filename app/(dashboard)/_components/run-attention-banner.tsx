/**
 * <RunAttentionBanner /> - the loud, impossible-to-miss surface for runs that
 * need a look: STALLED runs and permission-blocked FAILURES. This is the direct
 * fix for the 2026-06-08 trap, where a scheduled agent stalled on a permission
 * prompt and the founder assumed success for an hour. Silence must never read as
 * success, so a stuck run gets a prominent banner at the top of Home and Results
 * with the reason and the one-tap fix, not a quiet dot in a list.
 *
 * Renders nothing when nothing needs attention (the calm common case). Pure
 * presentational server component.
 */

import Link from 'next/link';
import type { RunStateInfo } from '@/lib/run-state';

export type AttentionItem = {
  id: string;
  name: string;
  info: RunStateInfo;
  ran_at: string;
};

function rel(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function RunAttentionBanner({ items }: { items: AttentionItem[] }) {
  const attention = items.filter((it) => it.info.attention);
  if (attention.length === 0) return null;

  const anyStalled = attention.some((it) => it.info.state === 'stalled');
  // A stall is the louder, time-sensitive case (a run hung right now); a blocked
  // failure already finished. Lead with the louder tint when a stall is present.
  const tint = anyStalled
    ? 'border-amber-500/40 bg-amber-500/10'
    : 'border-rose-500/40 bg-rose-500/10';
  const heading = anyStalled
    ? `${attention.length} run${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} a look`
    : `${attention.length} run${attention.length === 1 ? '' : 's'} blocked on a permission`;

  return (
    <section
      className={`rounded-lg border ${tint} p-4 mb-8`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="text-base leading-none" aria-hidden="true">{anyStalled ? '⏳' : '⚠'}</span>
        <h2 className="text-sm font-semibold text-ink-50">{heading}</h2>
      </div>
      <p className="text-xs text-ink-300 mt-1">
        These did not finish cleanly. Silence is not success, here is exactly what happened.
      </p>
      <ul className="mt-3 space-y-2">
        {attention.map((it) => (
          <li key={it.id} className="flex items-start justify-between gap-3">
            <Link
              href={`/runs/${it.id}`}
              className="min-w-0 group"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink-100 truncate group-hover:text-ink-50">{it.name}</span>
                <span className="text-[11px] uppercase tracking-wide text-ink-400">{it.info.label}</span>
              </div>
              <p className="text-xs text-ink-300 mt-0.5 line-clamp-2">{it.info.reason}</p>
            </Link>
            <span className="text-[11px] text-ink-500 flex-none mt-0.5">{rel(it.ran_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
