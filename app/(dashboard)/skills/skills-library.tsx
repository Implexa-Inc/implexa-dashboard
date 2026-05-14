'use client';

/**
 * Interactive skills library — search + tag-based category filtering.
 *
 * Server fetches all visible skills (RLS gates per user); this client
 * component handles the in-memory filter UX. Why client-side filter?
 * - List is capped at 100 skills total, filtering is sub-millisecond.
 * - No round-trips per keystroke / pill click — feels instant.
 * - Server cost is one query regardless of how the user explores.
 *
 * Categorization model:
 *   System Playbooks carry tags like ['gtm','sales','base-playbook'] etc.
 *   Instead of hardcoding a tag→category map (which goes stale as we add
 *   verticals), we surface the tag taxonomy directly as filter pills.
 *   The user clicks pills to narrow; the URL stays clean (no params).
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
};

// Tags we hide from the filter pill bar — internal metadata, not user-facing
// categories. Keeps the pill list focused on actual verticals/uses.
const HIDDEN_TAGS = new Set([
  'base-playbook', 'hand-seeded', 'horizontal', 'atomic', 'composite',
  'medium', 'short', 'system', 'active', 'hex',
]);

// Friendly labels for known vertical tags. Anything not in this map renders
// with its raw tag (lowercase) — graceful for new tags we haven't pre-labeled.
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
}: {
  orgSkills:        Skill[];
  systemSkills:     Skill[];
  /** Cross-org public skills — the "Trending globally" Founding Creator surface.
   * Sorted by usage_count desc upstream so most-popular floats to top. */
  universalSkills?: Skill[];
}) {
  const [query,      setQuery]     = useState('');
  const [activeTag,  setActiveTag] = useState<string | null>(null);

  // Build the tag universe from system + universal skills (those carry the
  // richest taxonomy). Counts let us order pills by popularity — most-used
  // categories first. Org skills excluded — they often have user-specific
  // tags that aren't useful for cross-skill browsing.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of [...systemSkills, ...universalSkills]) {
      for (const t of s.tags || []) {
        if (HIDDEN_TAGS.has(t)) continue;
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [systemSkills, universalSkills]);

  // Search filter: matches name, description, slug, trigger phrases, or tags.
  // Case-insensitive substring match — simple but effective at this scale.
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

  const filteredOrg       = orgSkills.filter(s => matchesSearch(s) && matchesTag(s));
  const filteredSystem    = systemSkills.filter(s => matchesSearch(s) && matchesTag(s));
  const filteredUniversal = universalSkills.filter(s => matchesSearch(s) && matchesTag(s));
  const totalMatches      = filteredOrg.length + filteredSystem.length + filteredUniversal.length;
  const hasActiveFilter   = !!query.trim() || !!activeTag;

  return (
    <>
      {/* Search + tag filter row */}
      <div className="mb-6 space-y-3">
        <div className="relative">
          <input
            type="search"
            placeholder="Search skills by name, description, or trigger phrase…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="input w-full pl-9"
            aria-label="Search skills"
          />
          {/* Search icon — uses brand SVG via mask-image for currentColor support */}
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
            {totalMatches === 0 ? (
              <>No skills match — try a different search or clear filters.</>
            ) : (
              <>{totalMatches} skill{totalMatches === 1 ? '' : 's'} match. <button onClick={() => { setQuery(''); setActiveTag(null); }} className="text-brand-500 hover:underline">Clear filters</button></>
            )}
          </div>
        )}
      </div>

      {/* Your org's skills — hidden during filter if empty post-filter */}
      {(filteredOrg.length > 0 || (!hasActiveFilter && orgSkills.length === 0)) && (
        <section className="mb-10">
          <h2 className="text-lg font-medium mb-3 flex items-baseline gap-2">
            Your org&apos;s skills
            <span className="text-xs text-ink-500 font-normal">({filteredOrg.length}{hasActiveFilter ? ` of ${orgSkills.length}` : ''})</span>
          </h2>
          {filteredOrg.length === 0 ? (
            <div className="card text-sm text-ink-500">
              No skills saved yet. In Claude Code, run <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded text-ink-100">/implexa:record-skill</code> to capture your first workflow.
            </div>
          ) : (
            <ul className="space-y-2">{filteredOrg.map(s => <SkillRow key={s.id} skill={s} />)}</ul>
          )}
        </section>
      )}

      {/* Trending globally — universal (public, cross-org, PII-scrubbed) skills.
       * Only render if at least one exists, or if a filter is active (to avoid
       * a confusing empty section on a fresh account before anyone has shared). */}
      {(filteredUniversal.length > 0 || (hasActiveFilter && universalSkills.length > 0)) && (
        <section className="mb-10">
          <h2 className="text-lg font-medium mb-3 flex items-baseline gap-2">
            <span aria-hidden="true">🔥</span> Trending globally
            <span className="text-xs text-ink-500 font-normal">
              ({filteredUniversal.length}{hasActiveFilter ? ` of ${universalSkills.length}` : ''}) — community-shared skills, fork &amp; customize
            </span>
          </h2>
          {filteredUniversal.length === 0 ? (
            <div className="card text-sm text-ink-500">
              No matches in trending. Try the <button onClick={() => { setQuery(''); setActiveTag(null); }} className="text-brand-500 hover:underline">All</button> filter.
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredUniversal.map((s, i) => (
                <SkillRow key={s.id} skill={s} rank={i + 1} showCreator />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Base Playbooks */}
      <section>
        <h2 className="text-lg font-medium mb-3 flex items-baseline gap-2">
          Base Playbooks
          <span className="text-xs text-ink-500 font-normal">
            ({filteredSystem.length}{hasActiveFilter ? ` of ${systemSkills.length}` : ''}) — horizontal library, fork &amp; customize
          </span>
        </h2>
        {filteredSystem.length === 0 ? (
          <div className="card text-sm text-ink-500">
            {hasActiveFilter
              ? <>No Playbooks match. Try the <button onClick={() => { setQuery(''); setActiveTag(null); }} className="text-brand-500 hover:underline">All</button> filter.</>
              : <>Playbooks not yet seeded. If you&apos;re seeing this, run migrations 0006 + 0007 in Supabase Studio against your prod database.</>}
          </div>
        ) : (
          <ul className="space-y-2">{filteredSystem.map(s => <SkillRow key={s.id} skill={s} />)}</ul>
        )}
      </section>
    </>
  );
}

function SkillRow({
  skill,
  rank,
  showCreator = false,
}: {
  skill:        Skill;
  /** When provided, render a rank badge (top-3 get medal styling).
   * Used by the Trending Globally section to add gamification. */
  rank?:        number;
  /** Show creator attribution — used for universal skills to highlight
   * who shared them publicly (the Founding Creator). Hidden by default
   * for org skills (already-known author) and system skills (Implexa). */
  showCreator?: boolean;
}) {
  const stats = skill.outcome_stats || {};
  const visibleTags = (skill.tags || []).filter(t => !HIDDEN_TAGS.has(t)).slice(0, 3);
  const creatorName = skill.created_by?.displayName?.split(' ')[0] || null;

  // Top-3 rank badges get medal styling. The brand color reinforces "this is
  // a noticeable position" without making it screaming-loud.
  const rankBadgeClass =
    rank === 1 ? 'bg-accent-400/20 text-accent-400 border border-accent-400/40'  // gold
    : rank === 2 ? 'bg-ink-700 text-ink-100 border border-ink-600'                 // silver
    : rank === 3 ? 'bg-brand-500/15 text-brand-500 border border-brand-500/30'    // bronze
    : 'bg-ink-800 text-ink-400';                                                  // numerical

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
