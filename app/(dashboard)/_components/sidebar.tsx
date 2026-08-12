'use client';

/**
 * The dashboard shell's navigation — desktop sidebar + narrow-viewport top bar.
 *
 * Both surfaces render THE SAME model from `lib/navigation` (Agents · Work ·
 * Training, with Settings secondary). They used to disagree: the sidebar held a
 * hand-maintained list of fourteen items with a `hidden` flag on eleven of them,
 * and the mobile bar held the logo and a plan chip with NO navigation at all —
 * so on a phone there was no way to reach any other domain.
 *
 * What changed, and why (DESIGN.md §4.1, §11.1):
 *   - Home and Review left primary navigation. Home owned no unique object;
 *     Review is a filter and a count inside Work. Both routes still resolve.
 *   - The logo points at the state-aware default landing (`/start`), not Home.
 *   - The eleven `hidden` entries are gone from the model rather than carried
 *     as dead rows; every one of their routes is either owned by a domain (so
 *     it lights that domain up) or redirected.
 *   - "Switch account" was removed. It submitted the same sign-out form as
 *     "Sign out", so the label described something the product does not do.
 *   - Selected state is announced (`aria-current="page"`), not just coloured,
 *     and every interactive element has a visible focus ring.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { STATUS_PRESENTATION, relativeFromNow, type SetupStatus } from '@/lib/setup-status';
import {
  PRIMARY_NAV, SECONDARY_NAV, isNavItemActive, countNewerThan, mergeTimestamps, workSeenKey,
  type NavItem,
} from '@/lib/navigation';

type UserCtx = {
  /** Account id — scopes the per-device "last opened Work" marker. */
  id?:         string | null;
  displayName: string | null;
  email:       string;
  plan:        'free' | 'pro' | 'enterprise' | string;
  isFoundingCreator: boolean;
  /** Derived setup status — drives the chip below the user block. */
  setupStatus?: SetupStatus;
  /** ISO timestamp of last MCP/hook activity (for "last seen 3 min ago" tooltip). */
  lastSeenAt?:  string | null;
  /** True when caller email is in NEXT_PUBLIC_ADMIN_EMAILS — shows the /admin nav link. */
  isAdmin?:     boolean;
};

/**
 * Focus ring shared by every interactive element in the shell. Keyboard-only
 * (`focus-visible`) so a mouse click does not leave a ring behind, and offset
 * against the sidebar's own background so it is visible on the active row too.
 */
const FOCUS_RING =
  'focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900';

/**
 * A glanceable "new since you last opened Work" count.
 *
 * DELIBERATELY NOT the unresolved-review count. Visiting a page does not resolve
 * anything, so a seen-based badge would clear itself while the work remained —
 * which is exactly why the old Review entry shipped with no badge at all. The
 * real unresolved-decision count lives inside Work, on the Ready-for-review
 * filter, where it is read from the review queue and cannot self-clear.
 *
 * ISO timestamps are compared as epoch millis so a timezone-suffix format
 * ("+00:00" vs "Z") can't skew the result.
 */
function useUnreadBadge(timestamps: string[], pathname: string, ownedPrefix: string, seenKey: string | null): number {
  const [seenMs, setSeenMs] = useState<number | null>(null);
  const onPage = pathname === ownedPrefix || pathname.startsWith(`${ownedPrefix}/`);

  useEffect(() => {
    if (!seenKey) return;            // no account to scope by → no badge at all
    try {
      const v = window.localStorage.getItem(seenKey);
      setSeenMs(v ? Number(v) : 0);   // no marker → everything counts as new
    } catch { setSeenMs(0); }
  }, [seenKey]);

  useEffect(() => {
    if (!onPage || !seenKey) return;
    const now = Date.now();
    try { window.localStorage.setItem(seenKey, String(now)); } catch { /* private mode */ }
    setSeenMs(now);
  }, [onPage, seenKey]);

  if (seenMs === null) return 0;   // pre-hydration: render no badge (SSR-safe)
  if (onPage) return 0;
  return countNewerThan(timestamps, seenMs);
}

/** Everything both shell surfaces need to render one nav row. */
function useShellNav(user: UserCtx, resultRunsAt: string[], needsItemsAt: string[]) {
  const pathname = usePathname() || '';
  // Work's badge spans BOTH facts it owns: results delivered and items that
  // stalled or are waiting on a decision. One domain, one count — merged rather
  // than concatenated, because the two server queries read the same table and
  // the needs-you rows are mostly a subset of the results rows.
  //
  // The marker is SCOPED TO THE ACCOUNT. This device genuinely runs more than
  // one Implexa account (that is what the old "Switch account" control was
  // for), and an unscoped key hands the second account the first one's
  // last-opened time — suppressing a badge for work it has never seen.
  const workUnread = useUnreadBadge(
    mergeTimestamps(needsItemsAt, resultRunsAt), pathname, '/work', workSeenKey(user.id),
  );
  const badgeFor = (item: NavItem) => (item.badgeKey === 'work' ? workUnread : 0);
  return { pathname, badgeFor };
}

