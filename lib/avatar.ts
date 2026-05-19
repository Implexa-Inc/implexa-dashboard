/**
 * Deterministic avatar color + fallback handle.
 *
 * Single source of truth for "what color is user X's avatar circle." Used by
 * CreatorBadge (skill detail page, share preview) and the leaderboard row.
 * Stability matters — a user should look the same everywhere they appear,
 * so the algorithm is pure (seed → bucket) and shared across surfaces.
 */

export const AVATAR_PALETTE = [
  'bg-brand-500',
  'bg-success-400',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-fuchsia-500',
];

export function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

/** When a user has no display_name, render `user-abc12345` from their uuid. */
export function handleFallback(userId: string): string {
  return `user-${userId.replace(/-/g, '').slice(0, 8)}`;
}
