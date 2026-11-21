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
 *
 * Lifecycle verbs (2026-07-15) — one control, one meaning:
 *   • Deactivate (POST /me/workflows/deactivate) — stops the CALLER's schedules,
 *     leaves the agent on the list. The honest way to say "stop running this".
 *   • Archive (POST /me/workflows/dismiss) — hides it from the list AND stops
 *     the caller's schedules, because a hidden agent that keeps delivering is
 *     the one thing archive must never be. Both labels say so.
 *   • Delete — deliberately absent. An agent def is a published package, not a
 *     personal file: forks and other users' chains resolve it by slug at run
 *     time, so a hard delete breaks people who aren't in the room.
 * Neither verb ever touches the shared agent — only the caller's own rows.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import LocalTime from './local-time';
import {CollectionEmpty} from './collection-state';
import {useAgentCollectionCount} from './agent-home-frame';

// Collection rows keep one Run action; less frequent lifecycle actions stay in the menu.
function DotsIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

/**
 * Small "..." overflow menu — Deactivate + Archive. Closes on outside click / Escape.
 *
 * Two DIFFERENT verbs on purpose (2026-07-15). Archive is about your LIST;
 * Deactivate is about the CLOCK. Each label says what it does and nothing else:
 *   • Deactivate — stops the schedule, agent stays on your list. Reversible.
 *   • Archive    — hides it from your list, and stops its schedule too (a hidden
 *                  agent must never keep delivering). The menu says so in words
 *                  rather than leaving the user to find out from an inbox.
 * Deactivate is only offered when there's a clock to stop.
 */
