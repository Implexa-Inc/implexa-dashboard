'use client';

/**
 * <AgentsList /> — the ONE canonical agents list. Three DATA sections come from
 * the server (scheduled / on_demand / not_activated / paused — a2026-06 build),
 * but 2026-07-01 (Codex's design audit) merges them into what the OWNER actually
 * thinks in: Needs setup / Active / Paused. "Scheduled vs on-demand" is
 * implementation detail — it now reads as a small status line on the row
 * ("Next run: Mon 9am" vs "Runs on demand") instead of splitting the roster.
 *
 * The server hands a normalized, already-merged array (active agents from the
 * /me/agents feed + built-but-never-activated from the user's library), plus the
 * user's ARCHIVED agents (removed from their list). Archiving is a per-user
 * soft-hide: it calls POST /me/workflows/dismiss, which hides the agent from
 * THIS user only and NEVER deletes the shared/universal agent (others keep it).
 * Reversible from the Archived section (DELETE /me/workflows/dismiss).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import GradeBadge from './grade-badge';

// 2026-07-01 simplification (Codex's design audit): a row of 3 mystery icon
// buttons (Eye/Note/Bin) reads as a technical control panel. Each row now has
// ONE clear primary action in words (Fix / View last result / Open / Activate /
// Resume) plus rename (the pencil next to the name, unchanged) and archive
// tucked behind a small "..." menu — a normal user never needs archive at a
// glance, but it must stay reachable.
function DotsIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

/** Small "..." overflow menu — today just Archive. Closes on outside click / Escape. */
function RowMenu({ onArchive, busy }: { onArchive: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid place-items-center h-8 w-8 rounded-md text-ink-500 hover:text-ink-100 hover:bg-ink-800 transition-colors"
      >
        <DotsIcon />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-md border border-ink-700 bg-ink-900 py-1 shadow-lg">
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => { setOpen(false); onArchive(); }}
            className="w-full text-left px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800 hover:text-rose-500 dark:hover:text-rose-300 disabled:opacity-50"
          >
            {busy ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      )}
    </div>
  );
}

export type ListAgent = {
  slug: string;
  name: string;
  source: string;
  section: 'scheduled' | 'on_demand' | 'not_activated' | 'paused';
  category: { key: string; label: string; emoji: string };
  needsIntervention?: boolean;
  interventionReason?: string | null;
  pendingQuestions?: number;
  nextRunAt?: string | null;
  scheduleNl?: string | null;
  lastRun?: { id?: string; status: string; runState: string | null; ranAt: string } | null;
  grade?: { hasGrade: boolean; rate: number; label: 'reliable' | 'mixed' | 'unproven'; runs: number; confidence: number } | null;
  /** True when this agent chains other agents (its name reads "A → B"). Shown as a ⛓ Chain tag. */
  isChain?: boolean;
};

// A chain agent's name is the leaf names joined by an arrow (createChainWorkflow).
export function looksLikeChain(name: string): boolean {
  return /→|->/.test(name || '');
}

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

function Row({ a, onArchive, onRename, busy, spotlight = false }: { a: ListAgent; onArchive: (a: ListAgent) => void; onRename: (slug: string, name: string) => Promise<void>; busy: boolean; spotlight?: boolean }) {
  const detail = `/workflows/${encodeURIComponent(a.slug)}?source=${encodeURIComponent(a.source)}`;
  // In the activity spotlight the row title opens the RUN status/live page; in the
  // roster it opens the agent's detail/setup page. Same agent, two doors.
  const titleHref = spotlight && a.lastRun?.id ? `/runs/${a.lastRun.id}` : detail;
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
              <Link href={titleHref} className="text-base font-medium text-ink-50 hover:underline">
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
            {a.section === 'scheduled' && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-700 dark:text-emerald-300" title="Runs automatically on a schedule">⏰ Scheduled</span>
            )}
            {(a.isChain ?? looksLikeChain(a.name)) && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-violet-500/40 text-violet-600 dark:text-violet-300" title="This agent runs several agents in sequence">⛓ Chain</span>
            )}
            {a.section === 'not_activated' && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-sky-500/40 text-sky-700 dark:text-sky-300">Draft</span>
            )}
            {badge && <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>}
            <GradeBadge grade={a.grade} />
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

        <div className="flex-none flex items-center gap-1.5">
          {a.section === 'not_activated' ? (
            <Link href={`/workflows/${encodeURIComponent(a.slug)}/activate`} className="btn-success text-xs px-3 py-1.5 whitespace-nowrap">
              Activate
            </Link>
          ) : a.needsIntervention ? (
            <Link href={detail} className="text-xs px-3 py-1.5 rounded-md border border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 transition-colors whitespace-nowrap font-medium">
              Fix
            </Link>
          ) : a.lastRun?.id ? (
            <Link href={`/runs/${a.lastRun.id}`} className="btn-outline text-xs px-3 py-1.5 whitespace-nowrap">
              {a.lastRun.runState === 'running' ? 'View live' : 'View last result'}
            </Link>
          ) : (
            <Link href={detail} className="btn-outline text-xs px-3 py-1.5 whitespace-nowrap">
              Open
            </Link>
          )}
          {/* Archive = remove from MY list (never deletes the shared agent). Not
              offered for a not-yet-activated draft — there's nothing to remove
              from a running roster yet; the row IS the draft. */}
          {a.section !== 'not_activated' && <RowMenu onArchive={() => onArchive(a)} busy={busy} />}
        </div>
      </div>
    </li>
  );
}

