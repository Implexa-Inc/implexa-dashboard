'use client';

/**
 * <AgentsList /> — the ONE canonical agents list: three sections (Scheduled,
 * On-demand, Not activated), one row shape, a category filter bar. Replaces the
 * old mix of Home cards + catalog merge that gave agents different link targets
 * and dumped "output" to the whole Results list.
 *
 * The server hands a normalized, already-merged array (active agents from the
 * /me/agents feed + built-but-never-activated from the user's library), so this
 * component is purely presentational + the client-side category filter.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

export type ListAgent = {
  slug: string;
  name: string;
  source: string;
  section: 'scheduled' | 'on_demand' | 'not_activated';
  category: { key: string; label: string; emoji: string };
  needsIntervention?: boolean;
  interventionReason?: string | null;
  pendingQuestions?: number;
  nextRunAt?: string | null;
  scheduleNl?: string | null;
  lastRun?: { id?: string; status: string; runState: string | null; ranAt: string } | null;
};

function rel(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  const fmt = (n: number, u: string) => `${Math.round(n)}${u}`;
  let body: string;
  if (abs < 3600) body = fmt(abs / 60, 'm');
  else if (abs < 86400) body = fmt(abs / 3600, 'h');
  else body = fmt(abs / 86400, 'd');
  return s >= 0 ? `in ${body}` : `${body} ago`;
}

function nextRunLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time} (${rel(iso)})`;
}

// The live state badge for an activated agent, from its last run.
function stateBadge(a: ListAgent): { label: string; cls: string } | null {
  const rs = a.lastRun?.runState;
  const st = a.lastRun?.status;
  if (rs === 'stalled') return { label: 'Stalled', cls: 'border-amber-500/50 text-amber-700 dark:text-amber-300' };
  if (st === 'failed' || rs === 'failed') return { label: 'Failed', cls: 'border-rose-500/50 text-rose-700 dark:text-rose-300' };
  if (st === 'partial') return { label: 'Partial', cls: 'border-amber-500/50 text-amber-700 dark:text-amber-300' };
  if (st === 'completed' || rs === 'completed') return { label: 'Ran ok', cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' };
  if (rs === 'running') return { label: 'Running', cls: 'border-sky-500/40 text-sky-700 dark:text-sky-300' };
  return null;
}

function Row({ a }: { a: ListAgent }) {
  const detail = `/workflows/${encodeURIComponent(a.slug)}?source=${encodeURIComponent(a.source)}`;
  const badge = a.section !== 'not_activated' ? stateBadge(a) : null;
  return (
    <li className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={detail} className="text-base font-medium text-ink-50 hover:underline">
              <span aria-hidden className="mr-1.5">{a.category.emoji}</span>{a.name}
            </Link>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-ink-700 text-ink-400">{a.category.label}</span>
            {a.section === 'not_activated' && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-sky-500/40 text-sky-700 dark:text-sky-300">Draft</span>
            )}
            {badge && <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>}
          </div>
          {/* status line */}
          <p className="text-xs text-ink-500 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {a.needsIntervention && (
              <span className="text-amber-600 dark:text-amber-400">Needs you · {a.interventionReason || 'one quick step'}</span>
            )}
            {(a.pendingQuestions ?? 0) > 0 && (
              <span className="text-amber-600 dark:text-amber-400">{a.pendingQuestions} question{a.pendingQuestions === 1 ? '' : 's'} to answer</span>
            )}
            {a.section === 'scheduled' && a.nextRunAt && !a.needsIntervention && (
              <span>Next run: {nextRunLabel(a.nextRunAt)}</span>
            )}
            {a.section === 'on_demand' && !a.needsIntervention && (a.pendingQuestions ?? 0) === 0 && <span>Runs on demand</span>}
            {a.section === 'not_activated' && <span>Saved as a draft · turn it on whenever you&apos;re ready</span>}
          </p>
        </div>

        <div className="flex-none flex items-center gap-2">
          {a.section === 'not_activated' ? (
            <Link href={`/workflows/${encodeURIComponent(a.slug)}/activate`} className="btn-success text-xs px-3 py-1.5">Activate</Link>
          ) : (
            <Link href={detail} className="btn-outline text-xs px-3 py-1.5">View</Link>
          )}
          {a.lastRun?.id && (
            <Link href={`/runs/${a.lastRun.id}`} className="text-xs text-ink-400 hover:text-ink-200 hover:underline whitespace-nowrap">Last output</Link>
          )}
        </div>
      </div>
    </li>
  );
}

function Section({ title, agents }: { title: string; agents: ListAgent[] }) {
  if (agents.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-ink-200 uppercase tracking-wider mb-3">{title} <span className="text-ink-500">({agents.length})</span></h2>
      <ul className="space-y-3">{agents.map((a) => <Row key={a.slug} a={a} />)}</ul>
    </section>
  );
}

export default function AgentsList({ agents }: { agents: ListAgent[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const activeCat = params.get('cat') || '';

  // Distinct categories present, for the filter bar.
  const categories = useMemo(() => {
    const m = new Map<string, { key: string; label: string; emoji: string; n: number }>();
    for (const a of agents) {
      const c = a.category;
      const e = m.get(c.key);
      if (e) e.n += 1; else m.set(c.key, { ...c, n: 1 });
    }
    return [...m.values()].sort((x, y) => y.n - x.n);
  }, [agents]);

  const shown = activeCat ? agents.filter((a) => a.category.key === activeCat) : agents;
  const scheduled = shown.filter((a) => a.section === 'scheduled');
  const onDemand = shown.filter((a) => a.section === 'on_demand');
  const notActivated = shown.filter((a) => a.section === 'not_activated');

  const setCat = (key: string) => {
    const p = new URLSearchParams(params.toString());
    if (key) p.set('cat', key); else p.delete('cat');
    router.replace(`/workflows${p.toString() ? `?${p.toString()}` : ''}`, { scroll: false });
  };

  return (
    <>
      {categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-7">
          <button
            type="button"
            onClick={() => setCat('')}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${!activeCat ? 'border-brand-500/50 bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'border-ink-700 text-ink-400 hover:text-ink-200'}`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCat(activeCat === c.key ? '' : c.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${activeCat === c.key ? 'border-brand-500/50 bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'border-ink-700 text-ink-400 hover:text-ink-200'}`}
            >
              <span aria-hidden className="mr-1">{c.emoji}</span>{c.label} <span className="text-ink-600">{c.n}</span>
            </button>
          ))}
        </div>
      )}

      <Section title="Scheduled" agents={scheduled} />
      <Section title="On-demand" agents={onDemand} />
      <Section title="Drafts" agents={notActivated} />

      {shown.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-ink-100 font-medium text-sm">{activeCat ? 'No agents in this category.' : 'No agents yet.'}</p>
          <p className="text-xs text-ink-500 mt-1">
            {activeCat
              ? <button type="button" onClick={() => setCat('')} className="text-brand-500 hover:underline">Clear filter</button>
              : <>Describe one on <Link href="/overview" className="text-brand-500 hover:underline">Home</Link> and Implexa builds it.</>}
          </p>
        </div>
      )}
    </>
  );
}
