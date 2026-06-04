'use client';

/**
 * Tabbed skills library — horizontal tab navigation with four LENSES on
 * the user's visible skill universe. NOT mutually exclusive: a single
 * skill can appear in multiple tabs because each tab answers a different
 * question.
 *
 *   1. Your skills          — "what did I author?"
 *                            created_by.userId === me (ANY scope)
 *   2. Org-wide skills      — "what's available to my team?"
 *                            scope IN ('org', 'universal') AND
 *                            organization_id === my org. Includes my own
 *                            org-scoped and public-shared skills since my
 *                            team has access to those too.
 *   3. Trending Globally    — "what's the public leaderboard?"
 *                            scope='universal' (all of them — including
 *                            mine so I can see my own rank).
 *   4. Implexa Base Skills  — "what ships with Implexa?"
 *                            scope='system' (the 30 horizontal Playbooks).
 *
 * Example overlap: a skill I authored with scope='universal' appears in
 *   - Your skills (I authored it)
 *   - Org-wide skills (my team has access)
 *   - Trending Globally (it's public)
 *
 * That matches the user mental model "I shared this — show me where it's
 * visible." Previous mutually-exclusive design surprised users by hiding
 * their own shared work from Org-wide / Trending.
 *
 * Tab counts react LIVE to the search query + tag filter — `(3 of 5)`
 * format when filtered, just `(5)` otherwise.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import RunInClaudeButton from './run-in-claude-button';

type Skill = {
  id:              string;
  slug:            string;
  name:            string;
  description:     string | null;
  scope:           string;
  status:          string;
  usage_count:     number;
  trigger_phrases: string[] | null;
  outcome_stats:   Record<string, number> | null;
  tags:            string[] | null;
  created_by?:     { userId?: string; displayName?: string } | null;
  organization_id?: string;
  /**
   * If non-null, this skill is a fork of another skill. When a user edits a
   * fork for the first time, `promoteFromFork` clears this column (the fork
   * becomes a freshly-authored skill, stamped under the editor). So a
   * non-null value here means "the user has the skill in their library but
   * hasn't yet customized it — it's still a pristine copy of the source."
   * Excluded from the "Your skills" bucket below.
   */
  forked_from_skill_id?: string | null;
  /**
   * Bucket-membership tag for the "Your skills" view, attached during
   * bucket-building (not loaded from the database). Mirrors the
   * source: 'authored' | 'installed' field that listOrgSkills surfaces in
   * the backend so the row renderer can show an "Installed" pill on
   * library-reference rows without an extra join.
   */
  _source?: 'authored' | 'installed';
  /**
   * Skill creation timestamp. Loaded from org_skills.created_at by the
   * parent page query. Drives the "Your skills" recency sort so freshly-
   * authored skills land at the TOP of the list — previously the bucket
   * just inherited Map insertion order, which put universal-scope new
   * captures at the bottom (universalSkills query sorts by usage_count
   * DESC; a brand-new skill with usage_count=0 ranks low in that query).
   */
  created_at?: string | null;
};

type TabId = 'yours' | 'org' | 'trending' | 'base';

type TabDef = {
  id:          TabId;
  label:       string;
  description: string;
};

const TABS: TabDef[] = [
  {
    id:          'yours',
    label:       'Your skills',
    description: 'Your personal library — skills you authored from scratch plus any you\'ve installed or forked (from a share link, Trending Globally, or a Base Playbook). Edit, share, or invoke them anytime. (Your shared skills also appear in Org-wide and Trending Globally below.)',
  },
  {
    id:          'org',
    label:       'Org-wide skills',
    description: 'Everything available to your team — org-shared skills + anything anyone in your org has shared publicly. Visible to anyone with your work email.',
  },
  {
    id:          'trending',
    label:       'Trending Globally',
    description: 'Public skills from every org, ranked by usage. Fork any of them into your library and customize for your context — first edit counts as your own capture. Your own public skills appear here too with your global rank.',
  },
  {
    id:          'base',
    label:       'Implexa Base Skills',
    description: '30+ horizontal Playbooks shipped with every Implexa install. Fork them to make them yours, or run directly without forking. Free to fork unlimited times.',
  },
];