function Section({ title, agents, onArchive, onRename, busySlug, spotlight = false, subtitle }: { title: string; agents: ListAgent[]; onArchive: (a: ListAgent) => void; onRename: (slug: string, name: string) => Promise<void>; busySlug: string | null; spotlight?: boolean; subtitle?: string }) {
  if (agents.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-ink-200 uppercase tracking-wider mb-3">
        {title} <span className="text-ink-500">({agents.length})</span>
        {subtitle && <span className="ml-2 normal-case tracking-normal text-ink-500 font-normal">{subtitle}</span>}
      </h2>
      <ul className="space-y-3">{agents.map((a) => <Row key={`${spotlight ? 'act' : 'row'}-${a.slug}`} a={a} onArchive={onArchive} onRename={onRename} busy={busySlug === a.slug} spotlight={spotlight} />)}</ul>
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
  const [showPaused, setShowPaused] = useState(false);

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
  const paused = shown.filter((a) => a.section === 'paused');
  // The full activated roster (scheduled + on-demand together, scheduler-tagged).
  const activated = [...scheduled, ...onDemand];
  // Activity spotlight: agents running right now OR that ran in the last 24h.
  // This OVERLAPS the roster on purpose — it's a live-pulse lens on the same
  // agents (its rows open the RUN status page, not the agent page). Running
  // first, then most-recent.
  const RECENT_MS = 24 * 60 * 60 * 1000;
  const recentlyActive = activated
    .filter((a) => a.lastRun && (a.lastRun.runState === 'running' || (!!a.lastRun.ranAt && Date.now() - new Date(a.lastRun.ranAt).getTime() < RECENT_MS)))
    .sort((x, y) => {
      const xr = x.lastRun?.runState === 'running' ? 1 : 0;
      const yr = y.lastRun?.runState === 'running' ? 1 : 0;
      if (xr !== yr) return yr - xr;
      return new Date(y.lastRun?.ranAt || 0).getTime() - new Date(x.lastRun?.ranAt || 0).getTime();
    });

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

      {/* Roster model: an ACTIVITY spotlight (what's running / just ran — rows open
          the run status page) on top of the full ROSTER (all activated agents,
          scheduled + on-demand, scheduler-tagged — rows open the agent page). The
          two overlap on purpose: same agents, two doors. Then Need activation, then
          Paused. Scheduling is surfaced as a per-row ⏰ tag, not a list split. */}
      <Section title="Running & recently ran" subtitle="live activity · opens the run" agents={recentlyActive} onArchive={archive} onRename={rename} busySlug={busySlug} spotlight />
      <Section title="Active agents" agents={activated} onArchive={archive} onRename={rename} busySlug={busySlug} />
      <Section title="Need activation" agents={notActivated} onArchive={archive} onRename={rename} busySlug={busySlug} />

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

      {/* Paused — recurring agents the user paused. Collapsed by default (like
          Archived): their clock is stopped but they still run on demand. Each row
          opens the agent page, where Resume lives. */}
      {paused.length > 0 && (
        <section className="mt-10 pt-6 border-t border-ink-800">
          <h2 className="text-xs uppercase tracking-wider text-ink-500 mb-3">Paused ({paused.length})</h2>
          <ul className="space-y-2">
            {(showPaused ? paused : paused.slice(0, 3)).map((a) => (
              <li key={a.slug} className="card flex items-center justify-between gap-3 py-2.5">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                  <span className="text-sm text-ink-300 truncate">{a.name}</span>
                </span>
                <Link
                  href={`/workflows/${encodeURIComponent(a.slug)}?source=${encodeURIComponent(a.source)}`}
                  className="btn-success text-xs px-3 py-1.5 whitespace-nowrap flex-none"
                >
                  Resume
                </Link>
              </li>
            ))}
          </ul>
          {paused.length > 3 && (
            <button
              type="button"
              onClick={() => setShowPaused((v) => !v)}
              className="text-xs text-ink-500 hover:text-ink-300 mt-3"
            >
              {showPaused ? 'Show less' : `Show all (${paused.length})`}
            </button>
          )}
        </section>
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
