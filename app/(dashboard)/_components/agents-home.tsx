/**
 * <AgentsHome /> — the 2-group agent home (ACTIVATION_JOURNEY.md): "Needs
 * activation" (with steps-left + Continue) and "Active" (with a compact run
 * status + one CTA). Async server component; renders nothing when the user has
 * no agents yet (so the page's existing catalog shows through). One CTA per row,
 * no cognitive overload.
 */

import Link from 'next/link';
import { getMyAgents, activeRunStatus, type MyAgent } from '@/lib/agents-home';
import GradeBadge from './grade-badge';

const TONE: Record<string, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
  idle: 'text-ink-500',
};
const DOT: Record<string, string> = {
  good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500', idle: 'bg-ink-500',
};

function NeedsRow({ a }: { a: MyAgent }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3 px-1">
      <div className="min-w-0">
        <span className="text-sm font-medium text-ink-100 truncate">{a.name}</span>
        <p className="text-xs text-ink-500 mt-0.5">{a.stepsLeft} step{a.stepsLeft === 1 ? '' : 's'} left</p>
      </div>
      <Link href={`/workflows/${a.slug}/activate`} className="flex-none btn-success text-xs px-3 py-1.5">Continue</Link>
    </li>
  );
}

function ActiveRow({ a }: { a: MyAgent }) {
  // "Needs you" takes priority over the run status: the agent is scheduled but a
  // manual action (grant Bash, connect an account) is what's actually blocking it
  // from running. Say WHAT to do, with a one-tap Fix. That's the whole promise.
  if (a.needsIntervention) {
    return (
      <li className="flex items-center justify-between gap-3 py-3 px-1">
        <div className="min-w-0 flex items-center gap-2.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full flex-none bg-amber-500" aria-hidden />
          <div className="min-w-0">
            <span className="text-sm font-medium text-ink-100 truncate">{a.name}</span>
            <p className="text-xs mt-0.5">
              <span className="text-amber-600 dark:text-amber-400">Needs you</span>
              <span className="text-ink-500"> · {a.interventionReason || 'one quick step'}</span>
            </p>
          </div>
        </div>
        <Link href={`/workflows/${a.slug}/activate`} className="flex-none btn-success text-xs px-3 py-1.5">Fix</Link>
      </li>
    );
  }
  const s = activeRunStatus(a);
  return (
    <li className="flex items-center justify-between gap-3 py-3 px-1">
      <div className="min-w-0 flex items-center gap-2.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-none ${DOT[s.tone]}`} aria-hidden />
        <div className="min-w-0">
          <span className="text-sm font-medium text-ink-100 truncate">{a.name}</span>
          <p className="text-xs text-ink-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{a.mode === 'on_demand' ? 'On-demand' : (a.scheduleNl || 'scheduled')} · <span className={TONE[s.tone]}>{s.label}</span></span>
            <GradeBadge grade={a.grade} />
          </p>
        </div>
      </div>
      <Link href={s.href} className="flex-none btn-outline text-xs px-3 py-1.5">{s.cta}</Link>
    </li>
  );
}

export async function AgentsHome() {
  const data = await getMyAgents();
  if (!data) return null;
  const { needsActivation, active } = data;
  if (needsActivation.length === 0 && active.length === 0) return null;

  // Active agents split by HOW they run: on-demand (you invoke them) vs scheduled
  // (a cadence). A scheduled mode is anything not explicitly on_demand.
  const onDemand = active.filter((a) => a.mode === 'on_demand');
  const scheduled = active.filter((a) => a.mode !== 'on_demand');

  return (
    <div className="mb-10 space-y-7">
      {needsActivation.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-ink-400 mb-2">Needs activation ({needsActivation.length})</h2>
          <ul className="card !py-1 divide-y divide-ink-800">
            {needsActivation.map((a) => <NeedsRow key={a.slug} a={a} />)}
          </ul>
        </section>
      )}
      {onDemand.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-ink-400 mb-2">On-demand ({onDemand.length})</h2>
          <ul className="card !py-1 divide-y divide-ink-800">
            {onDemand.map((a) => <ActiveRow key={a.slug} a={a} />)}
          </ul>
        </section>
      )}
      {scheduled.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-ink-400 mb-2">Scheduled ({scheduled.length})</h2>
          <ul className="card !py-1 divide-y divide-ink-800">
            {scheduled.map((a) => <ActiveRow key={a.slug} a={a} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
