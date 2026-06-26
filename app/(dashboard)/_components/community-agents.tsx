'use client';

/**
 * <CommunityAgents /> — browse the public agent catalog. Two modes:
 *   - full (default): search + category filter + the whole ranked grid. Used on
 *     the dedicated /browse page and /create.
 *   - preview (`limit` set): top-N cards, no controls, + a "See all" link. Used
 *     on Home so a new user sees proven agents without leaving the page.
 *
 * Ranks by activity (people on autopilot, then runs) — the honest proof signal we
 * have today. Category is derived per-card (categorizeAgent). NOTE: a true
 * "delivered %" sort needs the per-agent grade wired into the catalog feed (a
 * backend score-join) — tracked as a follow-up; until then proof = autopilot/runs.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { WorkflowCard } from '@/lib/workflow-catalog';
import { categorizeAgent } from '@/lib/agent-category';

function popularity(w: WorkflowCard): number {
  return w.scheduled_count * 3 + w.run_count + (w.curated ? 1 : 0);
}
function proofLine(w: WorkflowCard): string | null {
  if (w.scheduled_count > 0) return `${w.scheduled_count} on autopilot`;
  if (w.run_count > 0) return `run ${w.run_count}×`;
  return null;
}
function catOf(w: WorkflowCard) {
  return categorizeAgent([w.name, w.description, w.primary_outcome, w.vertical]);
}

function Card({ w }: { w: WorkflowCard }) {
  const proof = proofLine(w);
  return (
    <Link
      href={`/workflows/${encodeURIComponent(w.slug)}?source=${encodeURIComponent(w.source)}`}
      className="card !p-4 flex flex-col gap-2 hover:border-brand-500/50 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-50 leading-snug group-hover:text-brand-400 transition-colors">{w.name}</h3>
        {w.curated && (
          <span className="flex-none text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-brand-500/40 text-brand-400">curated</span>
        )}
      </div>
      <p className="text-xs text-ink-400 leading-relaxed line-clamp-2">{w.description}</p>
      <div className="mt-auto flex items-center gap-2 flex-wrap pt-1">
        {w.cadence && (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-ink-700 text-amber-600 dark:text-amber-300">{w.cadence}</span>
        )}
        {proof
          ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ {proof}</span>
          : <span className="text-[11px] text-ink-500">new</span>}
        <span className="ml-auto text-[11px] text-brand-500 group-hover:underline">Use this →</span>
      </div>
    </Link>
  );
}

export default function CommunityAgents({
  agents,
  limit,
  heading = 'Start from a proven agent',
  blurb = 'Agents the community already runs. Pick one and it’s yours — running on your own Claude.',
  seeAllHref = '/browse',
}: {
  agents: WorkflowCard[];
  limit?: number;
  heading?: string;
  blurb?: string;
  seeAllHref?: string;
}) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string>('all');
  const preview = typeof limit === 'number';

  // The category chips present in the catalog (so we never show an empty filter).
  const cats = useMemo(() => {
    const m = new Map<string, { key: string; label: string; emoji: string }>();
    for (const w of agents) { const c = catOf(w); if (!m.has(c.key)) m.set(c.key, c); }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [agents]);

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = agents
      .filter((w) => (cat === 'all' || catOf(w).key === cat))
      .filter((w) => !q || `${w.name} ${w.description} ${w.primary_outcome ?? ''} ${w.vertical ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => popularity(b) - popularity(a));
    return preview ? list.slice(0, limit) : list;
  }, [agents, query, cat, preview, limit]);

  if (!agents.length) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-ink-50">{heading}</h2>
          <p className="text-sm text-ink-400 mt-0.5">{blurb}</p>
        </div>
        {preview
          ? <Link href={seeAllHref} className="text-sm text-brand-500 hover:underline flex-none">See all →</Link>
          : (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search agents…"
              className="w-full sm:w-64 bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none"
            />
          )}
      </div>

      {/* Category filter (full mode only) */}
      {!preview && cats.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {[{ key: 'all', label: 'All', emoji: '✶' }, ...cats].map((c) => (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${cat === c.key ? 'border-brand-500/60 bg-brand-500/10 text-brand-400' : 'border-ink-700 text-ink-400 hover:text-ink-200'}`}
            >
              <span aria-hidden className="mr-1">{c.emoji}</span>{c.label}
            </button>
          ))}
        </div>
      )}

      {ranked.length === 0 ? (
        <p className="text-sm text-ink-500 py-8 text-center">No agents match. Try the build box to make one.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ranked.map((w) => <Card key={`${w.source}:${w.slug}`} w={w} />)}
        </div>
      )}
    </section>
  );
}
