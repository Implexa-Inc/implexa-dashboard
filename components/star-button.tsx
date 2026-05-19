'use client';

/**
 * Star button — click-to-like signal for skills. Sits on:
 *   • /skills/[slug]         (creator + viewer view, always authed)
 *   • /s/[token]             (public share preview, sometimes unauthed)
 *
 * Optimistic UI: click flips the local state before the POST round-trips,
 * then rolls back on error. The backend POST is idempotent (toggle), so
 * even if the same user double-clicks during a slow network, the server
 * settles on the user's intended state — local rollback only fires on a
 * real error response.
 *
 * Unauthed viewers (no jwt prop) see the count and an outline star, but
 * the button is non-interactive and the title hints "Sign in to star".
 * The /s/[token] header already has the Sign in / Sign up link, so we
 * intentionally don't add another redirect here — keeping the install
 * CTA as the primary call to action on the share preview.
 */

import { useState, useTransition } from 'react';
import { callBackend } from '@/lib/api';

type Props = {
  /** Skill UUID. The route is /api/v2/skills/:id/star (id, not slug). */
  skillId:        string;
  /** Initial starred state for this viewer. Pre-computed server-side so
   * we paint the right state on first render (no flicker). */
  initialStarred: boolean;
  /** Initial aggregate count from org_skills.star_count. */
  initialCount:   number;
  /** Supabase JWT for the authenticated POST. Pass null/undefined for
   * unauthed viewers — the button renders as a non-interactive preview. */
  jwt?:           string | null;
  /** Visual scale. `sm` is for list rows; `md` is the page-header default. */
  size?:          'sm' | 'md';
};

export function StarButton({ skillId, initialStarred, initialCount, jwt, size = 'md' }: Props) {
  const [starred,  setStarred]  = useState(initialStarred);
  const [count,    setCount]    = useState(initialCount);
  const [isPending, startTransition] = useTransition();
  const [error,    setError]    = useState<string | null>(null);

  const authed = !!jwt;

  // Visual sizing tokens — keep both variants on a single rhythm.
  const padding   = size === 'sm' ? 'px-2 py-1'     : 'px-2.5 py-1.5';
  const textSize  = size === 'sm' ? 'text-xs'       : 'text-sm';
  const iconSize  = size === 'sm' ? 'h-3.5 w-3.5'   : 'h-4 w-4';

  async function toggle() {
    if (!authed || isPending) return;

    // ─── Optimistic flip ─────────────────────────────────────────────────
    // Mirror what the server will return when starred=!current. Count moves
    // by ±1. Rolled back below if the POST errors.
    const prevStarred = starred;
    const prevCount   = count;
    const nextStarred = !starred;
    const nextCount   = Math.max(0, count + (nextStarred ? 1 : -1));
    setStarred(nextStarred);
    setCount(nextCount);
    setError(null);

    startTransition(async () => {
      try {
        // Server is the source of truth — overwrite local with the returned
        // values rather than trusting our optimistic estimate. Handles edge
        // cases like concurrent stars from another tab.
        const res = await callBackend(`/api/v2/skills/${skillId}/star`, { jwt, method: 'POST' });
        if (typeof res?.starCount === 'number') setCount(res.starCount);
        if (typeof res?.starred   === 'boolean') setStarred(res.starred);
      } catch (err: any) {
        setStarred(prevStarred);
        setCount(prevCount);
        setError(err?.message || 'Failed to star');
      }
    });
  }

  // Tooltip — different copy for authed/unauthed so the affordance is clear.
  const title = !authed
    ? 'Sign in to star'
    : starred
      ? 'Unstar'
      : 'Star this skill';

  // ClawHub-style: outline when not starred, filled amber when starred.
  // We render the same <svg> with a conditional fill so the layout stays
  // pixel-stable across the state flip (no shift from icon swap).
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!authed || isPending}
      title={title}
      aria-pressed={starred}
      aria-label={`${starred ? 'Unstar' : 'Star'} skill (${count} ${count === 1 ? 'star' : 'stars'})`}
      className={[
        'inline-flex items-center gap-1.5 rounded-md border tabular-nums',
        'border-ink-700 bg-ink-900/40 hover:bg-ink-800 active:bg-ink-800',
        'disabled:cursor-not-allowed disabled:opacity-80',
        starred ? 'text-amber-500' : 'text-ink-200',
        padding, textSize,
        'transition-colors',
      ].join(' ')}
    >
      <svg
        viewBox="0 0 24 24"
        className={iconSize}
        fill={starred ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2.5l2.95 6.0 6.6.95-4.78 4.66 1.13 6.57L12 17.6l-5.9 3.1 1.13-6.57L2.45 9.45l6.6-.95L12 2.5z" />
      </svg>
      <span className="font-medium">{starred ? 'Starred' : 'Star'}</span>
      <span className="text-ink-400">{count}</span>
      {error && (
        // Subtle inline error — the button itself is the primary UI and we
        // don't want a layout shift. Screen readers pick it up via aria-live.
        <span className="sr-only" role="alert" aria-live="polite">{error}</span>
      )}
    </button>
  );
}
