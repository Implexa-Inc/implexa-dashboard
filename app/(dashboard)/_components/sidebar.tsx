'use client';

/** Shared desktop/sidebar and narrow top-bar navigation. */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo';
import { STATUS_PRESENTATION, relativeFromNow, type SetupStatus } from '@/lib/setup-status';
import {
  primaryNavigation, SECONDARY_NAV, isNavItemActive,
  type NavItem, type ShellNavigationState, type WorkAttentionBadge,
} from '@/lib/navigation';

import ThemeControl from '@/components/theme-control';

type UserCtx = {
  themeClock?: boolean;
  marketplacePilot?: boolean;
  /** Account id scopes background navigation state. */
  id?:         string | null;
  canTrain?: boolean;
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

const ShellState = createContext<ShellNavigationState | undefined>(undefined);

/** One read for both surfaces after paint, with throttled focus/periodic refresh. */
export function ShellNavigationProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, setState] = useState<ShellNavigationState>();
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let inFlight = false;
    let lastRead = 0;
    const roleKey = `tukido.coach-navigation:${userId}`;
    try {
      const known = window.localStorage.getItem(roleKey);
      const checkedAt = Number(window.localStorage.getItem(`${roleKey}:checked-at`));
      if (known === 'true' || (known === 'false' && Date.now() - checkedAt < 30_000)) {
        setState((previous) => ({ canTrain: known === 'true', work: previous?.work }));
      }
    } catch { /* A blocked storage area does not block navigation. */ }
    async function refresh() {
      if (inFlight || document.visibilityState === 'hidden' || Date.now() - lastRead < 15_000) return;
      lastRead = Date.now();
      inFlight = true;
      try {
        const res = await fetch('/api/shell-navigation', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
        const body = res.ok ? await res.json() : null;
        const work = body?.work;
        const valid = body?.ok === true && [true, false, null].includes(body.canTrain)
          && (work === null || (Number.isSafeInteger(work?.count) && work.count >= 0 && typeof work.complete === 'boolean'));
        if (active) {
          if (valid && typeof body.canTrain === 'boolean') {
            try {
              window.localStorage.setItem(roleKey, String(body.canTrain));
              window.localStorage.setItem(`${roleKey}:checked-at`, String(Date.now()));
            } catch { /* UI hint only, never authorization */ }
          }
          setState((previous) => valid
            ? { canTrain: body.canTrain ?? previous?.canTrain ?? null, work }
            : { canTrain: previous?.canTrain ?? null, work: null });
        }
      } catch {
        if (active) setState((previous) => ({ canTrain: previous?.canTrain ?? null, work: null }));
      } finally { inFlight = false; }
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const timer = window.setInterval(onFocus, 60_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [userId]);
  // Navigation remounts do not create another read; the provider belongs to the
  // persistent layout. Focus/periodic checks refresh decisions with a minimum gap.
  return <ShellState.Provider value={state}>{children}</ShellState.Provider>;
}

function useShellNav(user: UserCtx) {
  const pathname = usePathname() || '';
  const state = useContext(ShellState);
  const onCoach = pathname === '/training' || pathname.startsWith('/training/');
  // A failed first read is unknown, not proof this person cannot train.
  const canTrain = onCoach || (user.canTrain ?? (state ? state.canTrain !== false : false));
  const items = primaryNavigation(user.marketplacePilot, canTrain);
  return { pathname, items, work: state?.work };
}

export default function Sidebar({ user }: { user: UserCtx }) {
  const { pathname, items, work } = useShellNav(user);

  return (
    <aside className="hidden md:flex md:flex-col md:sticky md:top-0 app-sidebar shrink-0 h-screen overflow-y-auto">
      {/* Brand — resolves to the state-aware default landing (Work when
       * something needs you or is running, otherwise Agents), never to a Home
       * page of its own. */}
      <div className="app-sidebar-brand">
        <Link href="/start" className={`flex items-center gap-2 rounded-md text-ink-50 ${FOCUS_RING}`}>
          <Logo height={24} />
        </Link>
      </div>

      <nav className="app-sidebar-primary" aria-label="Primary">
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <NavLink item={item} active={isNavItemActive(item, pathname)} badge={item.badgeKey === 'work' ? work : undefined} />
            </li>
          ))}
        </ul>

      </nav>
      <div className="app-sidebar-divider" />
      <nav aria-label="Settings and account">
        <ul className="space-y-0.5">
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

      <div className="app-sidebar-footer">
        <ThemeControl enabled={user.themeClock} />
        <SetupChip status={user.setupStatus} lastSeenAt={user.lastSeenAt} />
        <div className="app-sidebar-me">
          <span className="app-sidebar-avatar" aria-hidden="true">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0">
            <div className="app-sidebar-name truncate" title={user.displayName || user.email}>
              {user.displayName || user.email.split('@')[0]}
            </div>
            <div className="text-[11px] text-ink-400 truncate" title={user.email}>{user.email}</div>
            <div className="text-xs text-ink-400">
              {user.isFoundingCreator ? <span title="Founding Creator — Pro is free for life on your account" className="inline-block text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-success-400/20 text-success-700 dark:text-success-400">Founding creator</span>
                : user.plan === 'pro' ? 'Pro' : user.plan === 'enterprise' ? 'Enterprise' : 'Free plan'}
            </div>
          </div>
        </div>
        {/* Sign out only. "Switch account" sat here and POSTed to the SAME
         * /auth/signout form — the label promised an account chooser the
         * product does not have (DESIGN.md §11.1: implement a real chooser or
         * remove it). */}
        <div className="app-sidebar-signout">
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
  const labels: Record<SetupStatus, string> = {
    active: 'Connected recently', idle: 'No recent activity', stale: 'Check your connection', never: 'Connect your app',
  };
  const inner = <>
    <NavIcon icon="desktop" />
    <span>{labels[effective]}</span>
    <span className={`app-connection-dot ${spec.dot}`} aria-hidden="true" />
  </>;
  return isCta
    ? <Link href="/install" title={tooltip} className={`app-connection ${FOCUS_RING}`}>{inner}</Link>
    : <div title={tooltip} className="app-connection">{inner}</div>;
}

