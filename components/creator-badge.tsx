/**
 * Public attribution for a skill's author — initial avatar + display name +
 * "Member since" subline. Used on the /skills/[slug] detail page and the
 * /s/[token] public share preview. Email is NEVER passed in.
 */

type CreatorBadgeProps = {
  displayName: string | null;
  /** ISO string — falls back gracefully when missing. */
  memberSince?: string | null;
  /** Stable id used to derive avatar color + the @handle fallback. */
  userId?: string | null;
  /** Visual scale. `lg` is the under-title hero variant; `sm` is for cards. */
  size?: 'sm' | 'lg';
  /** Creator karma total. Renders an ✨ pill next to the name when > 0. Hidden at 0 / null so brand-new creators don't see a goose-egg. */
  karma?: number | null;
};

const AVATAR_PALETTE = [
  'bg-brand-500',
  'bg-success-400',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-fuchsia-500',
];

function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function handleFallback(userId: string): string {
  return `user-${userId.replace(/-/g, '').slice(0, 8)}`;
}

function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `Member since ${d.toLocaleString('en-US', { month: 'short', year: 'numeric' })}`;
}

export function CreatorBadge({ displayName, memberSince, userId, size = 'lg', karma = null }: CreatorBadgeProps) {
  const name = displayName || (userId ? handleFallback(userId) : 'Anonymous');
  const seed = userId || name;
  const color = pickAvatarColor(seed);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const memberLine = memberSince ? formatMemberSince(memberSince) : null;
  // Hide at 0 / null — brand-new creators shouldn't see a "0 karma" goose-egg
  // next to their name. The pill only appears once they've earned something.
  const showKarma = typeof karma === 'number' && karma > 0;

  const avatarSize = size === 'lg' ? 'h-9 w-9 text-sm' : 'h-6 w-6 text-xs';
  const nameSize   = size === 'lg' ? 'text-sm'        : 'text-xs';

  return (
    <div className="inline-flex items-center gap-2.5" aria-label={`Created by ${name}${showKarma ? `, ${karma} karma` : ''}`}>
      <div
        className={`${avatarSize} ${color} rounded-full flex items-center justify-center font-semibold text-white shrink-0 select-none`}
        aria-hidden="true"
      >
        {initial}
      </div>
      <div className="min-w-0 leading-tight">
        <div className={`${nameSize} text-ink-100 inline-flex items-center gap-1.5 flex-wrap`}>
          <span>
            <span className="text-ink-400">Created by </span>
            <span className="font-medium text-ink-100">{name}</span>
          </span>
          {showKarma && (
            // Karma pill — matches the Founding Creator badge pattern from
            // settings/page.tsx so the visual rhythm stays consistent:
            // translucent amber background, dark amber text in light mode,
            // light amber text in dark mode. Previous styling used
            // text-amber-300 unconditionally, which rendered as ghost-text
            // on light backgrounds.
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-700 dark:text-amber-400 font-semibold tabular-nums leading-none"
              title={`${karma} creator karma earned from installs, forks, and public-share promotions`}
            >
              <span aria-hidden="true">✨ </span>{karma!.toLocaleString()} karma
            </span>
          )}
        </div>
        {memberLine && size === 'lg' && (
          <div className="text-xs text-ink-400 mt-0.5">{memberLine}</div>
        )}
      </div>
    </div>
  );
}
