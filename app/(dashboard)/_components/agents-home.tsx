/**
 * <AgentsHome /> — the 2-group agent home (ACTIVATION_JOURNEY.md): "Needs
 * activation" (with steps-left + Continue) and "Active" (with a compact run
 * status + one CTA). Async server component; renders nothing when the user has
 * no agents yet (so the page's existing catalog shows through). One CTA per row,
 * no cognitive overload.
 */

import Link from 'next/link';
import { getMyAgents, activeRunStatus, type MyAgent } from '@/lib/agents-home';

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
  const s = activeRunStatus(a);
  return (
    <li className="flex items-center justify-between gap-3 py-3 px-1">
      <div className="min-w-0 flex items-center gap-2.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-none ${DOT[s.tone]}`} aria-hidden />
        <div className="min-w-0">
          <span className="text-sm font-medium text-ink-100 truncate">{a.name}</span>
          <p className="text-xs text-ink-500 mt-0.5">
            {a.scheduleNl || 'scheduled'} · <span className={TONE[s.tone]}>{s.label}</span>
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
      {active.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-ink-400 mb-2">Active ({active.length})</h2>
          <ul className="card !py-1 divide-y divide-ink-800">
            {active.map((a) => <ActiveRow key={a.slug} a={a} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