export default function Sidebar({ user, resultRunsAt = [], needsItemsAt = [] }: { user: UserCtx; resultRunsAt?: string[]; needsItemsAt?: string[] }) {
  const { pathname, badgeFor } = useShellNav(user, resultRunsAt, needsItemsAt);

  return (
    <aside className="hidden md:flex md:flex-col md:sticky md:top-0 w-56 shrink-0 border-r border-ink-700 bg-ink-900/50 h-screen overflow-y-auto">
      {/* Brand — resolves to the state-aware default landing (Work when
       * something needs you or is running, otherwise Agents), never to a Home
       * page of its own. */}
      <div className="px-4 pt-6 pb-8">
        <Link href="/start" className={`inline-flex items-center gap-2 rounded-md text-ink-50 ${FOCUS_RING}`}>
          <LogoMark size={28} />
          <span className="text-sm font-medium">Implexa</span>
        </Link>
      </div>

      <nav className="px-2 flex-1" aria-label="Primary">
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => (
            <li key={item.id}>
              <NavLink item={item} active={isNavItemActive(item, pathname)} badge={badgeFor(item)} />
            </li>
          ))}
        </ul>

        <div id="shell-account-nav" className="mt-8 px-3 mb-2 text-[10px] uppercase tracking-wider text-ink-500 font-medium">
          Account
        </div>
        <ul className="space-y-0.5" aria-labelledby="shell-account-nav">
          {SECONDARY_NAV.map((item) => (
            <li key={item.id}>
              <NavLink item={item} active={isNavItemActive(item, pathname)} />
            </li>
          ))}
        </ul>

        {/* Admin section — only shown for users in ADMIN_EMAILS env var.
         * Internal use only (founder dashboard for launch monitoring). */}
        {user.isAdmin && (
          <>
            <div id="shell-internal-nav" className="mt-8 px-3 mb-2 text-[10px] uppercase tracking-wider text-ink-500 font-medium">
              Internal
            </div>
            <ul className="space-y-0.5" aria-labelledby="shell-internal-nav">
              <li>
                <NavLink
                  item={{ id: 'settings', href: '/admin', label: 'Admin', icon: 'analytics', owns: ['/admin'] }}
                  active={pathname === '/admin' || pathname.startsWith('/admin/')}
                />
              </li>
            </ul>
          </>
        )}
      </nav>

      {/* User block at bottom */}
      <div className="px-3 py-4 border-t border-ink-700">
        <div className="text-sm text-ink-100 font-medium truncate" title={user.displayName || user.email}>
          {user.displayName || user.email.split('@')[0]}
        </div>
        <div className="text-[11px] text-ink-400 truncate" title={user.email}>{user.email}</div>
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {/* Plan badge — for Free we say "Free plan", for paid plans we just
           * say the name (no redundant "Pro plan"). Founding Creators get a
           * special green badge instead of the plain plan label since their
           * status is more meaningful than their org's plan. */}
          {user.isFoundingCreator ? (
            <span
              title="Founding Creator — Pro is free for life on your account"
              className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-success-400/20 text-success-700 dark:text-success-400"
            >
              🏆 Founding Creator
            </span>
          ) : (
            <span className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 font-medium ${
              user.plan === 'pro' || user.plan === 'enterprise'
                ? 'bg-brand-500/20 text-brand-600 dark:text-brand-500'
                : 'bg-ink-800 text-ink-300'
            }`}>
              {user.plan === 'pro' ? 'Pro' : user.plan === 'enterprise' ? 'Enterprise' : 'Free plan'}
            </span>
          )}
        </div>
        {/* Setup-status chip — tells users at a glance whether their Claude
         * is actually wired up to Implexa. 'never' is clickable → /install
         * because that's the failure mode that needs action. */}
        <SetupChip status={user.setupStatus} lastSeenAt={user.lastSeenAt} />
        {/* Sign out only. "Switch account" sat here and POSTed to the SAME
         * /auth/signout form — the label promised an account chooser the
         * product does not have (DESIGN.md §11.1: implement a real chooser or
         * remove it). */}
        <div className="mt-3">
          <form action="/auth/signout" method="POST">
            <button className={`rounded text-[11px] text-ink-300 hover:text-ink-50 hover:underline ${FOCUS_RING}`}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function SetupChip({ status, lastSeenAt }: { status?: SetupStatus; lastSeenAt?: string | null }) {
  const effective = status || 'never';
  const spec = STATUS_PRESENTATION[effective];
  const seen = lastSeenAt ? `Last seen ${relativeFromNow(lastSeenAt)}` : null;
  const tooltip = seen ? `${spec.tooltip} (${seen})` : spec.tooltip;

  // Only the "not connected" state is a CTA — others are passive indicators.
  const isCta = effective === 'never';
  const inner = (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-ink-300">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${spec.dot} animate-pulse`} aria-hidden="true" />
      <span>{spec.label}</span>
    </span>
  );

  return (
    <div className="mt-2" title={tooltip}>
      {isCta ? (
        <Link href="/install" className={`inline-flex items-center rounded hover:underline ${FOCUS_RING}`}>
          {inner}
        </Link>
      ) : inner}
    </div>
  );
}

