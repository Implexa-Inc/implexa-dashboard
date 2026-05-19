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

export function CreatorBadge({ displayName, memberSince, userId, size = 'lg' }: CreatorBadgeProps) {
  const name = displayName || (userId ? handleFallback(userId) : 'Anonymous');
  const seed = userId || name;
  const color = pickAvatarColor(seed);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const memberLine = memberSince ? formatMemberSince(memberSince) : null;

  const avatarSize = size === 'lg' ? 'h-9 w-9 text-sm' : 'h-6 w-6 text-xs';
  const nameSize   = size === 'lg' ? 'text-sm'        : 'text-xs';

  return (
    <div className="inline-flex items-center gap-2.5" aria-label={`Created by ${name}`}>
      <div
        className={`${avatarSize} ${color} rounded-full flex items-center justify-center font-semibold text-white shrink-0 select-none`}
        aria-hidden="true"
      >
        {initial}
      </div>
      <div className="min-w-0 leading-tight">
        <div className={`${nameSize} text-ink-100`}>
          <span className="text-ink-400">Created by </span>
          <span className="font-medium text-ink-100">{name}</span>
        </div>
        {memberLine && size === 'lg' && (
          <div className="text-xs text-ink-400 mt-0.5">{memberLine}</div>
        )}
      </div>
    </div>
  );
}