// Tags we hide from the filter pill bar — internal metadata, not user-facing
// categories. Keeps the pill list focused on actual verticals/uses.
const HIDDEN_TAGS = new Set([
  'base-playbook', 'hand-seeded', 'horizontal', 'atomic', 'composite',
  'medium', 'short', 'system', 'active', 'hex',
]);

/**
 * Semantic search expansion — a small synonym/cluster map so users can type
 * vertical names ("real estate") and find skills tagged with related
 * concepts ("permits", "zoning", "school-research"). When the search query
 * matches a cluster key OR any cluster member, we expand the match set to
 * the full cluster.
 *
 * Maintained by hand for launch (~10 verticals). Easy to extend. If we
 * outgrow this, swap for embeddings-based semantic search.
 *
 * Keys are normalized lowercase (no hyphens). Members can have hyphens —
 * they match against tag values directly.
 */
const SEMANTIC_CLUSTERS: Record<string, string[]> = {
  'real estate':       ['real-estate', 'realestate', 'permits', 'zoning', 'property', 'school', 'schools', 'mls', 'listings', 'home', 'house', 'realtor', 'realty'],
  'sales':             ['gtm', 'sales', 'prospecting', 'outreach', 'cold-email', 'discovery', 'crm', 'deal', 'pipeline', 'leads', 'icp'],
  'gtm':               ['gtm', 'sales', 'prospecting', 'outreach', 'cold-email', 'discovery', 'crm', 'deal', 'pipeline', 'leads'],
  'recruiting':        ['talent', 'recruiting', 'hiring', 'candidate', 'candidates', 'ats', 'bullhorn', 'submittals', 'sourcing', 'placement'],
  'talent':            ['talent', 'recruiting', 'hiring', 'candidate', 'candidates', 'ats', 'submittals', 'sourcing'],
  'customer success':  ['customer-success', 'cs', 'retention', 'expansion', 'renewal', 'health', 'churn', 'qbr'],
  'cs':                ['customer-success', 'cs', 'retention', 'expansion', 'renewal', 'health', 'churn'],
  'engineering':       ['engineering', 'eng', 'dev', 'devops', 'github', 'pr', 'code-review', 'bug', 'triage', 'rfc'],
  'product':           ['product', 'pm', 'roadmap', 'spec', 'feature', 'launch'],
  'people ops':        ['people-ops', 'peopleops', 'hr', 'onboarding', 'offboarding', 'review', 'feedback'],
  'finance':           ['finance', 'accounting', 'budget', 'forecast', 'invoice', 'expense', 'p&l'],
  'marketing':         ['marketing', 'content', 'social', 'campaign', 'brand', 'seo', 'copy'],
  'meetings':          ['meetings', 'standup', 'briefing', 'agenda', 'notes', 'recap', 'pre-call', 'prep'],
  'research':          ['research', 'company-research', 'prospect-research', 'account-plan'],
};

/**
 * Given a raw search query, return the array of terms to match against.
 * If the query matches a cluster key or member, all cluster terms are
 * returned so the search effectively says "match if ANY of these substrings
 * appear in the skill haystack."
 */
function expandSearchTerms(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // Match against cluster keys first (most common case — user types vertical name)
  if (SEMANTIC_CLUSTERS[q]) {
    return [q, ...SEMANTIC_CLUSTERS[q]];
  }

  // Then match against cluster members (user types a tag-like term)
  for (const [key, members] of Object.entries(SEMANTIC_CLUSTERS)) {
    if (members.includes(q) || members.includes(q.replace(/\s+/g, '-'))) {
      return [q, key, ...members];
    }
  }

  // No semantic match — return just the query (will fall through to plain substring match)
  return [q];
}

const TAG_LABELS: Record<string, string> = {
  'gtm':              'GTM',
  'sales':            'Sales',
  'talent':           'Talent',
  'recruiting':       'Recruiting',
  'customer-success': 'Customer Success',
  'cs':               'Customer Success',
  'engineering':      'Engineering',
  'product':          'Product',
  'people-ops':       'People Ops',
  'hr':               'HR',
  'finance':          'Finance',
  'marketing':        'Marketing',
  'writing':          'Writing',
  'research':         'Research',
  'communication':    'Communication',
  'productivity':     'Productivity',
  'meetings':         'Meetings',
  'onboarding':       'Onboarding',
  'standup':          'Standup',
};