function NavIcon({ icon }: { icon: string }) {
  /* SVG icon via CSS mask-image — gives us currentColor inheritance.
   *
   * Why not <Image src=...>? Next.js Image renders the SVG inside an <img>
   * tag, which isolates it from the parent's CSS context — so the
   * `stroke="currentColor"` in our brand SVGs falls back to black and the
   * icons disappear on the dark sidebar bg.
   *
   * Mask-image solves this: the SVG becomes a stencil and bg-current paints
   * it the parent's text color. Trade-off: any internal `fill=` accents in
   * the source SVG (e.g. the small flame dot in skills.svg) become part of
   * the stencil — they don't render as a separate accent color. Acceptable
   * for tiny 18px nav icons; switch to inline SVGR if we ever need
   * multi-color icons in nav. */
  return (
    <span
      aria-hidden="true"
      className="block w-[18px] h-[18px] shrink-0 bg-current"
      style={{
        maskImage: `url(/icons/${icon}.svg)`,
        WebkitMaskImage: `url(/icons/${icon}.svg)`,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  );
}

function NavBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold bg-brand-500 text-ink-950"
      aria-label={`${count} new in ${label}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function NavLink({ item, active, badge = 0 }: { item: NavItem; active: boolean; badge?: number }) {
  return (
    <Link
      href={item.href}
      // The selected row is announced, not merely tinted. DESIGN.md §13.1
      // forbids carrying meaning in colour alone; `aria-current` is how the
      // same fact reaches a screen reader and a Windows high-contrast theme.
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${FOCUS_RING} ${
        active
          ? 'bg-brand-500/10 text-ink-50 font-medium border-l-2 border-brand-500'
          : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100 border-l-2 border-transparent'
      }`}
    >
      <NavIcon icon={item.icon} />
      <span>{item.label}</span>
      <NavBadge count={badge} label={item.label} />
    </Link>
  );
}

/**
 * Narrow-viewport navigation. The sidebar is `hidden md:flex`, so below `md`
 * this bar is the ONLY way to change domain — it previously rendered the logo
 * and a plan chip and nothing else, which stranded phone users on whatever page
 * they landed on.
 *
 * Same model, same active rule, same `aria-current`; laid out as a horizontally
 * scrollable row so three labels plus a badge never overflow a 320px screen.
 */
export function MobileTopBar({ user, resultRunsAt = [], needsItemsAt = [] }: { user: UserCtx; resultRunsAt?: string[]; needsItemsAt?: string[] }) {
  const { pathname, badgeFor } = useShellNav(user, resultRunsAt, needsItemsAt);

  return (
    <div className="md:hidden sticky top-0 z-20 bg-ink-900 border-b border-ink-700">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <Link href="/start" className={`inline-flex items-center gap-2 rounded-md text-ink-50 ${FOCUS_RING}`}>
          <LogoMark size={24} />
          <span className="text-sm font-medium">Implexa</span>
        </Link>
        <div className="flex items-center gap-2 text-xs">
          <span className="capitalize text-ink-300">{user.plan}</span>
          {user.isFoundingCreator && <span title="Founding Creator">🏆</span>}
        </div>
      </div>
      <nav aria-label="Primary" className="px-2 pb-2 overflow-x-auto">
        <ul className="flex items-center gap-1 min-w-max">
          {[...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => {
            const active = isNavItemActive(item, pathname);
            const badge = badgeFor(item);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${FOCUS_RING} ${
                    active
                      ? 'bg-brand-500/10 text-ink-50 font-medium border-b-2 border-brand-500'
                      : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100 border-b-2 border-transparent'
                  }`}
                >
                  <NavIcon icon={item.icon} />
                  <span>{item.label}</span>
                  <NavBadge count={badge} label={item.label} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
