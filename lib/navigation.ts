/**
 * lib/navigation.ts — the ONE canonical description of the dashboard shell.
 *
 * DESIGN.md §4.1 locks primary navigation to three product domains:
 *
 *     Agents · Work · Training          (Settings is secondary)
 *
 * and locks out two entries that used to exist here:
 *
 *   - **Home** is not a primary destination. It owned no unique object, so it
 *     competed for attention forever. The logo resolves to the state-aware
 *     default landing instead (§4.3, `resolveDefaultLanding` below).
 *   - **Review** is not a primary destination. Ready-for-review work is a
 *     FILTER and a count inside Work; opening an item opens the canonical Work
 *     item in review mode (§9.3).
 *
 * Marketplace discovery lives INSIDE Agents and Review lives INSIDE Work, so
 * `Marketplace`, `Discover`, `Home` and `Review` must never appear as primary
 * entries (IMMEDIATE_MARKETPLACE_EXECUTION_ROADMAP_2026-08-11 §1, Lane D).
 *
 * WHY THIS IS A MODULE AND NOT A CONST IN sidebar.tsx. Three surfaces have to
 * agree about the same facts — the desktop sidebar, the narrow-viewport top bar,
 * and the legacy-route redirects — and they used to agree only by hand. Nav
 * items, the "which domain owns this URL" rule, and the redirect table are all
 * pure data/functions here so they can be tested directly and so a fourth
 * surface cannot drift.
 *
 * Nothing in this file reads backend state. `resolveDefaultLanding` takes an
 * already-loaded snapshot precisely so the rule stays testable and so no new
 * "truth" is invented in the shell.
 */

export type NavItemId = 'agents' | 'work' | 'training' | 'settings';

export type NavItem = {
  id:    NavItemId;
  /** Canonical destination for this domain. */
  href:  string;
  label: string;
  /** Filename in /public/icons/ (no extension); painted with currentColor. */
  icon:  string;
  /**
   * Every path prefix this domain owns, INCLUDING legacy routes that still
   * resolve here. Being on `/review/abc123` must light up **Work**, not
   * nothing — otherwise the shell tells the user they are nowhere.
   */
  owns:  readonly string[];
  /** Key into the badge map. Only Work carries one (see sidebar.tsx). */
  badgeKey?: 'work';
};

/**
 * Agents keeps the existing `/workflows` route. The directory rename to
 * `/agents` belongs to the Marketplace lane, which owns the Agents page and
 * resume content; renaming it from the shell would collide with that work. The
 * canonical-sounding `/agents` URL is served as a redirect so links written
 * against the new vocabulary already resolve (see LEGACY_ROUTE_REDIRECTS).
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  {
    id: 'agents', href: '/workflows', label: 'Agents', icon: 'workflows',
    // Marketplace discovery is inside Agents — `/browse` is a legacy alias for
    // it, not a second domain.
    owns: ['/workflows', '/agents', '/browse', '/chains', '/skills', '/create'],
  },
  {
    id: 'work', href: '/work', label: 'Work', icon: 'activity', badgeKey: 'work',
    // Review, Results, the runs log, the old Home and Needs-you all describe
    // one domain: what is being produced, what needs me, what was delivered.
    owns: ['/work', '/review', '/inbox', '/runs', '/overview', '/connections', '/scheduled', '/generations'],
  },
  {
    id: 'training', href: '/training', label: 'Training', icon: 'trending',
    owns: ['/training'],
  },
];

export const SECONDARY_NAV: readonly NavItem[] = [
  {
    id: 'settings', href: '/settings', label: 'Settings', icon: 'settings',
    owns: ['/settings', '/install', '/integrations', '/pricing', '/get-app', '/roi'],
  },
];

export const ALL_NAV: readonly NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

/**
 * Labels that must never appear as a primary navigation entry. Kept as data so
 * the guard is a test over the real model rather than a comment someone deletes.
 */
export const FORBIDDEN_PRIMARY_LABELS: readonly string[] = [
  'Home', 'Review', 'Marketplace', 'Discover', 'Results', 'Runs', 'Needs you',
];

/**
 * Path-prefix ownership with a SEGMENT BOUNDARY.
 *
 * The naive `pathname.startsWith(prefix)` is wrong here and wrong in a way that
 * looks fine in review: `/workflows`.startsWith(`/work`) is true, so Agents and
 * Work would both light up on the Agents page. A prefix only matches on an
 * exact path or a full segment boundary.
 */
export function ownsPath(prefix: string, pathname: string): boolean {
  if (!prefix || !pathname) return false;
  const path = stripTrailingSlash(pathname);
  const base = stripTrailingSlash(prefix);
  return path === base || path.startsWith(`${base}/`);
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.replace(/\/+$/, '') : p;
}

/** True when `pathname` (a deep link included) belongs to this domain. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.owns.some((p) => ownsPath(p, pathname));
}

/**
 * The single domain that owns a URL, or null. Longest matching prefix wins so a
 * more specific claim beats a broader one.
 */
export function activeNavItem(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  let bestLen = -1;
  for (const item of ALL_NAV) {
    for (const p of item.owns) {
      if (ownsPath(p, pathname) && p.length > bestLen) { best = item; bestLen = p.length; }
    }
  }
  return best;
}

// ── Work views ───────────────────────────────────────────────────────────────
//
// Work's three states (DESIGN.md §8.2). `review` is the "Ready for review"
// filter that replaces the old Review navigation entry — a filter changes entry
// context, never destination ownership (§8.5).

