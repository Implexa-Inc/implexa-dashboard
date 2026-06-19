'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { STATUS_PRESENTATION, relativeFromNow, type SetupStatus } from '@/lib/setup-status';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type NavItem = {
  href:    string;
  label:   string;
  /** Filename in /public/icons/ (without extension). currentColor stroke makes it adapt to active/inactive state. */
  icon:    string;
  /** Match `/skills` AND `/skills/anything`. */
  matchPrefix?: boolean;
  /** Key into the badge counts map, renders a glanceable count chip when > 0. */
  badgeKey?: 'inbox' | 'needs' | 'agents';
  /** Hidden from nav to keep the surface focused on the autopilot loop. The
   *  route + page stay live (deep links + future work); only the nav item is
   *  suppressed. Flip back to surface it again. */
  hidden?: boolean;
};

// Brand SVG icons replace the previous emoji set. Mapping rationale:
//   skills        → "skills" (sparkle/skill mark)
//   integrations  → "link" (connection/chain)
//   roi           → "analytics" (bar chart)
//   install       → "flame" (the brand's "action/energy" archetype — matches "connect/ignite")
//   settings      → "settings" (gear)
//   pricing       → "spark" (premium tier feel)
// The nav is the autopilot loop, nothing else: mission control, the work that
// needs you, the jobs (workflows), the schedule (routines), and the track record
// (runs). Everything off that loop (ROI, the skill shelf, integrations,
// leaderboard, the web connect flow) is HIDDEN, not deleted: the routes + pages
// stay live for deep links and future work, but they do not clutter the surface.
// Flip `hidden` to bring any of them back.
// CONSUMER_PRODUCT_SPEC rail: Home (the manager's desk), Agents (your workers),
// Results (what they produced, with the feedback reply), and Connections (the
// health panel for your agents' account access, promoted to a first-class
// surface by CONNECTIONS_ONBOARDING.md since a signed-out account silently
// breaks an agent and silence must never read as success).
// Everything else is HIDDEN, not deleted: routes + pages stay live for deep
// links and admin, they just do not clutter the consumer surface. Skills /
// karma / scores / leaderboard leave the surface entirely (engine on, storefront
// off). Flip `hidden` to bring any back.
const PRIMARY_NAV: NavItem[] = [
  { href: '/overview',     label: 'Home',           icon: 'dashboard', matchPrefix: true },
  { href: '/workflows',    label: 'Agents',         icon: 'workflows', matchPrefix: true, badgeKey: 'agents' },
  { href: '/chains',       label: 'Agent Chains',   icon: 'link',      matchPrefix: true },
  // Results folded into Home (the one todo). Route stays live for deep links
  // (notification/email ?run= links) + the redesign's interim; nav item hidden.
  { href: '/inbox',        label: 'Results',        icon: 'activity',  matchPrefix: true, badgeKey: 'inbox', hidden: true },
  // Needs you folded into Home (grants/sign-ins/missed surface as a strip above
  // the todo). Route stays live for deep links; nav item hidden. Final nav is
  // the 2 sections: Home + Your Agents.
  { href: '/connections',  label: 'Needs you',      icon: 'link',      matchPrefix: true, badgeKey: 'needs', hidden: true },
  { href: '/runs',         label: 'Runs log',       icon: 'activity',  matchPrefix: true, hidden: true },
  { href: '/scheduled',    label: 'Routines',       icon: 'replay',    matchPrefix: true, hidden: true },
  { href: '/roi',          label: 'ROI',            icon: 'analytics', matchPrefix: true, hidden: true },
  { href: '/skills',       label: 'Skills',         icon: 'skills',    matchPrefix: true, hidden: true },
  { href: '/integrations', label: 'Integrations',   icon: 'link',      matchPrefix: true, hidden: true },
  { href: '/leaderboard',  label: 'Leaderboard',    icon: 'trending',  matchPrefix: true, hidden: true },
  { href: '/install',      label: 'Connect Claude', icon: 'flame',     matchPrefix: true, hidden: true },
];

const SECONDARY_NAV: NavItem[] = [
  { href: '/settings',     label: 'Settings',     icon: 'settings', matchPrefix: true },
  { href: '/pricing',      label: 'Pricing',      icon: 'spark',    matchPrefix: true },
];