function RowMenu({ onArchive, onDeactivate, canDeactivate, busy, trainingHref, lastRunHref }: { onArchive: () => void; onDeactivate: () => void; canDeactivate: boolean; busy: boolean;trainingHref?:string;lastRunHref?:string }) {
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
        <div role="menu" className="absolute right-0 top-full mt-1 z-20 min-w-[230px] rounded-md border border-ink-700 bg-ink-900 py-1 shadow-lg">
          {trainingHref&&<Link role="menuitem" href={trainingHref+'?chat=edit'} onClick={()=>setOpen(false)} className="block px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Edit agent</Link>}
          {trainingHref&&<Link role="menuitem" href={trainingHref} onClick={()=>setOpen(false)} className="block px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Train this agent</Link>}
          {lastRunHref&&<Link role="menuitem" href={lastRunHref} onClick={()=>setOpen(false)} className="block px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Last run</Link>}
          {canDeactivate && (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => { setOpen(false); onDeactivate(); }}
              className="w-full text-left px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-50"
            >
              <span className="block">Pause</span>
              <span className="block text-[11px] text-ink-500">Stops its schedule. Stays on your list.</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => { setOpen(false); onArchive(); }}
            className="w-full text-left px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800 hover:text-state-fail hover:text-state-fail disabled:opacity-50"
          >
            <span className="block">{busy ? 'Archiving…' : 'Archive'}</span>
            <span className="block text-[11px] text-ink-500">
              {canDeactivate ? 'Hides it from your list and stops its schedule.' : 'Hides it from your list.'}
            </span>
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
  /** From the authenticated owned library, never inferred from an unknown feed source. */
  canTrain?:boolean;
  section: 'scheduled' | 'on_demand' | 'not_activated' | 'paused';
  category: { key: string; label: string; emoji: string };
  needsIntervention?: boolean;
  interventionReason?: string | null;
  pendingQuestions?: number;
  nextRunAt?: string | null;
  scheduleNl?: string | null;
  scheduleOff?:boolean;
  lastRun?: {
    id?: string;
    status: string;
    runState: string | null;
    ranAt: string;
    executor?: string | null;
    model?: string | null;
  } | null;
  grade?: { hasGrade: boolean; rate: number; label: 'reliable' | 'mixed' | 'unproven'; runs: number; confidence: number } | null;
  /** True when this agent chains other agents (its name reads "A → B"). Shown as a Chain tag. */
  isChain?: boolean;
  /** Starred by the user — floats to a "Favorites" section at the top. */
  favorite?: boolean;
};

// A chain agent's name is the leaf names joined by an arrow (createChainWorkflow).
export function looksLikeChain(name: string): boolean {
  return /→|->/.test(name || '');
}

export type ArchivedAgent = {
  slug: string;
  name: string;
  source: string;
  /** Archived but STILL on a live schedule — surfaced, never swallowed. */
  isLive?: boolean;
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
  if (rs === 'stalled') return { label: 'Progress interrupted', cls: 'border-amber-500/50 text-state-needs' };
  if (st === 'failed' || rs === 'failed') return { label: 'Last run failed', cls: 'border-rose-500/50 text-state-fail' };
  if (st === 'partial') return { label: 'Partly delivered', cls: 'border-amber-500/50 text-state-needs' };
  if (st === 'completed' || rs === 'completed') return { label: 'Delivered', cls: 'border-emerald-500/40 text-state-ok' };
  if (rs === 'running') return { label: 'Running', cls: 'border-sky-500/40 text-state-running' };
  return {label:'Never run',cls:'border-ink-700 text-ink-400'};
}


function Row({ a, onArchive, onDeactivate, onRename, onToggleFavorite, busy, card=false }: { card?:boolean; a: ListAgent; onArchive: (a: ListAgent) => void; onDeactivate: (a: ListAgent) => void; onRename: (slug: string, name: string) => Promise<void>; onToggleFavorite: (a: ListAgent) => void; busy: boolean }) {
  const detail = `/workflows/${encodeURIComponent(a.slug)}?source=${encodeURIComponent(a.source)}`;
  const titleHref = detail;
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

  const isDraft=a.section==='not_activated';
  return <li className={`agent-roster-row ${card?'agent-favorite-card':''}`}>
    {card&&<div className="agent-card-art" aria-hidden="true"><svg><use href="/brand/tukido-icons.svg#agents"/></svg></div>}
    <button type="button" className="agent-star" onClick={()=>onToggleFavorite(a)} aria-label={a.favorite?`Unfavorite ${a.name}`:`Add ${a.name} to favorites`} aria-pressed={!!a.favorite}>{a.favorite?'★':'☆'}</button>
    <div className="agent-row-name">
      {editing?<input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} onBlur={save} onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape'){setDraft(a.name);setEditing(false);}}} maxLength={120} disabled={saving} aria-label={`Name for ${a.name}`} className="input"/>:
        <div className="agent-row-title"><Link href={titleHref}>{a.name}</Link><button type="button" onClick={()=>{setDraft(a.name);setEditing(true);}} aria-label={`Rename ${a.name}`} title="Rename (your view only)">✎</button></div>}
      {!card&&<p>{a.category.label}{a.canTrain?' · built by you':''}{(a.isChain??looksLikeChain(a.name))?' · Chain':''}</p>}
      {a.lastRun?.id&&<Link className="agent-last-run" href={`/runs/${encodeURIComponent(a.lastRun.id)}`}>Last result{card&&a.lastRun.ranAt?<> · <LocalTime iso={a.lastRun.ranAt}/></>:' →'}</Link>}
    </div>
    <span className={`agent-state ${isDraft?'border-ink-700 text-ink-400':badge?.cls||''}`}>{isDraft?'Draft':badge?.label}</span>
    {!card&&<div className="agent-when"><span>{isDraft?'Not turned on':a.section==='scheduled'&&a.nextRunAt?`Next: ${nextRunLabel(a.nextRunAt)}`:a.lastRun?.ranAt?<><span>Ran </span><LocalTime iso={a.lastRun.ranAt}/></>:'Not run yet'}</span><small>{a.section==='scheduled'?(a.scheduleNl||'On a schedule'):a.section==='paused'?'Schedule paused':isDraft?'Saved for later':a.scheduleOff?'Schedule off':'On demand'}</small></div>}
    {!card&&<div className="agent-row-grade">{a.grade?.hasGrade?<><span>{Math.round(a.grade.rate*100)}% delivered</span><small>of {a.grade.runs} runs</small></>:<span aria-label="No delivery history">—</span>}</div>}
    <Link href={isDraft||a.section==='paused'?detail:detail+'&run=1'} prefetch={false} className="btn-outline agent-run">{isDraft?'Turn on':a.section==='paused'?'Resume':'Run'}</Link>
    <RowMenu onArchive={()=>onArchive(a)} onDeactivate={()=>onDeactivate(a)} canDeactivate={a.section==='scheduled'} busy={busy} trainingHref={a.canTrain?`/training/${encodeURIComponent(a.slug)}`:undefined} lastRunHref={a.lastRun?.id?`/runs/${encodeURIComponent(a.lastRun.id)}`:undefined}/>
  </li>;
}

function Section({ title, agents, onArchive, onDeactivate, onRename, onToggleFavorite, busySlug, subtitle, collapsible = false, cards=false, limit=8 }: { title: string; agents: ListAgent[]; onArchive: (a: ListAgent) => void; onDeactivate: (a: ListAgent) => void; onRename: (slug: string, name: string) => Promise<void>; onToggleFavorite: (a: ListAgent) => void; busySlug: string | null; subtitle?: string; collapsible?: boolean;cards?:boolean;limit?:number }) {
  const [all,setAll]=useState(false);
  if (!agents.length) return null;
  const content=<><ul className={cards?'agent-favorites-grid':'agent-roster-list'}>{(all?agents:agents.slice(0,limit)).map(a=><Row key={a.slug} a={a} card={cards} onArchive={onArchive} onDeactivate={onDeactivate} onRename={onRename} onToggleFavorite={onToggleFavorite} busy={busySlug===a.slug}/>)}</ul>
    {agents.length>limit&&<p className="agent-section-more">Showing {all?agents.length:limit} of {agents.length} · <button type="button" onClick={()=>setAll(!all)}>{all?'Show less':`Show all ${agents.length}`}</button></p>}</>;
  return collapsible?<details className="agent-collapsed-group"><summary>{title} <span>{agents.length}{subtitle?` · ${subtitle}`:''}</span></summary><div>{content}</div></details>:
    <section className="agent-section" aria-label={title}><div className="agent-section-head"><h2>{title}</h2><span>{agents.length}</span>{subtitle&&<p>{subtitle}</p>}</div>{content}</section>;
}

const EMPTY_ARCHIVED:ArchivedAgent[]=[];
export default function AgentsList({ agents, archived = EMPTY_ARCHIVED, rosterKnown = true }: { agents: ListAgent[]; archived?: ArchivedAgent[]; rosterKnown?:boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  // Local copies so archive/restore update instantly (the backend already
  // filters dismissed agents out of the feeds, so an optimistic move is safe).
  const [list, setList] = useState<ListAgent[]>(agents);
  const publishCount=useAgentCollectionCount();
  useEffect(()=>{publishCount?.({count:list.length,complete:rosterKnown});},[publishCount,list.length,rosterKnown]);
  const [arch, setArch] = useState<ArchivedAgent[]>(archived);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showNeeds,setShowNeeds]=useState(false);
  const [sort,setSort]=useState('recent');
  const [query, setQuery] = useState('');
  // A server refresh can recover a previously unavailable roster without remounting.
  useEffect(()=>{setList(agents);},[agents]);
  useEffect(()=>{setArch(archived);},[archived]);

  // Star / un-star. Optimistic (flip in place), best-effort backend — a favorite
  // is a pure display marker, so a failed write just reverts the star, never an
  // error banner that blocks the list.
  async function toggleFavorite(a: ListAgent) {
    const next = !a.favorite;
    const prev = list;
    setList(list.map((x) => (x.slug === a.slug ? { ...x, favorite: next } : x)));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/workflows/favorite', {
        jwt: session?.access_token, method: next ? 'POST' : 'DELETE', body: { slug: a.slug },
      });
    } catch {
      setList(prev); // revert the star; no blocking error for a favorite toggle
    }
  }

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

  // Deactivate = stop the caller's schedules for this agent, WITHOUT hiding it.
  // The row stays put and moves to Paused on the next server read, where Resume
  // already lives. Backend is caller-scoped, so this never touches the shared
  // agent or anyone else's clock.
  async function deactivate(a: ListAgent) {
    setBusySlug(a.slug);
    setError(null);
    const prevList = list;
    // Optimistic: the agent is no longer on a clock.
    setList(list.map((x) => (x.slug === a.slug ? { ...x, section: 'paused', nextRunAt: null } : x)));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/workflows/deactivate', {
        jwt: session?.access_token, method: 'POST', body: { slug: a.slug },
      });
      // Re-read so the row comes back with real server state rather than a guess.
      router.refresh();
    } catch (e) {
      setList(prevList);
      setError(e instanceof Error ? e.message : 'Could not deactivate that agent');
    } finally {
      setBusySlug(null);
    }
  }

  // Reactivate an archived agent that is somehow still live — the escape hatch
  // for the STILL LIVE badge below, so seeing it always comes with a way to act.
  async function deactivateArchived(slug: string) {
    setBusySlug(slug);
    setError(null);
    const prev = arch;
    setArch(arch.map((x) => (x.slug === slug ? { ...x, isLive: false } : x)));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend('/api/v2/me/workflows/deactivate', {
        jwt: session?.access_token, method: 'POST', body: { slug },
      });
    } catch (e) {
      setArch(prev);
      setError(e instanceof Error ? e.message : 'Could not stop that agent');
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

  // Archived agents that can still fire. Counted on the collapsed header too —
  // a warning inside a collapsed section is a warning nobody reads.
  const liveArchived = arch.filter((a) => a.isLive).length;

  // Owned-agent search stays local and combines with the existing category keys.
  const countLabel=(n:number)=>rosterKnown?n:n?`${n}+`:'?';
  const q = query.trim().toLowerCase();
  const needsHelp=(a:ListAgent)=>!!a.needsIntervention||(a.pendingQuestions??0)>0;
  const byCat = activeCat==='needs'?list.filter(needsHelp):activeCat==='scheduled'?list.filter(a=>a.section==='scheduled'):activeCat?list.filter(a=>a.category.key===activeCat):list;
  const shown = q
    ? byCat.filter((a) => a.name.toLowerCase().includes(q) || a.category.label.toLowerCase().includes(q))
    : byCat;
  // Favorites float to their own section at the very top (and are removed from the
  // sections below so a starred agent shows once). Newest-starred not tracked here;
  // order follows the roster.
  const favorites = shown.filter((a) => a.favorite);
  const scheduled = shown.filter((a) => a.section === 'scheduled' && !a.favorite);
  const onDemand = shown.filter((a) => a.section === 'on_demand' && !a.favorite);
  const notActivated = shown.filter((a) => a.section === 'not_activated' && !a.favorite);
  const paused = shown.filter((a) => a.section === 'paused' && !a.favorite);
  // The full activated roster (scheduled + on-demand together, scheduler-tagged) —
  // favorites are pulled into their own section above, so exclude them here.
  const activated = [...scheduled, ...onDemand].sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):(Date.parse(b.lastRun?.ranAt||'')||0)-(Date.parse(a.lastRun?.ranAt||'')||0));
  const attention=shown.filter(needsHelp);
  const rowHandlers={onArchive:archive,onDeactivate:deactivate,onRename:rename,onToggleFavorite:toggleFavorite,busySlug};
  const setCat = (key: string) => {
    const p = new URLSearchParams(params.toString());
    if (key) p.set('cat', key); else p.delete('cat');
    router.replace(`/workflows${p.toString() ? `?${p.toString()}` : ''}`, { scroll: false });
  };

  return (
    <>
      {error && <p className="text-xs text-state-fail mb-3">{error}</p>}

      {/* One outcome-first query spans owned/hired and eligible available agents. */}
      {(rosterKnown||list.length>0)&&<div className="relative mb-4">
          <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"><svg width="16" height="16"><use href="/brand/tukido-icons.svg#search"/></svg></span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find one of your agents"
            aria-label="Search your agents"
            className="w-full bg-ink-900 border border-ink-700 rounded-md text-sm pl-8 pr-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none"
          />
      </div>}

      {(rosterKnown||list.length>0)&&<nav className="agent-filter-chips" aria-label="Filter your agents">
        <button type="button" aria-pressed={!activeCat} onClick={()=>setCat('')}>All</button>
        <button type="button" aria-pressed={activeCat==='needs'} onClick={()=>setCat(activeCat==='needs'?'':'needs')}>Needs you · {countLabel(list.filter(needsHelp).length)}</button>
        <button type="button" aria-pressed={activeCat==='scheduled'} onClick={()=>setCat(activeCat==='scheduled'?'':'scheduled')}>On a schedule · {countLabel(list.filter(a=>a.section==='scheduled').length)}</button>
        {categories.slice(0,3).map(c=><button key={c.key} type="button" aria-pressed={activeCat===c.key} onClick={()=>setCat(activeCat===c.key?'':c.key)}>{c.label} · {c.n}</button>)}
        {categories.length>3&&<details><summary>More</summary><div>{categories.slice(3).map(c=><button key={c.key} type="button" aria-pressed={activeCat===c.key} onClick={()=>setCat(activeCat===c.key?'':c.key)}>{c.label} · {c.n}</button>)}</div></details>}
      </nav>}
      {attention.length>0&&<section className="agent-section" aria-label="Needs you"><div className="agent-section-head"><h2>Needs you</h2><span className="agent-attention-count">{attention.length} agents</span></div><div className="agent-needs-grid">
        {(showNeeds?attention:attention.slice(0,3)).map(a=><article key={a.slug} className={`agent-need-card ${a.lastRun?.status==='failed'?'failed':''}`}><h3>{a.name}</h3><p>{(a.pendingQuestions??0)>0?`${a.pendingQuestions} question${a.pendingQuestions===1?' needs':'s need'} your answer.`:a.interventionReason||'Open this agent to see what it needs.'}</p><Link href={`/workflows/${encodeURIComponent(a.slug)}?source=${encodeURIComponent(a.source)}`} className="btn-outline">Open agent</Link></article>)}
      </div>{attention.length>3&&<p className="agent-section-more">{!showNeeds&&`and ${attention.length-3} more · `}<button type="button" onClick={()=>setShowNeeds(!showNeeds)}>{showNeeds?'Show less':`Show all ${attention.length}`}</button></p>}</section>}
      <Section title="Favorites" agents={favorites} cards limit={4} {...rowHandlers}/>
      {activated.length>0&&<div className="agent-sort"><label>Sort <select value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Recently run</option><option value="name">Name</option></select></label></div>}
      <Section title="All active agents" agents={activated} {...rowHandlers}/>
      <Section title="Drafts" subtitle="saved but not turned on" agents={notActivated} collapsible limit={3} {...rowHandlers}/>
      <Section title="Paused" agents={paused} collapsible limit={3} {...rowHandlers}/>
      {shown.length===0&&rosterKnown&&(q||activeCat?
        <CollectionEmpty title="No results" description={<>{list.length===1?'Your agent doesn’t match':`None of your ${list.length} agents match`}{q?` “${query.trim()}”`:''}{activeCat?` in ${activeCat==='needs'?'Needs you':activeCat==='scheduled'?'On a schedule':categories.find(c=>c.key===activeCat)?.label||activeCat}`:''}.</>}><button type="button" className="btn-outline" onClick={()=>{setQuery('');setCat('');}}>Clear search and filters</button></CollectionEmpty>:
        <CollectionEmpty enso title="No agents yet" description="Agents you build or pick up from a trainer appear here, ready to run."><div><Link href="/create" className="btn-primary">Build an agent</Link> <Link href="/workflows?tab=rent" className="btn-outline">Find a trained agent</Link></div></CollectionEmpty>)}


      {/* Archived — per-user hidden agents, restorable. The shared agents are
          untouched; this is just the caller's view.

          Archiving stops schedules, so an archived agent should never still be
          running. When one IS (a stop that failed, or a row archived before that
          was true), the row says STILL LIVE and offers Stop right here. Archive
          is the one place things are out of sight — so it's the one place
          liveness can't be left implicit. If this badge never appears, good:
          that's the contract holding, visibly. */}
      {arch.length > 0 && (
        <section className="agent-collapsed-group">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            aria-controls="archived-agents"
            className="agent-archive-toggle"
          >
            <span className={`inline-block transition-transform ${showArchived ? 'rotate-90' : ''}`}>▸</span>
            Archived ({arch.length})
            {liveArchived > 0 && (
              <span className="normal-case tracking-normal text-state-needs">
                · {liveArchived} still running
              </span>
            )}
          </button>
          {showArchived && (
            <div id="archived-agents">
              <p className="text-[11px] text-ink-500 mt-2">Hidden from your list. Archiving also stops the schedule.</p>
              <ul className="space-y-2 mt-3">
                {arch.map((a) => (
                  <li key={a.slug} className="card flex items-center justify-between gap-3 py-2.5">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-ink-300 truncate">{a.name}</span>
                      {a.isLive && (
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/50 text-state-needs whitespace-nowrap"
                          title="Hidden from your list, but still running on its schedule."
                        >
                          Still live
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5 flex-none">
                      {a.isLive && (
                        <button
                          type="button"
                          onClick={() => deactivateArchived(a.slug)}
                          disabled={busySlug === a.slug}
                          className="text-xs px-3 py-1 rounded-md border border-amber-500/50 text-state-needs hover:bg-amber-500/10 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {busySlug === a.slug ? 'Stopping…' : 'Stop it'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => restore(a.slug)}
                        disabled={busySlug === a.slug}
                        className="text-xs btn-outline px-3 py-1 disabled:opacity-50 whitespace-nowrap"
                      >
                        {busySlug === a.slug ? 'Restoring…' : 'Restore'}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}