export const WORK_VIEWS = ['needs', 'review', 'delivered'] as const;
export type WorkView = typeof WORK_VIEWS[number];

export const DEFAULT_WORK_VIEW: WorkView = 'needs';

export const WORK_VIEW_LABELS: Record<WorkView, string> = {
  needs:     'Needs you',
  review:    'Ready for review',
  delivered: 'Delivered',
};

/** Tolerant parse — an unknown or absent `?view=` falls back to the default. */
export function parseWorkView(raw: string | string[] | undefined | null): WorkView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (WORK_VIEWS as readonly string[]).includes(v ?? '') ? (v as WorkView) : DEFAULT_WORK_VIEW;
}

export function workViewHref(view: WorkView): string {
  return view === DEFAULT_WORK_VIEW ? '/work' : `/work?view=${view}`;
}

// ── Legacy routes ────────────────────────────────────────────────────────────

export type LegacyRedirect = {
  from: string;
  to:   string;
  /** Why the old URL still exists, for the redirect page's docblock. */
  why:  string;
};

/**
 * Routes that used to be their own destination and now resolve into a canonical
 * domain. Every one of these still WORKS — none of the pages was deleted
 * without a compatibility path — because notification emails, desktop
 * notifications and older Run Cards link straight at them.
 */
export const LEGACY_ROUTE_REDIRECTS: readonly LegacyRedirect[] = [
  { from: '/review', to: '/work?view=review',    why: 'Review is a filter inside Work, not a destination (DESIGN.md §9.3).' },
  { from: '/inbox',  to: '/work?view=delivered', why: 'Results is the Delivered view of Work (DESIGN.md §8.2).' },
  { from: '/agents', to: '/workflows',           why: 'Forward alias for the canonical Agents vocabulary.' },
];

/**
 * Build the destination for a legacy hit, CARRYING THE ORIGINAL QUERY STRING.
 *
 * This is the whole reason the helper exists: `/inbox?run=<id>` is what a
 * result notification links to, and dropping `run` on the redirect would land
 * the user on a list instead of the result they clicked. Redirect targets win
 * on key collision (the target's `view` is the destination's own claim).
 */
export function legacyDestination(
  to: string,
  incoming?: URLSearchParams | Record<string, string | string[] | undefined> | null,
): string {
  const [path, targetQuery = ''] = to.split('?');
  const params = new URLSearchParams();

  if (incoming) {
    const entries = incoming instanceof URLSearchParams
      ? Array.from(incoming.entries())
      : Object.entries(incoming).flatMap(([k, v]) =>
          v == null ? [] : (Array.isArray(v) ? v.map((x) => [k, x] as const) : [[k, v] as const]));
    for (const [k, v] of entries) params.append(k, String(v));
  }

  for (const [k, v] of new URLSearchParams(targetQuery)) params.set(k, v);

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Merge per-source timestamp lists into one deduplicated list.
 *
 * Work's badge spans two server-fed lists that are read from the SAME table
 * with different filters — every run in the window, and the subset that stalled
 * or is awaiting a decision. The second is largely contained in the first, so
 * concatenating them counts those rows twice and the badge reads roughly double.
 */
export function mergeTimestamps(...lists: readonly (readonly string[])[]): string[] {
  return Array.from(new Set(lists.flat()));
}

/**
 * How many of `timestamps` are newer than a "last opened" marker.
 *
 * ISO strings are compared as epoch millis so a timezone-suffix difference
 * ("+00:00" vs "Z") cannot skew the result, and an unparseable timestamp is
 * skipped rather than counted.
 */
export function countNewerThan(timestamps: readonly string[], seenMs: number): number {
  let n = 0;
  for (const t of timestamps) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && ms > seenMs) n++;
  }
  return n;
}

// ── State-aware default landing ──────────────────────────────────────────────

/**
 * DESIGN.md §4.3, in priority order:
 *
 *   1. something needs input or a review decision  → Work
 *   2. something is actively running               → Work
 *   3. otherwise                                   → Agents
 *
 * Takes an already-loaded snapshot rather than querying, so the rule is a pure
 * function and the shell invents no state of its own. Counts that could not be
 * read are `null`, and an unreadable count is NOT treated as zero — "we could
 * not see your queue" must not silently become "nothing needs you".
 */
export type LandingSnapshot = {
  needsDecision: number | null;
  inProgress:    number | null;
};

export function resolveDefaultLanding(s: LandingSnapshot): string {
  const work = PRIMARY_NAV.find((i) => i.id === 'work')!.href;
  const agents = PRIMARY_NAV.find((i) => i.id === 'agents')!.href;
  if (s.needsDecision === null || s.inProgress === null) return work;
  return s.needsDecision > 0 || s.inProgress > 0 ? work : agents;
}

// ── Shell chrome ─────────────────────────────────────────────────────────────

/** Target of the skip link; the layout's <main> carries this id. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * Surfaces where the global floating Create button is suppressed
 * (DESIGN.md §15 Phase A.5 — "Stop using the global Create button on Work and
 * review surfaces"). Creating an agent is not a plausible next action while
 * you are judging a delivered artifact, and the control overlaps the review
 * action area.
 */
export const CREATE_FAB_SUPPRESSED_PREFIXES: readonly string[] = ['/work', '/review', '/runs'];

export function isCreateFabSuppressed(pathname: string): boolean {
  return CREATE_FAB_SUPPRESSED_PREFIXES.some((p) => ownsPath(p, pathname));
}