type UserCtx = {
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

// Per-surface "last opened" markers. The badge counts only items newer than
// this, so opening the page clears it. Per-device on purpose (an unread hint,
// not synced state) — this is what makes "I checked them, they go away" true.
const SEEN_KEY: Record<'inbox' | 'needs' | 'agents', string> = {
  inbox:  'implexa.seen.inbox',
  needs:  'implexa.seen.needs',
  agents: 'implexa:agents-seen',
};

// Live statuses that count toward the "Agents" badge: the agent is working or
// needs a look. Mirrors the NOTIFY/active set in running-agents.tsx (running +
// the three "needs you" states), which is the same /live feed this reads.
const AGENT_BADGE_STATUSES: ReadonlySet<string> = new Set([
  'running', 'needs_attention', 'failed', 'waiting_approval',
]);

const LIVE_POLL_MS = 15000;

// Polls GET /api/v2/scheduled-skills/live on the same ~15s cadence as the Active
// Agents / Alerts views and returns the `since` timestamps of every currently
// live/needs-a-look agent. Reuses running-agents.tsx's fetch + auth pattern.
// Holds the last known list on transient errors so the badge doesn't flicker.
function useLiveAgentTimestamps(): string[] {
  const [stamps, setStamps] = useState<string[]>([]);
  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend('/api/v2/scheduled-skills/live', { jwt: session?.access_token });
        if (!alive) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        const live = items
          .filter((c: { status?: string }) => AGENT_BADGE_STATUSES.has(c?.status ?? ''))
          .map((c: { since?: string | null }) => c?.since)
          .filter((s: unknown): s is string => typeof s === 'string' && s.length > 0);
        setStamps(live);
      } catch { /* keep last known list — avoid flicker on a transient failure */ }
    }
    load();
    const t = setInterval(load, LIVE_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return stamps;
}

// A glanceable "new since you last opened this page" count. Stores the open time
// in localStorage and counts only timestamps newer than it, clearing the badge
// the moment the user lands on the page. ISO timestamps are compared as epoch
// millis so a timezone-suffix format ("+00:00" vs "Z") can't skew the result.
function useUnreadBadge(
  key: 'inbox' | 'needs' | 'agents',
  pathPrefix: string,
  timestamps: string[],
  pathname: string,
  // When true, a missing marker is seeded to "now" on first load so pre-existing
  // activity doesn't all show as new on the very first render (mirrors the
  // `seeded` guard in running-agents.tsx). Live feeds (Agents) want this; the
  // server-fed inbox/needs counts want the opposite (surface existing unread).
  seedOnFirstLoad = false,
): number {
  const [seenMs, setSeenMs] = useState<number | null>(null);
  const onPage = pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);

  // Read the stored marker once on mount. No marker -> either seed to now (live
  // feeds) or treat everything as new (0, server-fed counts).
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(SEEN_KEY[key]);
      if (v) { setSeenMs(Number(v)); return; }
      if (seedOnFirstLoad) {
        const now = Date.now();
        try { window.localStorage.setItem(SEEN_KEY[key], String(now)); } catch { /* private mode */ }
        setSeenMs(now);
      } else {
        setSeenMs(0);
      }
    } catch { setSeenMs(0); }
    // seedOnFirstLoad is a stable literal per call site; key identifies the marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // While the page is open, mark everything seen now and clear instantly.
  useEffect(() => {
    if (!onPage) return;
    const now = Date.now();
    try { window.localStorage.setItem(SEEN_KEY[key], String(now)); } catch { /* private mode */ }
    setSeenMs(now);
  }, [onPage, key]);

  if (seenMs === null) return 0;   // pre-hydration: render no badge (SSR-safe)
  if (onPage) return 0;
  let n = 0;
  for (const t of timestamps) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && ms > seenMs) n++;
  }
  return n;
}

