/**
 * <ConnectionAttentionBanner /> - the loud, impossible-to-miss surface for
 * agents that need an account which is not reachable in the Implexa browser.
 * Sibling to <RunAttentionBanner />: same shape, same calm-when-nothing voice.
 *
 * This is the direct fix for the activation trap (live email-agent test,
 * 2026-06-08): an agent that needs a second inbox silently degrades when that
 * inbox is signed out. Silence must never read as success, so a broken
 * connection gets a prominent banner with the reason and a one-tap sign-in, not
 * a quiet red dot buried in a list.
 *
 * Renders nothing when nothing is broken (the calm common case). Used both
 * globally (the Connections page, and reusable on Home) and scoped to a single
 * agent (the agent detail page). Pure presentational server component.
 */

import Link from 'next/link';
import type { ConnectionWarning } from '@/lib/connections';
import { RECONNECT_HREF } from '@/lib/connections';

function rel(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ConnectionAttentionBanner({
  warnings,
  /** 'agent' drops the per-row agent name (the page is already about that agent). */
  scope = 'global',
  className = '',
}: {
  warnings: ConnectionWarning[];
  scope?: 'global' | 'agent';
  className?: string;
}) {
  if (warnings.length === 0) return null;

  const heading =
    scope === 'agent'
      ? `This agent needs ${warnings.length} account${warnings.length === 1 ? '' : 's'} you are signed out of`
      : `${warnings.length} connection${warnings.length === 1 ? '' : 's'} need${warnings.length === 1 ? 's' : ''} a sign-in`;

  return (
    <section
      className={`rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="text-base leading-none" aria-hidden="true">⚠</span>
        <h2 className="text-sm font-semibold text-ink-50">{heading}</h2>
      </div>
      <p className="text-xs text-ink-300 mt-1">
        Your agents run as you in the Implexa browser. These accounts are signed out or unreachable, so anything that needs them cannot run. Sign in once to fix it.
      </p>
      <ul className="mt-3 space-y-2">
        {warnings.map((w, i) => (
          <li key={`${w.agent_slug}-${w.domain}-${i}`} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-ink-100 truncate">{w.label}</span>
                {scope === 'global' && (
                  <Link
                    href={`/workflows/${w.agent_slug}`}
                    className="text-[11px] uppercase tracking-wide text-ink-400 hover:text-ink-200"
                  >
                    {w.agent_name}
                  </Link>
                )}
              </div>
              <p className="text-xs text-ink-300 mt-0.5 line-clamp-2">{w.reason}</p>
            </div>
            <div className="flex items-center gap-2 flex-none">
              {w.detected_at && <span className="text-[11px] text-ink-500 mt-0.5">{rel(w.detected_at)}</span>}
              <Link
                href={RECONNECT_HREF}
                className="text-xs font-medium rounded-md px-2.5 py-1 bg-rose-500/20 text-rose-700 dark:text-rose-200 hover:bg-rose-500/30 transition-colors whitespace-nowrap"
              >
                Sign in
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
