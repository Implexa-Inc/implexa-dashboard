/**
 * The owner's outcome productions on /work — the way back to work that is
 * already running.
 *
 * Without this list a production is reachable only from the redirect that
 * started it: navigate away, and the running work, its budget, and its single
 * stop control are unreachable. Work is where "what is being produced" is
 * answered, so it is where they belong.
 *
 * Pure and server-renderable. It claims nothing the loader did not read: an
 * unreadable list says so (and is NOT the same as having no productions), and
 * the empty state is only claimed when the list was fully readable.
 */

import Link from 'next/link';
import type { Production } from '@/lib/outcome-production';
import type { OutcomeProductionListLoad } from '@/lib/outcome-production-load';

const STATE_LABELS: Record<string, string> = {
  planning: 'Planning',
  ready: 'Ready',
  running: 'Running',
  cancelled: 'Stopped',
  succeeded: 'Completed',
  partial: 'Partially delivered',
  failed: 'Failed',
};

function stateClass(state: string): string {
  if (state === 'running') return 'bg-brand-500/15 text-brand-300 border-brand-500/30';
  if (state === 'failed' || state === 'partial') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (state === 'succeeded') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  return 'bg-ink-800 text-ink-300 border-ink-700';
}

function Row({ production }: { production: Production }) {
  const { budget } = production;
  return (
    <li>
      <Link
        href={`/runs/productions/${production.id}`}
        className="block border border-ink-800 rounded-lg px-4 py-3 hover:border-ink-600 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm text-ink-100 line-clamp-2">{production.goal}</span>
          <span className={`flex-none rounded-full border px-2.5 py-0.5 text-xs font-medium ${stateClass(production.state)}`}>
            {STATE_LABELS[production.state] || production.state}
          </span>
        </div>
        <span className="block text-xs text-ink-500 mt-1.5">
          {production.progress.completedNodes} of {production.progress.totalNodes} steps ·{' '}
          {budget.spentCredits.toLocaleString()} credits spent
        </span>
      </Link>
    </li>
  );
}

const LEGACY_RUN_INSTRUCTIONS = ' run instructions for this production:';

function draftOutcomeKey(goal: string) {
  // Before run instructions became a typed intent field, the Create surface
  // appended this marker to the goal. Treat those old rows as drafts of the
  // same outcome so the already-created duplicates disappear from Work too.
  const normalized = goal.replace(/\s+/g, ' ').trim().toLowerCase();
  const marker = normalized.indexOf(LEGACY_RUN_INSTRUCTIONS);
  return marker >= 0 ? normalized.slice(0, marker).trim() : normalized;
}

function isUnstartedDraft(production: Production) {
  return !production.settled
    && (production.state === 'planning' || production.state === 'ready')
    && production.progress.completedNodes === 0
    && production.budget.reservedCredits === 0
    && production.budget.spentCredits === 0
    && production.children.every((child) => child.startedAt === null && child.spentCredits === 0);
}

/**
 * The Backend list is newest-first. Replanning an outcome can mint a new
 * immutable production identity (new input or instructions means a new
 * digest), but those identities are revisions of one unstarted draft—not 14
 * pieces of work the owner needs to manage. Keep the newest draft per outcome;
 * preserve every production that started, settled, reserved, or spent.
 */
export function coalesceUnstartedDrafts(productions: Production[]) {
  const visible: Production[] = [];
  const seenDrafts = new Set<string>();
  for (const production of productions) {
    if (!isUnstartedDraft(production)) {
      visible.push(production);
      continue;
    }
    const key = draftOutcomeKey(production.goal);
    if (seenDrafts.has(key)) continue;
    seenDrafts.add(key);
    visible.push(production);
  }
  return visible;
}

export default function OutcomeProductionsList({ load }: { load: OutcomeProductionListLoad }) {
  // This deployment has no outcome-production route at all. /work is a shared
  // surface, and warning every user about a capability the backend has never
  // offered is noise, not honesty.
  if (load.status === 'absent') return null;

  if (load.status === 'unavailable') {
    return (
      <section role="status" aria-label="Productions unavailable" className="card p-5 border-amber-500/40 mb-6">
        <p className="text-sm text-amber-300">
          We can’t show your outcome productions right now — this is not the same as having none.
        </p>
        <p className="text-xs text-ink-500 mt-1">{load.reason}</p>
      </section>
    );
  }

  // Nothing to say beats an empty box on a page that already has three lists.
  const productions = coalesceUnstartedDrafts(load.productions);
  if (productions.length === 0) return null;

  // "Running" is a claim about work that is actually progressing. A blocked
  // production is unsettled but stalled on the user, so folding it into a
  // running count would contradict the Blocked badge on its own row.
  const unsettled = productions.filter((p) => !p.settled);
  const running = unsettled.filter((p) => p.state === 'running').length;
  const waiting = unsettled.length - running;
  const counts = [
    running > 0 ? `${running} running` : null,
    waiting > 0 ? `${waiting} pending` : null,
  ].filter(Boolean);

  return (
    <section aria-label="Outcome productions" className="mb-6">
      <h2 className="text-sm font-semibold text-ink-50">
        Productions
        {counts.length > 0 && <span className="text-ink-400 font-normal"> · {counts.join(' · ')}</span>}
      </h2>
      <ul className="mt-2 space-y-2">
        {productions.map((production) => <Row key={production.id} production={production} />)}
      </ul>
    </section>
  );
}