export default function Sidebar({ user, resultRunsAt = [], needsItemsAt = [] }: { user: UserCtx; resultRunsAt?: string[]; needsItemsAt?: string[] }) {
  const pathname = usePathname() || '';
  const inboxUnread = useUnreadBadge('inbox', '/inbox', resultRunsAt, pathname);
  const needsUnread = useUnreadBadge('needs', '/connections', needsItemsAt, pathname);
  // Live "Agents" badge: poll the same /live feed the Active Agents view uses,
  // then apply unread-since semantics against /workflows (seeded on first load so
  // pre-existing activity isn't counted as new; cleared on visiting the page).
  const agentStamps = useLiveAgentTimestamps();
  const agentsUnread = useUnreadBadge('agents', '/workflows', agentStamps, pathname, true);

  const isActive = (item: NavItem) =>
    item.matchPrefix
      ? pathname === item.href || pathname.startsWith(`${item.href}/`)
      : pathname === item.href;

  const badgeFor = (item: NavItem) =>
    item.badgeKey === 'inbox' ? inboxUnread
      : item.badgeKey === 'needs' ? needsUnread
      : item.badgeKey === 'agents' ? agentsUnread
      : 0;

  const badgeAriaFor = (item: NavItem, n: number) =>
    item.badgeKey === 'agents' ? `${n} agents need attention` : `${n} waiting for you`;

  return (
    <aside className="hidden md:flex md:flex-col md:sticky md:top-0 w-56 shrink-0 border-r border-ink-700 bg-ink-900/50 h-screen overflow-y-auto">
      {/* Brand — LogoMark (square badge) until the wordmark gets its final
       * polish pass. Per founder's instruction: "Use Implexa favicon
       * instead of [full] logo. Logo needs finishing touches, will work
       * on it." Easy to swap back to <Logo /> later. */}
      <div className="px-4 pt-6 pb-8">
        <Link href="/overview" className="inline-flex items-center gap-2 text-ink-50">
          <LogoMark size={28} />
          <span className="text-sm font-medium">Implexa</span>
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="px-2 flex-1">
        <ul className="space-y-0.5">
          {PRIMARY_NAV.filter((item) => !item.hidden).map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} icon={item.icon} label={item.label} active={isActive(item)} badge={badgeFor(item)} badgeAria={badgeAriaFor(item, badgeFor(item))} />
            </li>
          ))}
        </ul>

        <div className="mt-8 px-3 mb-2 text-[10px] uppercase tracking-wider text-ink-500 font-medium">Account</div>
        <ul className="space-y-0.5">
          {SECONDARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} icon={item.icon} label={item.label} active={isActive(item)} />
            </li>
          ))}
        </ul>

        {/* Admin section — only shown for users in ADMIN_EMAILS env var.
         * Internal use only (founder dashboard for launch monitoring). */}
        {user.isAdmin && (
          <>
            <div className="mt-8 px-3 mb-2 text-[10px] uppercase tracking-wider text-ink-500 font-medium">Internal</div>
            <ul className="space-y-0.5">
              <li>
                <NavLink
                  href="/admin"
                  icon="analytics"
                  label="Admin"
                  active={isActive({ href: '/admin', label: 'Admin', icon: 'analytics', matchPrefix: true })}
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
        {/* Switch account + Sign out. Many users run agents under a different
         * Implexa account than they browse as; "Switch account" makes hopping to
         * the connected account one click (sign out -> login picks the other). */}
        <div className="mt-3 flex items-center gap-3">
          <form action="/auth/signout" method="POST">
            <button className="text-[11px] text-ink-300 hover:text-ink-50 hover:underline">
              Switch account
            </button>
          </form>
          <span className="text-ink-700" aria-hidden>·</span>
          <form action="/auth/signout" method="POST">
            <button className="text-[11px] text-ink-500 hover:text-ink-200 hover:underline">
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
        <Link href="/install" className="inline-flex items-center hover:underline">
          {inner}
        </Link>
      ) : inner}
    </div>
  );
}

function NavLink({ href, icon, label, active, badge = 0, badgeAria }: { href: string; icon: string; label: string; active: boolean; badge?: number; badgeAria?: string }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? 'bg-brand-500/10 text-ink-50 font-medium border-l-2 border-brand-500'
          : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100 border-l-2 border-transparent'
      }`}
    >
      {/* SVG icon via CSS mask-image — gives us currentColor inheritance.
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
       * multi-color icons in nav. */}
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
      <span>{label}</span>
      {badge > 0 && (
        <span
          className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold bg-brand-500 text-ink-950"
          aria-label={badgeAria ?? `${badge} waiting for you`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

/**
 * Mobile top nav — narrow viewport only. Sidebar hides on `md:`+.
 */
export function MobileTopBar({ user }: { user: UserCtx }) {
  return (
    <div className="md:hidden sticky top-0 z-20 bg-ink-900 border-b border-ink-700 px-4 py-3 flex items-center justify-between">
      <Link href="/overview" className="inline-flex items-center gap-2 text-ink-50">
        <LogoMark size={24} />
        <span className="text-sm font-medium">Implexa</span>
      </Link>
      <div className="flex items-center gap-2 text-xs">
        <span className="capitalize text-ink-300">{user.plan}</span>
        {user.isFoundingCreator && <span title="Founding Creator">🏆</span>}
      </div>
    </div>
  );
}
