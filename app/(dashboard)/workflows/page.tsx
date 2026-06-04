/**
 * /workflows - the jobs the user runs (the lead product), distinct from
 * /skills (the ingredient shelf).
 *
 * "Your workflows" = the user's routines (scheduled_skills, RLS-readable) whose
 * slug matches a workflow in the public catalog. The catalog itself is
 * service-role-only RLS in Supabase, so we read it through the backend's
 * public read path (lib/workflow-catalog.ts), exactly as implexa.ai/workflows
 * does. We then fetch each matched workflow's detail in parallel to derive an
 * accurate remote-safe verdict and step count.
 *
 * Cross-links the autopilot loop: each card links to its routine (/scheduled),
 * its runs (/runs), and its full detail (/workflows/[slug]).
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { listWorkflows, getWorkflow, type WorkflowCard } from '@/lib/workflow-catalog';
import { remoteSafety, remoteSafetyFromCard } from '@/lib/remote-safety';
import { RemoteSafetyBadge } from '../_components/remote-safety-badge';
import CopyRunCommand from '../_components/copy-run-command';

export const dynamic = 'force-dynamic';

type Routine = {
  id: string;
  skill_slug: string;
  schedule_nl: string;
  cron_expression: string;
  status: 'active' | 'paused' | 'failed';
  last_run_at: string | null;
  run_count: number;
};

function rel(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function WorkflowsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const [{ data: schedules }, catalog] = await Promise.all([
    supabase
      .from('scheduled_skills')
      .select('id, skill_slug, schedule_nl, cron_expression, status, last_run_at, run_count')
      .order('created_at', { ascending: false })
      .limit(100),
    listWorkflows(),
  ]);

  const routines: Routine[] = (schedules as Routine[]) || [];
  const cardBySlug = new Map<string, WorkflowCard>(catalog.map((c) => [c.slug, c]));

  // Group the user's routines by the workflow they run (multiple routines can
  // run the same workflow). A routine is "a workflow you run" when its slug
  // appears in the catalog.
  type Group = {
    card: WorkflowCard;
    routines: Routine[];
    totalRuns: number;
    lastRunAt: string | null;
    anyActive: boolean;
  };
  const groups = new Map<string, Group>();
  for (const r of routines) {
    const card = cardBySlug.get(r.skill_slug);
    if (!card) continue;
    const g = groups.get(r.skill_slug) || {
      card,
      routines: [],
      totalRuns: 0,
      lastRunAt: null,
      anyActive: false,
    };
    g.routines.push(r);
    g.totalRuns += r.run_count || 0;
    if (r.last_run_at && (!g.lastRunAt || r.last_run_at > g.lastRunAt)) g.lastRunAt = r.last_run_at;
    if (r.status === 'active') g.anyActive = true;
    groups.set(r.skill_slug, g);
  }

  const items = [...groups.values()];

  // Fetch each matched workflow's detail in parallel for an accurate remote
  // verdict + step count. Falls back to the coarse card heuristic when the
  // detail is unavailable (e.g. the public token is unset).
  const details = await Promise.all(
    items.map((g) => getWorkflow(g.card.slug, g.card.source)),
  );

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Workflows</h1>
          <p className="text-ink-300 text-sm mt-1">
            The jobs you run. A workflow is a whole job: an ordered chain of steps with a verify gate and an outcome.{' '}
            <Link href="/skills" className="text-brand-500 hover:underline">Skills</Link>{' '}
            are the ingredients; a workflow stitches them into the complete job and runs on a{' '}
            <Link href="/scheduled" className="text-brand-500 hover:underline">routine</Link>.
          </p>
        </header>

        {items.length === 0 ? (
          <section className="card text-sm text-ink-300">
            <p className="mb-3">No workflows yet.</p>
            <p className="mb-3">
              A workflow runs as a routine on a schedule. From Claude Code, ask Implexa to set one up, e.g.{' '}
              <code className="bg-ink-900 px-1.5 py-0.5 rounded text-brand-400">run the morning build brief workflow</code>{' '}
              then approve the schedule. It will show up here, in{' '}
              <Link href="/scheduled" className="text-brand-500 hover:underline">Routines</Link>, and in{' '}
              <Link href="/runs" className="text-brand-500 hover:underline">Runs</Link>.
            </p>
            <p className="text-xs text-ink-500">
              Browse the full catalog any time and pick one to run.
            </p>
          </section>
        ) : (
          <ul className="space-y-3">
            {items.map((g, i) => {
              const detail = details[i];
              const safety = detail ? remoteSafety(detail) : remoteSafetyFromCard(g.card);
              const stepCount = detail?.steps.length ?? g.card.step_count;
              const cadence = g.card.cadence || g.routines[0]?.schedule_nl || null;
              const href = `/workflows/${encodeURIComponent(g.card.slug)}?source=${encodeURIComponent(g.card.source)}`;
              return (
                <li key={g.card.slug} className="card">
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="flex-1 min-w-[220px]">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Link href={href} className="text-base font-medium text-ink-50 hover:underline">
                          {g.card.name}
                        </Link>
                        <RemoteSafetyBadge safety={safety} size="xs" />
                        {g.anyActive ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">active</span>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-ink-800 text-ink-400">paused</span>
                        )}
                      </div>
                      {g.card.primary_outcome && (
                        <p className="text-sm text-ink-300 line-clamp-2">{g.card.primary_outcome}</p>
                      )}
                      <div className="text-xs text-ink-400 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {cadence && <span className="capitalize">{cadence}</span>}
                        <span className="text-ink-600">·</span>
                        <span>{stepCount} step{stepCount === 1 ? '' : 's'}</span>
                        <span className="text-ink-600">·</span>
                        <span>{g.totalRuns} run{g.totalRuns === 1 ? '' : 's'}</span>
                        <span className="text-ink-600">·</span>
                        <span>last {rel(g.lastRunAt)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                        <Link href={href} className="text-brand-500 hover:underline font-medium">View workflow</Link>
                        <Link href="/scheduled" className="text-ink-400 hover:text-ink-200 hover:underline">Routine</Link>
                        <Link href="/runs" className="text-ink-400 hover:text-ink-200 hover:underline">Runs</Link>
                      </div>
                    </div>
                    <div className="flex-none">
                      <CopyRunCommand slug={g.card.slug} kind="workflow" />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