function NavIcon({ icon }: { icon: string }) {
  const mockIcon: Record<string, string> = { workflows: 'agents', activity: 'work', trending: 'coach', settings: 'settings', desktop: 'desktop' };
  if (mockIcon[icon]) return <svg className="app-nav-icon" aria-hidden="true"><use href={`/brand/tukido-icons.svg#${mockIcon[icon]}`} /></svg>;
  return <span aria-hidden="true" className="app-nav-icon bg-current" style={{ maskImage: `url(/icons/${icon}.svg)`, WebkitMaskImage: `url(/icons/${icon}.svg)`, maskSize: 'contain', maskRepeat: 'no-repeat' }} />;
}

function NavBadge({ value }: { value?: WorkAttentionBadge | null }) {
  if (value === undefined || (value?.complete && value.count === 0)) return null;
  const count = value?.count ?? 0;
  const known = count > 0;
  const label = known ? `${value?.complete ? '' : 'At least '}${count} need you` : 'Needs-you status unavailable';
  return <span className="app-nav-count" aria-label={label} title={label}>
    {known ? `${count > 99 ? '99' : count}${!value?.complete || count > 99 ? '+' : ''}` : '?'}
  </span>;
}

function NavLink({ item, active, badge }: { item: NavItem; active: boolean; badge?: WorkAttentionBadge | null }) {
  return <Link href={item.href} aria-current={active ? 'page' : undefined} className={`app-nav-link ${FOCUS_RING}`}>
    <NavIcon icon={item.icon} /><span>{item.label}</span><NavBadge value={badge} />
  </Link>;
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
export function MobileTopBar({ user }: { user: UserCtx }) {
  const { pathname, items, work } = useShellNav(user);

  return (
    <div className="md:hidden sticky top-0 z-20 bg-ink-900 border-b border-ink-700">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <Link href="/start" className={`flex items-center gap-2 rounded-md text-ink-50 ${FOCUS_RING}`}>
          <Logo height={23} />
        </Link>
        <div className="flex items-center gap-2 text-xs">
          <span className="capitalize text-ink-300">{user.plan}</span>
          {user.isFoundingCreator && <span title="Founding Creator" className="text-xs text-ink-400">Creator</span>}
        </div>
      </div>
      <nav aria-label="Primary" className="app-mobile-nav px-2 pb-2 overflow-x-auto">
        <ul className="flex items-center gap-1 min-w-max">
          {[...items, ...SECONDARY_NAV].map((item) => {
            const active = isNavItemActive(item, pathname);
            const badge = item.badgeKey === 'work' ? work : undefined;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`app-mobile-nav-link flex items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${FOCUS_RING} ${
                    active
                      ? 'bg-brand-500/10 text-ink-50 font-medium border-b-2 border-brand-500'
                      : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100 border-b-2 border-transparent'
                  }`}
                >
                  <NavIcon icon={item.icon} />
                  <span>{item.label}</span>
                  <NavBadge value={badge} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
