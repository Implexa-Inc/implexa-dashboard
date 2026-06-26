'use client';

/**
 * <CommunityAgents /> — browse + search the public agent catalog from inside the
 * dashboard. The website has a community catalog; the dashboard didn't, so a new
 * user with zero agents had no way to DISCOVER one — only the build box. This is
 * that missing surface: search the proven agents others run, see the real
 * activity signals (on autopilot / runs — graded on what actually happened, not
 * a benchmark), and open one to activate it on your own Claude.
 *
 * Pure client filter over a server-fetched WorkflowCard[] (the catalog is small
 * + cached 1h upstream). "Use this" links to the agent's detail page, where the
 * existing activate flow takes over — no new adopt path to maintain here.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { WorkflowCard } from '@/lib/workflow-catalog';

// People on autopilot count most (a standing schedule is the strongest proof),
// then real runs. Curated agents float up on ties. Mirrors the website ranking.
function popularity(w: WorkflowCard): number {
  return w.scheduled_count * 3 + w.run_count + (w.curated ? 1 : 0);
}
function proofLine(w: WorkflowCard): string | null {
  if (w.scheduled_count > 0) return `${w.scheduled_count} on autopilot`;
  if (w.run_count > 0) return `run ${w.run_count}×`;
  return null;
}

export default function CommunityAgents({ agents }: { agents: WorkflowCard[] }) {
  const [query, setQuery] = useState('');

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (w: WorkflowCard) =>
      !q ||
      `${w.name} ${w.description} ${w.primary_outcome ?? ''} ${w.vertical ?? ''}`.toLowerCase().includes(q);
    return agents.filter(matches).sort((a, b) => popularity(b) - popularity(a));
  }, [agents, query]);

  if (!agents.length) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-ink-50">Start from a proven agent</h2>
          <p className="text-sm text-ink-400 mt-0.5">
            Agents the community already runs. Pick one and it’s yours — running on your own Claude.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents…"
          className="w-full sm:w-64 bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none"
        />
      </div>

      {ranked.length === 0 ? (
        <p className="text-sm text-ink-500 py-8 text-center">No agents match “{query}”. Try the build box above to make one.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ranked.map((w) => {
            const proof = proofLine(w);
            return (
              <Link
                key={`${w.source}:${w.slug}`}
                href={`/workflows/${encodeURIComponent(w.slug)}?source=${encodeURIComponent(w.source)}`}
                className="card !p-4 flex flex-col gap-2 hover:border-brand-500/50 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink-50 leading-snug group-hover:text-brand-400 transition-colors">
                    {w.name}
                  </h3>
                  {w.curated && (
                    <span className="flex-none text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-brand-500/40 text-brand-400">
                      curated
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-400 leading-relaxed line-clamp-2">{w.description}</p>
                <div className="mt-auto flex items-center gap-2 flex-wrap pt-1">
                  {w.cadence && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-ink-700 text-amber-600 dark:text-amber-300">
                      {w.cadence}
                    </span>
                  )}
                  {proof
                    ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ {proof}</span>
                    : <span className="text-[11px] text-ink-500">new</span>}
                  <span className="ml-auto text-[11px] text-brand-500 group-hover:underline">Use this →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
