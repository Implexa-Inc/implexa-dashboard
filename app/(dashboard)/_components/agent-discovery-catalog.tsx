'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { DiscoveredAgent } from '@/lib/agent-discovery';

function searchable(agent: DiscoveredAgent): string {
  return [agent.name, agent.job, agent.audience, agent.builder.name, ...(agent.capabilities || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function AgentDiscoveryCatalog({
  agents,
  unavailable = null,
}: {
  agents: DiscoveredAgent[];
  unavailable?: string | null;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? agents.filter((agent) => searchable(agent).includes(needle)) : agents;
  }, [agents, query]);

  if (unavailable) {
    return (
      <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-4 text-sm text-amber-200">
        <p className="font-medium">Proven agents are unavailable right now</p>
        <p className="mt-1 text-amber-200/80">{unavailable} No agent can be hired until its exact version and readiness are verified.</p>
      </div>
    );
  }

  if (!agents.length) {
    return <p role="status" className="text-sm text-ink-500">No admitted agents are available to hire yet.</p>;
  }

  return (
    <section aria-labelledby="proven-agent-heading">
      <h2 id="proven-agent-heading" className="text-lg font-semibold text-ink-50">Start from a proven agent</h2>
      <p className="mt-1 text-sm text-ink-400">Only reviewed, exact-version agents appear here. Open one to inspect its evidence, requirements, and free-audition terms before hiring it.</p>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search admitted agents…"
        aria-label="Search admitted agents"
        className="mt-5 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none"
      />
      <ul className="mt-5 grid gap-4 md:grid-cols-2">
        {shown.map((agent) => (
          <li key={`${agent.id}:${agent.version.id}`} className="card flex flex-col gap-3 !p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold text-ink-50">{agent.name}</h3>
              <span className="rounded border border-sky-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">{agent.readiness.state}</span>
            </div>
            <p className="text-sm text-ink-300">{agent.job}</p>
            <p className="text-xs text-ink-500">Built by {agent.builder.name} · exact version {agent.version.number}</p>
            {agent.audition && agent.audition.allowance > 0 && (
              <p className="text-xs text-emerald-400">Free audition offered · buyer-owned provider usage</p>
            )}
            <Link href={`/workflows/${encodeURIComponent(agent.slug)}`} className="btn-primary mt-auto self-start px-4 py-2 text-sm">
              View &amp; use this agent
            </Link>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p role="status" className="mt-5 text-sm text-ink-500">No admitted agents match that search.</p>}
    </section>
  );
}
