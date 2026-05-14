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
    description: 'Skills you\'ve personally authored. Edit, share, or invoke them anytime — your originals plus any forks you\'ve customized. (Your shared skills also appear in Org-wide and Trending Globally below.)',
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
  currentUserId,
  currentOrgId,
}: {
  orgSkills:        Skill[];
  systemSkills:     Skill[];
  universalSkills?: Skill[];
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
    // another. A skill should never appear in both result sets, but
    // collect into a Map for safety (and to allow client-side merging if
    // we ever consolidate the queries).
    const all = new Map<string, Skill>();
    for (const s of orgSkills)       all.set(s.id, s);
    for (const s of systemSkills)    all.set(s.id, s);
    for (const s of universalSkills) all.set(s.id, s);

    const yours:    Skill[] = [];
    const org:      Skill[] = [];
    const trending: Skill[] = [];
    const base:     Skill[] = [];

    for (const s of all.values()) {
      const isMine    = s.created_by?.userId === currentUserId;
      const isMyOrg   = s.organization_id === currentOrgId;
      const isOrgScope       = s.scope === 'org';
      const isUniversalScope = s.scope === 'universal';
      const isSystemScope    = s.scope === 'system';

      // Your skills: anything you authored, regardless of scope
      if (isMine) yours.push(s);

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

    return { yours, org, trending, base };
  }, [orgSkills, systemSkills, universalSkills, currentUserId, currentOrgId]);

  // ─── Filter universe — search + tag ──────────────────────────────────
  const matchesSearch = (s: Skill): boolean => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const haystack = [
      s.name,
      s.description || '',
      s.slug,
      ...(s.trigger_phrases || []),
      ...(s.tags || []),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
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

  // ─── Tag pill universe — from system + universal + org (everything
  //     visible to this user) so filtering still feels comprehensive
  //     across tabs. The buckets are mutually exclusive but the pill
  //     vocabulary is shared.
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    const allVisible = [...buckets.yours, ...buckets.org, ...buckets.trending, ...buckets.base];
    for (const s of allVisible) {
      for (const t of s.tags || []) {
        if (HIDDEN_TAGS.has(t)) continue;
        m.set(t, (m.get(t) || 0) + 1);
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [buckets]);

  // Active tab content + tab definition lookups
  const activeTabDef     = TABS.find(t => t.id === activeTab)!;
  const activeTabSkills  = filtered(buckets[activeTab]);
  const showRankBadges   = activeTab === 'trending';
  const showCreator      = activeTab === 'trending';

  return (
    <>
      {/* ─── Search + tag-filter row (shared across all tabs) ─────────── */}
      <div className="mb-5 space-y-3">
        <div className="relative">
          <input
            type="search"
            placeholder="Search skills by name, description, or trigger phrase…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="input w-full pl-9"
            aria-label="Search skills"
          />
          <span
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 block w-4 h-4 bg-ink-400"
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

        {tagCounts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-ink-500 mr-1">Filter:</span>
            <button
              type="button"
              onClick={() => setActiveTag(null)}
              className={`text-xs px-2 py-1 rounded-full transition-colors ${
                !activeTag
                  ? 'bg-brand-500 text-ink-950 font-medium'
                  : 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-ink-100'
              }`}
            >
              All
            </button>
            {tagCounts.map(([tag, count]) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`text-xs px-2 py-1 rounded-full transition-colors ${
                  activeTag === tag
                    ? 'bg-brand-500 text-ink-950 font-medium'
                    : 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-ink-100'
                }`}
              >
                {labelFor(tag)} <span className="text-ink-400">{count}</span>
              </button>
            ))}
          </div>
        )}

        {hasActiveFilter && (
          <div className="text-xs text-ink-400">
            <button onClick={() => { setQuery(''); setActiveTag(null); }} className="text-brand-500 hover:underline">
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* ─── Tab navigation ────────────────────────────────────────────
        * Horizontal scrollable on narrow viewports; sticky-bottom-border
        * indicates the active tab. Counts update live based on the
        * search + tag filter — shows "(3 of 5)" when filtered, plain
        * "(5)" otherwise.
        */}
      <div className="border-b border-ink-700 mb-5 overflow-x-auto" role="tablist">
        <div className="flex gap-1 min-w-max">
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
                className={`relative px-4 py-2.5 text-sm transition-colors whitespace-nowrap border-b-2 -mb-px ${
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

      {/* ─── Active tab description ──────────────────────────────────── */}
      <p className="text-sm text-ink-300 mb-5 leading-relaxed max-w-3xl">
        {activeTabDef.description}
      </p>

      {/* ─── Active tab content ──────────────────────────────────────── */}
      <section role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
        {activeTabSkills.length === 0 ? (
          <EmptyState tabId={activeTab} hasFilter={hasActiveFilter} onClearFilters={() => { setQuery(''); setActiveTag(null); }} />
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
    </>
  );
}

// ─── Empty state per tab — different copy for each bucket ───────────────
function EmptyState({ tabId, hasFilter, onClearFilters }: { tabId: TabId; hasFilter: boolean; onClearFilters: () => void }) {
  if (hasFilter) {
    return (
      <div className="card text-sm text-ink-400">
        No matches in this tab. <button onClick={onClearFilters} className="text-brand-500 hover:underline">Clear filters</button> or try a different tab.
      </div>
    );
  }

  // Tab-specific empty copy
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
    rank === 1 ? 'bg-accent-400/20 text-accent-400 border border-accent-400/40'
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
            {skill.status === 'draft' && <span className="text-xs px-1.5 py-0.5 rounded bg-accent-400/20 text-accent-400">draft</span>}
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
            {(stats.attributedOutcomes || 0) > 0 && <div className="text-success-400 font-semibold mt-0.5">{stats.attributedOutcomes} outcome{stats.attributedOutcomes === 1 ? '' : 's'}</div>}
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
