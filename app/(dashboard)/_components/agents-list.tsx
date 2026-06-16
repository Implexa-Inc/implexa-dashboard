'use client';

/**
 * <AgentsList /> — the ONE canonical agents list: three sections (Scheduled,
 * On-demand, Not activated), one row shape, a category filter bar. Replaces the
 * old mix of Home cards + catalog merge that gave agents different link targets
 * and dumped "output" to the whole Results list.
 *
 * The server hands a normalized, already-merged array (active agents from the
 * /me/agents feed + built-but-never-activated from the user's library), plus the
 * user's ARCHIVED agents (removed from their list). Archiving is a per-user
 * soft-hide: it calls POST /me/workflows/dismiss, which hides the agent from
 * THIS user only and NEVER deletes the shared/universal agent (others keep it).
 * Reversible from the Archived section (DELETE /me/workflows/dismiss).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

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

export type ArchivedAgent = { slug: string; name: string; source: string };

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

function Row({ a, onArchive, onRename, busy }: { a: ListAgent; onArchive: (a: ListAgent) => void; onRename: (slug: string, name: string) => Promise<void>; busy: boolean }) {
  const detail = `/workflows/${encodeURIComponent(a.slug)}?source=${encodeURIComponent(a.source)}`;
  const badge = a.section !== 'not_activated' ? stateBadge(a) : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.name);
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = draft.trim();
    if (next.length < 2 || next === a.name) { setEditing(false); setDraft(a.name); return; }
    setSaving(true);
    try { await onRename(a.slug, next); setEditing(false); }
    finally { setSaving(false); }
  }

  return (
    <li className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap group">
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(a.name); setEditing(false); } }}
                maxLength={120}
                disabled={saving}
                className="text-base font-medium bg-ink-900 border border-ink-600 rounded px-2 py-0.5 text-ink-50 focus:border-brand-500/60 focus:outline-none min-w-[220px]"
              />
            ) : (
              <Link href={detail} className="text-base font-medium text-ink-50 hover:underline">
                <span aria-hidden className="mr-1.5">{a.category.emoji}</span>{a.name}
              </Link>
            )}
            {!editing && (
              <button
                type="button"
                onClick={() => { setDraft(a.name); setEditing(true); }}
                aria-label={`Rename ${a.name}`}
                title="Rename (your view only)"
                className="text-ink-500 hover:text-ink-200 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✎
              </button>
            )}
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
          {/* Archive = remove from MY list (never deletes the shared agent). */}
          <button
            type="button"
            onClick={() => onArchive(a)}
            disabled={busy}
            title="Remove this agent from your list (it stays available to everyone, and you can restore it)"
            aria-label={`Archive ${a.name}`}
            className="text-xs text-ink-500 hover:text-rose-600 dark:hover:text-rose-300 disabled:opacity-50 whitespace-nowrap"
          >
            {busy ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </div>
    </li>
  );
}

function Section({ title, agents, onArchive, onRename, busySlug }: { title: string; agents: ListAgent[]; onArchive: (a: ListAgent) => void; onRename: (slug: string, name: string) => Promise<void>; busySlug: string | null }) {
  if (agents.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-ink-200 uppercase tracking-wider mb-3">{title} <span className="text-ink-500">({agents.length})</span></h2>
      <ul className="space-y-3">{agents.map((a) => <Row key={a.slug} a={a} onArchive={onArchive} onRename={onRename} busy={busySlug === a.slug} />)}</ul>
    </section>
  );
}

export default function AgentsList({ agents, archived = [] }: { agents: ListAgent[]; archived?: ArchivedAgent[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  // Local copies so archive/restore update instantly (the backend already
  // filters dismissed agents out of the feeds, so an optimistic move is safe).
  const [list, setList] = useState<ListAgent[]>(agents);
  const [arch, setArch] = useState<ArchivedAgent[]>(archived);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const activeCat = params.get('cat') || '';

  async function archive(a: ListAgent) {
    setBusySlug(a.slug);
    setError(null);
    const prevList = list;
    const prevArch = arch;
    // Optimistic: drop from the list, add to Archived.
    setList(list.filter((x) => x.slug !== a.slug));
    setArch([{ slug: a.slug, name: a.name, source: a.source }, ...arch.filter((x) => x.slug !== a.slug)]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/workflows/dismiss', {
        jwt: session?.access_token, method: 'POST', body: { slug: a.slug },
      });
    } catch (e) {
      setList(prevList);
      setArch(prevArch);
      setError(e instanceof Error ? e.message : 'Could not archive that agent');
    } finally {
      setBusySlug(null);
    }
  }

  async function rename(slug: string, name: string) {
    setError(null);
    const prevList = list;
    // Optimistic: update the row's name in place.
    setList(list.map((x) => (x.slug === slug ? { ...x, name } : x)));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/workflows/rename', {
        jwt: session?.access_token, method: 'POST', body: { slug, name },
      });
    } catch (e) {
      setList(prevList);
      setError(e instanceof Error ? e.message : 'Could not rename that agent');
    }
  }

  async function restore(slug: string) {
    setBusySlug(slug);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/workflows/dismiss', {
        jwt: session?.access_token, method: 'DELETE', body: { slug },
      });
      setArch(arch.filter((x) => x.slug !== slug));
      // Re-fetch the server feed so the restored agent comes back with its full
      // row (status, next run, last output) rather than a stub.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore that agent');
    } finally {
      setBusySlug(null);
    }
  }

  // Distinct categories present, for the filter bar.
  const categories = useMemo(() => {
    const m = new Map<string, { key: string; label: string; emoji: string; n: number }>();
    for (const a of list) {
      const c = a.category;
      const e = m.get(c.key);
      if (e) e.n += 1; else m.set(c.key, { ...c, n: 1 });
    }
    return [...m.values()].sort((x, y) => y.n - x.n);
  }, [list]);

  const shown = activeCat ? list.filter((a) => a.category.key === activeCat) : list;
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
      {error && <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">{error}</p>}

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

      <Section title="Scheduled" agents={scheduled} onArchive={archive} onRename={rename} busySlug={busySlug} />
      <Section title="On-demand" agents={onDemand} onArchive={archive} onRename={rename} busySlug={busySlug} />
      <Section title="Drafts" agents={notActivated} onArchive={archive} onRename={rename} busySlug={busySlug} />

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

      {/* Archived — per-user hidden agents, restorable. The shared agents are
          untouched; this is just the caller's view. */}
      {arch.length > 0 && (
        <section className="mt-10 pt-6 border-t border-ink-800">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs uppercase tracking-wider text-ink-500 hover:text-ink-300 flex items-center gap-1.5"
          >
            <span className={`inline-block transition-transform ${showArchived ? 'rotate-90' : ''}`}>▸</span>
            Archived ({arch.length})
          </button>
          {showArchived && (
            <ul className="space-y-2 mt-3">
              {arch.map((a) => (
                <li key={a.slug} className="card flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm text-ink-300 truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => restore(a.slug)}
                    disabled={busySlug === a.slug}
                    className="text-xs btn-outline px-3 py-1 disabled:opacity-50 whitespace-nowrap"
                  >
                    {busySlug === a.slug ? 'Restoring…' : 'Restore'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