function labelFor(tag: string): string {
  return TAG_LABELS[tag] ?? tag.replace(/-/g, ' ');
}

export default function SkillsLibrary({
  orgSkills,
  systemSkills,
  universalSkills = [],
  installedSkills = [],
  currentUserId,
  currentOrgId,
}: {
  orgSkills:        Skill[];
  systemSkills:     Skill[];
  universalSkills?: Skill[];
  /** Canonical skill rows the caller has an active library reference to
   * (via user_skill_installs from migration 0021). Sourced from a
   * dedicated supabase query in the parent page because installs are
   * frequently cross-org and would be excluded by the org-scope filter
   * that governs `orgSkills`. Used to route rows into the "Your skills"
   * bucket alongside authored skills. */
  installedSkills?: Skill[];
  currentUserId:    string;
  /** Used to determine if a universal skill belongs to the user's own
   * org — those show up in "Org-wide" because the team has access to
   * them via Implexa regardless of whether they were also shared publicly. */
  currentOrgId:     string;
}) {
  const [query,     setQuery]     = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('yours');

  // ─── Bucket logic — LENSES with overlap ─────────────────────────────
  // Each tab answers a different question. A single skill can appear in
  // multiple tabs because the questions are independent. See file header
  // for the design rationale + examples.
  const buckets = useMemo(() => {
    // Dedupe: org/private/system come from one query, universal from
    // another, installed (cross-org library references via migration
    // 0021) from a third. A skill could appear in multiple result sets
    // (e.g. a universal skill the user installed shows up in BOTH
    // universalSkills and installedSkills). The Map collapses on id so
    // every skill is iterated once below.
    const all = new Map<string, Skill>();
    for (const s of orgSkills)       all.set(s.id, s);
    for (const s of systemSkills)    all.set(s.id, s);
    for (const s of universalSkills) all.set(s.id, s);
    for (const s of installedSkills) all.set(s.id, s);

    // Membership lookup: post-migration-0021, "is this in my library?" is
    // answered by user_skill_installs (an explicit row, not an authorship
    // check). The installed-cross-org case is what the union query above
    // adds — universal-scope installed skills are already in the Map via
    // universalSkills, but this Set lets us tag them as installed even
    // when they also showed up in the universal query.
    const installedIdSet = new Set(installedSkills.map((s) => s.id));

    const yours:    Skill[] = [];
    const org:      Skill[] = [];
    const trending: Skill[] = [];
    const base:     Skill[] = [];

    for (const s of all.values()) {
      const isMine          = s.created_by?.userId === currentUserId;
      const isInstalled     = installedIdSet.has(s.id);
      const isMyOrg         = s.organization_id === currentOrgId;
      const isOrgScope       = s.scope === 'org';
      const isUniversalScope = s.scope === 'universal';
      const isSystemScope    = s.scope === 'system';

      // Your skills: skills the user controls OR explicitly added to their
      // library. Two distinct routes in:
      //   • Authored — skills they created (record-skill / save-this) or
      //     forks they've customized (forked_from_skill_id cleared via
      //     promoteFromFork). They own the canonical row.
      //   • Installed — a user_skill_installs reference to a canonical
      //     row in someone else's org. No copy, no edit rights — they
      //     can run it and they can fork to customize.
      //
      // Dedup precedence matches the backend's _listMyLibrary: authored
      // wins on the rare double-membership case (a user authored a skill
      // AND somehow has an install row for it). The _source tag drives
      // the row renderer's "Installed" pill below.
      if (isMine) {
        yours.push({ ...s, _source: 'authored' });
      } else if (isInstalled) {
        yours.push({ ...s, _source: 'installed' });
      }

      // Org-wide: scope=org OR scope=universal, in your own org. This
      // is "what your team has access to" — includes both your shared
      // work and your teammates' shared work + anything your org
      // published publicly (still accessible to the team).
      if (isMyOrg && (isOrgScope || isUniversalScope)) org.push(s);

      // Trending Globally: all universal skills, including your own.
      // Shows your rank on the public leaderboard.
      if (isUniversalScope) trending.push(s);

      // Base Playbooks
      if (isSystemScope) base.push(s);
    }

    // Sort "Your skills" by creation recency, most-recent first.
    // Without this, the bucket inherits Map insertion order, which is:
    //   1. orgSkills (sorted by created_at DESC at the parent query level)
    //   2. systemSkills (filtered subset of the same query)
    //   3. universalSkills (sorted by usage_count DESC — a freshly-captured
    //      universal-scope skill with usage_count=0 ends up LAST in this set)
    //   4. installedSkills (no parent sort)
    //
    // The universal-skill subsort is what caused the bug: a brand-new
    // capture you just made via /implexa:record-skill or /implexa:update-skill
    // lands as scope='universal' and gets sorted to the bottom of the
    // universal bucket by usage_count, then appears at the bottom of
    // "Your skills" via Map insertion order. Re-sorting by created_at
    // here fixes the recency expectation. created_at is loaded into the
    // Skill type via the parent page's SELECT (see /skills/page.tsx).
    yours.sort((a, b) => {
      const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTs - aTs;
    });

    return { yours, org, trending, base };
  }, [orgSkills, systemSkills, universalSkills, installedSkills, currentUserId, currentOrgId]);

  // ─── Filter universe — search + tag ──────────────────────────────────
  // Search is semantically expanded via SEMANTIC_CLUSTERS — e.g. typing
  // "real estate" matches skills tagged with "permits", "zoning",
  // "school-research", etc. Falls back to plain substring match if the
  // query doesn't hit any cluster. See `expandSearchTerms` for the map.
  const expandedTerms = useMemo(() => expandSearchTerms(query), [query]);
  const matchesSearch = (s: Skill): boolean => {
    if (!query.trim()) return true;
    const haystack = [
      s.name,
      s.description || '',
      s.slug,
      ...(s.trigger_phrases || []),
      ...(s.tags || []),
    ].join(' ').toLowerCase();
    // Match if ANY of the expanded terms appears (OR semantics)
    return expandedTerms.some(term => haystack.includes(term));
  };
  const matchesTag = (s: Skill): boolean => !activeTag || (s.tags || []).includes(activeTag);
  const filtered = (list: Skill[]) => list.filter(s => matchesSearch(s) && matchesTag(s));

  // Build counts: total per bucket + filtered per bucket
  const counts = {
    yours:    { total: buckets.yours.length,    filtered: filtered(buckets.yours).length },
    org:      { total: buckets.org.length,      filtered: filtered(buckets.org).length },
    trending: { total: buckets.trending.length, filtered: filtered(buckets.trending).length },
    base:     { total: buckets.base.length,     filtered: filtered(buckets.base).length },
  };
  const hasActiveFilter = !!query.trim() || !!activeTag;

  // ─── Tag pill universe — deduped across overlapping buckets ─────────
  // The buckets now overlap (a skill can be in multiple tabs — see file
  // header), so naively iterating each bucket would double-count tags on
  // shared skills. Build a unique-skill set first, then count tags.
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    const seen = new Set<string>();
    for (const s of [...buckets.yours, ...buckets.org, ...buckets.trending, ...buckets.base]) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      for (const t of s.tags || []) {
        if (HIDDEN_TAGS.has(t)) continue;
        m.set(t, (m.get(t) || 0) + 1);
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [buckets]);

  // Mobile-only filter drawer state. On md+ viewports the left sidebar
  // is always visible; on mobile we collapse to a button that toggles
  // showing/hiding the full vertical filter list.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Active tab content + tab definition lookups
  const activeTabDef     = TABS.find(t => t.id === activeTab)!;
  const activeTabSkills  = filtered(buckets[activeTab]);
  const showRankBadges   = activeTab === 'trending';
  const showCreator      = activeTab === 'trending';

  return (
    <>
      {/* ─── Search bar — full width at top ─────────────────────────── */}
      <div className="mb-5 relative">
        <input
          type="search"
          placeholder="Search skills by name, description, trigger phrase, or vertical — try 'real estate'…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="input w-full pl-9"
          aria-label="Search skills"
        />
        <span
          aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 block w-4 h-4 bg-ink-400 pointer-events-none"
          style={{
            maskImage: "url(/icons/search.svg)",
            WebkitMaskImage: "url(/icons/search.svg)",
            maskSize: 'contain',
            WebkitMaskSize: 'contain',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
          }}
        />
      </div>

      {/* ─── Mobile filters toggle button — visible only on narrow ──── */}
      <div className="md:hidden mb-4">
        <button
          type="button"
          onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-ink-700 bg-ink-900 text-sm text-ink-200"
        >
          <span>
            Filters {activeTag && <span className="text-brand-500">· {labelFor(activeTag)}</span>}
          </span>
          <span aria-hidden="true" className="text-ink-400">{mobileFiltersOpen ? '↑' : '↓'}</span>
        </button>
      </div>

      {/* ─── 2-column layout: filters left, content right ────────────── */}
      <div className="md:grid md:grid-cols-[180px_1fr] md:gap-8">
        {/* ─── Left column — vertical filter list ───────────────────── */}
        <aside
          className={`${mobileFiltersOpen ? 'block' : 'hidden'} md:block mb-6 md:mb-0`}
          aria-label="Filter skills by category"
        >
          {tagCounts.length > 0 ? (
            <>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-medium mb-2 px-2">Filters</div>
              <ul className="space-y-0.5">
                <li>
                  <button
                    type="button"
                    onClick={() => { setActiveTag(null); setMobileFiltersOpen(false); }}
                    className={`w-full text-left text-sm px-2.5 py-1.5 rounded transition-colors flex items-center justify-between ${
                      !activeTag
                        ? 'bg-brand-500/15 text-brand-500 font-medium'
                        : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                    }`}
                  >
                    <span>All</span>
                    <span className="text-xs text-ink-400">{tagCounts.reduce((s, [, c]) => s + c, 0)}</span>
                  </button>
                </li>
                {tagCounts.map(([tag, count]) => (
                  <li key={tag}>
                    <button
                      type="button"
                      onClick={() => { setActiveTag(activeTag === tag ? null : tag); setMobileFiltersOpen(false); }}
                      className={`w-full text-left text-sm px-2.5 py-1.5 rounded transition-colors flex items-center justify-between ${
                        activeTag === tag
                          ? 'bg-brand-500/15 text-brand-500 font-medium'
                          : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                      }`}
                    >
                      <span className="truncate">{labelFor(tag)}</span>
                      <span className="text-xs text-ink-400 ml-2 shrink-0">{count}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {hasActiveFilter && (
                <button
                  onClick={() => { setQuery(''); setActiveTag(null); }}
                  className="mt-3 text-xs text-brand-500 hover:underline px-2.5"
                >
                  Clear filters
                </button>
              )}
            </>
          ) : (
            <div className="text-xs text-ink-500 px-2">No filter categories yet. Tags appear here as you save skills.</div>
          )}
        </aside>

        {/* ─── Right column — tabs + description + skills list ─────── */}
        <div className="min-w-0">
          {/* ─── Tab navigation (no scrollbar) ─────────────────────── */}
          <div className="border-b border-ink-700 mb-5" role="tablist">
            <div className="flex flex-wrap gap-1">
              {TABS.map((tab) => {
                const c = counts[tab.id];
                const isActive = activeTab === tab.id;
                const countText = hasActiveFilter && c.filtered !== c.total
                  ? `${c.filtered} of ${c.total}`
                  : `${c.total}`;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative px-3 md:px-4 py-2.5 text-sm transition-colors whitespace-nowrap border-b-2 -mb-px ${
                      isActive
                        ? 'border-brand-500 text-ink-50 font-medium'
                        : 'border-transparent text-ink-400 hover:text-ink-200'
                    }`}
                  >
                    {tab.label}{' '}
                    <span className={`ml-1 inline-flex items-center justify-center min-w-[1.5rem] h-5 rounded text-xs px-1.5 ${
                      isActive
                        ? 'bg-brand-500/20 text-brand-500 font-semibold'
                        : 'bg-ink-800 text-ink-400'
                    }`}>
                      {countText}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─── Active tab description ───────────────────────────── */}
          <p className="text-sm text-ink-300 mb-5 leading-relaxed">
            {activeTabDef.description}
          </p>

          {/* ─── Active tab content ───────────────────────────────── */}
          <section role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
            {activeTabSkills.length === 0 ? (
              <EmptyState
                tabId={activeTab}
                hasFilter={hasActiveFilter}
                onClearFilters={() => { setQuery(''); setActiveTag(null); }}
                filteredCountsByTab={{
                  yours:    counts.yours.filtered,
                  org:      counts.org.filtered,
                  trending: counts.trending.filtered,
                  base:     counts.base.filtered,
                }}
                onSwitchTab={setActiveTab}
                activeTagLabel={activeTag ? labelFor(activeTag) : null}
              />
            ) : (
              <ul className="space-y-2">
                {activeTabSkills.map((s, i) => (
                  <SkillRow
                    key={s.id}
                    skill={s}
                    rank={showRankBadges ? i + 1 : undefined}
                    showCreator={showCreator}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

// ─── Empty state per tab — different copy for each bucket ──────────────
// When a filter is active and the current tab has 0 matches, we want to
// help users find their results without forcing them to manually try
// every tab. Show match counts for OTHER tabs and let them switch with
// one click. This respects the user's primary navigation choice (the
// active tab) while making the filtered universe discoverable.
function EmptyState({
  tabId,
  hasFilter,
  onClearFilters,
  filteredCountsByTab,
  onSwitchTab,
  activeTagLabel,
}: {
  tabId:              TabId;
  hasFilter:          boolean;
  onClearFilters:     () => void;
  /** Map of tab id → number of matches IN THAT TAB with current filter
   * applied. Used to suggest tabs that DO have matches. */
  filteredCountsByTab?: Record<TabId, number>;
  onSwitchTab?:       (id: TabId) => void;
  /** Human-readable label of the active tag (if any) — used in copy
   * like "Found 3 Real Estate skills in Implexa Base Skills". */
  activeTagLabel?:    string | null;
}) {
  if (hasFilter && filteredCountsByTab && onSwitchTab) {
    // Find OTHER tabs (not the current one) that have matches
    const otherTabsWithMatches = TABS
      .filter(t => t.id !== tabId)
      .map(t => ({ tab: t, count: filteredCountsByTab[t.id] || 0 }))
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count);

    if (otherTabsWithMatches.length === 0) {
      // No matches anywhere — filter is too narrow for any tab
      return (
        <div className="card text-sm text-ink-400">
          No matches for {activeTagLabel ? <strong className="text-ink-200">{activeTagLabel}</strong> : 'your filter'} in any tab.{' '}
          <button onClick={onClearFilters} className="text-brand-500 hover:underline">Clear filters</button> to see everything.
        </div>
      );
    }

    // Found matches in other tabs — render as actionable suggestion
    return (
      <div className="card text-sm text-ink-300 space-y-3">
        <div>
          No matches in <strong className="text-ink-200">{TABS.find(t => t.id === tabId)?.label}</strong> for{' '}
          {activeTagLabel ? <strong className="text-ink-200">{activeTagLabel}</strong> : 'your filter'}.
          Found {otherTabsWithMatches.reduce((s, t) => s + t.count, 0)} {otherTabsWithMatches.reduce((s, t) => s + t.count, 0) === 1 ? 'match' : 'matches'} in other tabs:
        </div>
        <ul className="space-y-1.5">
          {otherTabsWithMatches.map(({ tab, count }) => (
            <li key={tab.id}>
              <button
                type="button"
                onClick={() => onSwitchTab(tab.id)}
                className="inline-flex items-center gap-2 text-brand-500 hover:underline font-medium"
              >
                <span aria-hidden="true">→</span>
                {tab.label}
                <span className="text-xs px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-500">{count}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="text-xs text-ink-500 pt-1 border-t border-ink-700">
          Or <button onClick={onClearFilters} className="text-brand-500 hover:underline">clear filters</button> to see all skills.
        </div>
      </div>
    );
  }

  // No filter active — tab is genuinely empty. Tab-specific empty copy.
  const messages: Record<TabId, React.ReactNode> = {
    yours: (
      <>
        You haven&apos;t saved any skills yet. In Claude, run{' '}
        <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded text-ink-100">/implexa:record-skill</code>{' '}
        to capture your first workflow — or fork a base Playbook below to get started fast.
      </>
    ),
    org: (
      <>
        No org-wide skills yet. When you or a teammate runs{' '}
        <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded text-ink-100">/implexa:share-this</code>{' '}
        with team scope, the skill lands here for everyone with your domain.
      </>
    ),
    trending: (
      <>
        Trending is still loading. Be the first to share a public skill via{' '}
        <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded text-ink-100">/implexa:share-this</code>{' '}
        publicly — you&apos;ll unlock the Founding Creator perk and instantly appear here.
      </>
    ),
    base: (
      <>
        Base Playbooks aren&apos;t seeded yet. If you&apos;re running self-hosted, run migrations{' '}
        <code className="text-xs">0006</code> and <code className="text-xs">0007</code> in Supabase Studio.
      </>
    ),
  };

  return <div className="card text-sm text-ink-400">{messages[tabId]}</div>;
}

// ─── Skill row — same component used across all tabs ────────────────────
function SkillRow({
  skill,
  rank,
  showCreator = false,
}: {
  skill:        Skill;
  /** When provided, render a rank badge (top-3 get medal styling).
   * Used by the Trending Globally tab to add gamification. */
  rank?:        number;
  /** Show "Shared by [name]" attribution. Used for Trending Globally
   * to surface community creators. */
  showCreator?: boolean;
}) {
  const stats = skill.outcome_stats || {};
  const visibleTags = (skill.tags || []).filter(t => !HIDDEN_TAGS.has(t)).slice(0, 3);
  const creatorName = skill.created_by?.displayName?.split(' ')[0] || null;

  const rankBadgeClass =
    rank === 1 ? 'bg-accent-400/20 text-accent-700 dark:text-accent-400 border border-accent-400/40'
    : rank === 2 ? 'bg-ink-700 text-ink-100 border border-ink-600'
    : rank === 3 ? 'bg-brand-500/15 text-brand-500 border border-brand-500/30'
    : 'bg-ink-800 text-ink-400';

  return (
    <li>
      <Link href={`/skills/${skill.slug}`} className="card flex items-center gap-4 py-4 hover:shadow-glow hover:border-brand-500/60 transition-all cursor-pointer">
        {rank !== undefined && (
          <div
            className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${rankBadgeClass}`}
            aria-label={`Rank ${rank}`}
          >
            {rank}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="font-medium text-ink-50">{skill.name}</div>
            {skill.status === 'draft' && <span className="text-xs px-1.5 py-0.5 rounded bg-accent-400/20 text-accent-700 dark:text-accent-400">draft</span>}
            {skill._source === 'installed' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-500 uppercase tracking-wide font-medium">
                Installed
              </span>
            )}
            <code className="text-xs text-ink-400 font-mono">{skill.slug}</code>
            {visibleTags.length > 0 && (
              <span className="flex gap-1 ml-1">
                {visibleTags.map(t => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-ink-800 text-ink-400 uppercase tracking-wide">{labelFor(t)}</span>
                ))}
              </span>
            )}
          </div>
          <div className="text-sm text-ink-300 mt-1 line-clamp-2">{skill.description}</div>
          {showCreator && creatorName && (
            <div className="text-[11px] text-ink-400 mt-1.5">
              Shared by <span className="text-ink-300 font-medium">{creatorName}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs whitespace-nowrap text-right">
            {(skill.usage_count || 0) > 0 && <div className="text-ink-300">{skill.usage_count} run{skill.usage_count === 1 ? '' : 's'}</div>}
            {(stats.attributedOutcomes || 0) > 0 && <div className="text-success-600 dark:text-success-400 font-semibold mt-0.5">{stats.attributedOutcomes} outcome{stats.attributedOutcomes === 1 ? '' : 's'}</div>}
          </div>
          <RunInClaudeButton
            skillSlug={skill.slug}
            triggerPhrases={skill.trigger_phrases || []}
            skillName={skill.name}
          />
        </div>
      </Link>
    </li>
  );
}
