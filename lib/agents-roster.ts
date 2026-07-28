// agents-roster.ts — the pure merge that decides which SECTION each agent belongs to.
//
// EXTRACTED FROM workflows/page.tsx (2026-07-28, review P2). The page is an async
// server component, so the only available guard was a regex asserting that a particular
// loop spelling existed. That proves a line of code is present; it does NOT prove the
// invariant — that an unavailable feed can never produce a `not_activated` row. A guard
// that cannot fail for the real reason is not a guard.
//
// THE INVARIANT, stated once:
//   `section: 'not_activated'` is a CLAIM about an agent's state. It may be made ONLY
//   from a READY feed. When the feed is unavailable the roster is EMPTY — the caller
//   renders an explicit "couldn't load" state instead.
//
// This is what produced the bug: 48 agents rendered as "Saved as a draft - turn it on
// whenever you're ready" while the backend was returning 33 active / 1 needs-activation
// / 16 drafts and nothing had been deactivated.

// TYPE-ONLY imports (erased at runtime) plus an INJECTED categorizer: this module keeps
// zero runtime dependencies on siblings so node:test can load it directly. The same
// reason lib/attention.ts is testable and most of lib/ is not.
import type { AgentsFeed } from './agents-feed-core';
import type { ListAgent } from '../app/(dashboard)/_components/agents-list';

/** Injected so this stays dependency-free; the page passes the real categorizeAgent. */
export type Categorize = (parts: Array<string | null | undefined>) => ListAgent['category'];

/** The library shape this merge needs (a subset of listMyWorkflows' rows). */
export type LibraryAgent = {
  slug: string;
  name: string;
  source: string;
  description?: string | null;
  primary_outcome?: string | null;
  vertical?: string | null;
};

export type PausedRow = { skill_slug: string | null; status?: string; trigger_type?: string };

export type RosterInput = {
  feed: AgentsFeed;
  mine: LibraryAgent[];
  paused: PausedRow[];
  categorize: Categorize;
};

export type RosterResult = {
  /** Empty when the feed is unavailable — see the invariant above. */
  agents: ListAgent[];
  /** Drives the "couldn't load agent status" banner. */
  feedReady: boolean;
};

export function buildRoster({ feed, mine, paused, categorize }: RosterInput): RosterResult {
  const feedReady = feed.status === 'ready';

  const meta = new Map(mine.map((w) => [w.slug, w]));
  const parts = (slug: string, name: string) => {
    const m = meta.get(slug);
    return [name, m?.description, m?.primary_outcome, m?.vertical];
  };
  const sourceFor = (slug: string) => meta.get(slug)?.source || 'generated';

  const list: ListAgent[] = [];
  const seen = new Set<string>();

  // NOTHING IS CLASSIFIED WITHOUT THE FEED. Returning early is the whole fix: every
  // loop below asserts something about activation state, and none of them can be
  // justified from a failed read.
  if (!feedReady) return { agents: list, feedReady };

  // 1. From the activation feed: active (scheduled / on-demand) + mid-activation.
  for (const a of [...feed.active, ...feed.needsActivation]) {
    if (seen.has(a.slug)) continue;
    seen.add(a.slug);
    const activated = a.state === 'active';
    const section: ListAgent['section'] = !activated
      ? 'not_activated'
      : a.mode === 'scheduled' ? 'scheduled' : 'on_demand';
    list.push({
      slug: a.slug,
      name: a.name,
      source: sourceFor(a.slug),
      section,
      category: categorize(parts(a.slug, a.name)),
      needsIntervention: a.needsIntervention,
      interventionReason: a.interventionReason,
      pendingQuestions: a.pendingQuestions,
      nextRunAt: a.nextRunAt,
      scheduleNl: a.scheduleNl,
      lastRun: a.lastRun,
      grade: a.grade,
    });
  }

  // 2. Built but never activated (in the library, no activation row). Legitimate ONLY
  //    because the feed is ready: the feed listed every activated agent, so anything
  //    left really has no activation row.
  for (const w of mine) {
    if (seen.has(w.slug)) continue;
    seen.add(w.slug);
    list.push({
      slug: w.slug,
      name: w.name,
      source: w.source,
      section: 'not_activated',
      category: categorize([w.name, w.description, w.primary_outcome, w.vertical]),
      lastRun: null,
    });
  }

  // 3. Paused recurring agents — their clock is off, so the active feed excludes them.
  for (const p of paused) {
    if (!p.skill_slug || seen.has(p.skill_slug)) continue;
    seen.add(p.skill_slug);
    const m = meta.get(p.skill_slug);
    const name = m?.name || p.skill_slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    list.push({
      slug: p.skill_slug,
      name,
      source: sourceFor(p.skill_slug),
      section: 'paused',
      category: categorize(parts(p.skill_slug, name)),
      lastRun: null,
    });
  }

  return { agents: list, feedReady };
}
