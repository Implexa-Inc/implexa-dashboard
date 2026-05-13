'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = {
  href:    string;
  label:   string;
  icon:    string;
  /** Match `/skills` AND `/skills/anything`. */
  matchPrefix?: boolean;
};

const PRIMARY_NAV: NavItem[] = [
  { href: '/skills',       label: 'Skills',       icon: '✨', matchPrefix: true },
  { href: '/integrations', label: 'Integrations', icon: '🔌', matchPrefix: true },
  { href: '/roi',          label: 'ROI',          icon: '📊', matchPrefix: true },
  { href: '/install',      label: 'Connect Claude', icon: '⚡', matchPrefix: true },
];

const SECONDARY_NAV: NavItem[] = [
  { href: '/settings',     label: 'Settings',     icon: '⚙️', matchPrefix: true },
  { href: '/pricing',      label: 'Pricing',      icon: '💎', matchPrefix: true },
];

type UserCtx = {
  displayName: string | null;
  email:       string;
  plan:        'free' | 'pro' | 'enterprise' | string;
  isFoundingCreator: boolean;
};

export default function Sidebar({ user }: { user: UserCtx }) {
  const pathname = usePathname() || '';

  const isActive = (item: NavItem) =>
    item.matchPrefix
      ? pathname === item.href || pathname.startsWith(`${item.href}/`)
      : pathname === item.href;

  return (
    <aside className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-ink-700 bg-ink-900/50 min-h-screen sticky top-0">
      {/* Brand */}
      <div className="px-4 pt-6 pb-8">
        <Link href="/skills" className="brand-mark text-sm">
          <span className="brand-mark-flame">⚡</span> Implexa
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="px-2 flex-1">
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} icon={item.icon} label={item.label} active={isActive(item)} />
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
      </nav>

      {/* User block at bottom */}
      <div className="px-3 py-4 border-t border-ink-700">
        <div className="text-sm text-ink-100 font-medium truncate" title={user.displayName || user.email}>
          {user.displayName || user.email.split('@')[0]}
        </div>
        <div className="text-[11px] text-ink-400 truncate" title={user.email}>{user.email}</div>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-ink-800 text-ink-300 font-medium capitalize">
            {user.plan} plan
          </span>
          {user.isFoundingCreator && (
            <span title="Founding Creator — unlimited captures, free Pro seat for life" className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-success-400/20 text-success-700 dark:text-success-400">
              🏆
            </span>
          )}
        </div>
        <form action="/auth/signout" method="POST" className="mt-3">
          <button className="text-[11px] text-ink-500 hover:text-ink-200 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

function NavLink({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? 'bg-brand-500/10 text-ink-50 font-medium border-l-2 border-brand-500'
          : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100 border-l-2 border-transparent'
      }`}
    >
      <span className="text-base leading-none w-5 text-center" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

/**
 * Mobile top nav — narrow viewport only. Sidebar hides on `md:`+.
 */
export function MobileTopBar({ user }: { user: UserCtx }) {
  return (
    <div className="md:hidden sticky top-0 z-20 bg-ink-900 border-b border-ink-700 px-4 py-3 flex items-center justify-between">
      <Link href="/skills" className="brand-mark text-sm">
        <span className="brand-mark-flame">⚡</span> Implexa
      </Link>
      <div className="flex items-center gap-2 text-xs">
        <span className="capitalize text-ink-300">{user.plan}</span>
        {user.isFoundingCreator && <span title="Founding Creator">🏆</span>}
      </div>
    </div>
  );
}
