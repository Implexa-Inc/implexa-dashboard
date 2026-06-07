/**
 * /overview: mission control for the autopilot loop.
 *
 * One glance at whether Implexa is working FOR you: active routines, anything
 * overdue (the N1 watchdog), runs this week + last delivery, recent runs, and
 * "what implexa noticed" (the same recommendation feed the daily digest emails).
 * Server-rendered, RLS-scoped to the caller via the Supabase server client.
 *
 * The precise overdue signal is the backend watchdog (drives the email); here we
 * use the coarse lib/routine-status helper for the at-a-glance count.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { looksOverdue } from '@/lib/routine-status';
import CopyRunCommand from '../_components/copy-run-command';
import FirstRunMagic from '../_components/first-run-magic';
import TalkToImplexa from '../_components/talk-to-implexa';
import { listWorkflows, listMyWorkflows, listSuggestedAgents, type MyWorkflowCard, type SuggestedAgent } from '@/lib/workflow-catalog';

export const dynamic = 'force-dynamic';

type Scheduled = {
  id: string;
  skill_slug: string;
  cron_expression: string;
  status: 'active' | 'paused' | 'failed';
  last_run_at: string | null;
  post_run_action: { type: string; repo?: string } | null;
};

type Run = {
  id: string;
  skill_slug: string;
  status: 'completed' | 'failed' | 'partial';
  ran_at: string;
  source: string;
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

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'ok' | 'warn' }) {
  const valueColor = tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-50';
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${valueColor}`}>{value}</div>
    </div>
  );
}

function statusDot(status: Run['status']) {
  const c = status === 'completed' ? 'bg-emerald-500 dark:bg-emerald-400' : status === 'partial' ? 'bg-amber-500 dark:bg-amber-400' : 'bg-rose-500 dark:bg-rose-400';
  return <span className={`inline-block size-2 rounded-full ${c}`} aria-hidden="true" />;
}

export default async function OverviewPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id, display_name')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

  const [{ data: schedules }, { data: runs }, { count: pendingCount }] = await Promise.all([
    supabase
      .from('scheduled_skills')
      .select('id, skill_slug, cron_expression, status, last_run_at, post_run_action')
      .in('status', ['active', 'paused', 'failed'])
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('skill_runs')
      .select('id, skill_slug, status, ran_at, source')
      .order('ran_at', { ascending: false })
      .limit(50),
    supabase
      .from('skill_runs')
      .select('id', { count: 'exact', head: true })
      .eq('review_status', 'pending'),
  ]);

  const sched: Scheduled[] = (schedules as Scheduled[]) || [];
  const allRuns: Run[] = (runs as Run[]) || [];

  const active = sched.filter((s) => s.status === 'active');
  const overdue = active.filter((s) => s.status === 'active' && looksOverdue(s.cron_expression, s.last_run_at));
  const failedSchedules = sched.filter((s) => s.status === 'failed');
  const runsThisWeek = allRuns.filter((r) => r.ran_at >= weekAgo).length;
  const lastRunAt = allRuns[0]?.ran_at || null;
  const recentRuns = allRuns.slice(0, 6);

  // Manager's-desk data: the user's own agents + the learning-driven shelf.
  const [myAgents, suggested] = await Promise.all([
    listMyWorkflows(),
    listSuggestedAgents(6),
  ]);

  // First-run magic: a brand-new user (no routines, no runs) gets THE OFFER
  // instead of an empty mission control. Fetch the featured catalog only then.
  const isFirstRun = active.length === 0 && allRuns.length === 0;
  const featured = isFirstRun ? await listWorkflows() : [];

  const firstName = (profile.display_name || '').split(' ')[0] || '';

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-5xl mx-auto">
        {!isFirstRun && (
          <header className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-ink-50">
              {firstName ? `Welcome back, ${firstName}` : 'Home'}
            </h1>
            <p className="text-ink-300 text-sm mt-1">
              Your agents and what they produced. They run in your Claude or Codex, on a schedule, and get sharper from your feedback.
            </p>
          </header>
        )}

        {isFirstRun ? (
          <FirstRunMagic workflows={featured} connected={false} firstName={firstName} />
        ) : (
        <>

        <TalkToImplexa />

        {/* stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <StatCard label="Your agents" value={myAgents.length} />
          <StatCard label="Need attention" value={overdue.length + failedSchedules.length} tone={overdue.length + failedSchedules.length > 0 ? 'warn' : undefined} />
          <StatCard label="Runs this week" value={runsThisWeek} tone={runsThisWeek > 0 ? 'ok' : undefined} />
          <StatCard label="Last run" value={rel(lastRunAt)} />
        </div>

        {/* deliverables waiting for approval, the inbox cross-link */}
        {(pendingCount ?? 0) > 0 && (
          <section className="mb-8">
            <Link
              href="/inbox"
              className="flex items-center justify-between gap-3 rounded-lg border border-brand-500/40 bg-brand-500/10 p-5 hover:bg-brand-500/15 transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-ink-50">
                  {pendingCount} deliverable{pendingCount === 1 ? '' : 's'} waiting for you
                </div>
                <div className="text-xs text-ink-300 mt-0.5">
                  Routines produced these and held them for your review. Approve what you shipped.
                </div>
              </div>
              <span className="text-sm text-brand-500 font-medium whitespace-nowrap">Open inbox →</span>
            </Link>
          </section>
        )}

        {/* needs attention */}
        {overdue.length + failedSchedules.length > 0 && (
          <section className="mb-8">
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-5">
              <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-200 uppercase tracking-wider mb-3">Needs attention</h2>
              <ul className="space-y-2">
                {[...overdue, ...failedSchedules].map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-mono text-amber-900 dark:text-amber-100">{s.skill_slug}</span>
                    <span className="text-xs text-amber-700 dark:text-amber-300/80">
                      {s.status === 'failed' ? 'failed' : `did not run (last ${rel(s.last_run_at)})`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-200/70">
                A local routine only fires while your machine is awake. Move it to a remote routine so it runs even when you are offline.{' '}
                <Link href="/scheduled" className="underline font-medium">Manage routines</Link>
              </p>
            </div>
          </section>
        )}

        {/* your agents */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-ink-200 uppercase tracking-wider">Your agents</h2>
            <Link href="/workflows" className="text-xs text-brand-500 hover:underline">all agents →</Link>
          </div>
          {myAgents.length === 0 ? (
            <div className="card text-sm text-ink-400">
              No agents yet. Tell Implexa what to do above, and it builds your first one.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {myAgents.slice(0, 6).map((a) => (
                <Link key={a.workflow_id} href={`/workflows/${a.slug}`} className="card p-4 hover:border-brand-500/40 transition-colors block">
                  <div className="text-sm font-medium text-ink-50 truncate">{a.name}</div>
                  <div className="text-xs text-ink-400 mt-1 line-clamp-2">{a.description || a.primary_outcome || `${a.step_count} steps`}</div>
                  <div className="text-[11px] text-ink-500 mt-2 flex items-center gap-2">
                    <span>{a.is_scheduled ? 'scheduled' : 'manual'}</span>
                    <span aria-hidden>·</span>
                    <span>last run {rel(a.last_run_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* recent results */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-ink-200 uppercase tracking-wider">Recent results</h2>
              <Link href="/runs" className="text-xs text-brand-500 hover:underline">all runs</Link>
            </div>
            {recentRuns.length === 0 ? (
              <div className="card text-sm text-ink-400">
                No runs yet. Schedule a workflow and it will run on its own.{' '}
                <Link href="/scheduled" className="text-brand-500 hover:underline">Set one up</Link>.
              </div>
            ) : (
              <ul className="space-y-2">
                {recentRuns.map((r) => (
                  <li key={r.id} className="card flex items-center justify-between gap-3 py-3">
                    <Link href="/runs" className="flex items-center gap-2 min-w-0 group">
                      {statusDot(r.status)}
                      <span className="font-mono text-sm text-ink-100 truncate group-hover:underline">{r.skill_slug}</span>
                    </Link>
                    <span className="flex items-center gap-2 flex-none">
                      <span className="text-xs text-ink-500">{rel(r.ran_at)}</span>
                      <CopyRunCommand slug={r.skill_slug} kind="workflow" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* suggested for you (always learning) */}
          <section>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-medium text-ink-200 uppercase tracking-wider">Suggested for you</h2>
              <span className="text-[11px] text-ink-500">always learning</span>
            </div>
            <p className="text-xs text-ink-400 mb-3">
              Agents to add, from what you and others keep doing by hand. Describe one above and Implexa builds it.
            </p>
            {suggested.length === 0 ? (
              <div className="card text-sm text-ink-400">
                Nothing yet. As you work, Implexa learns what to suggest here.
              </div>
            ) : (
              <ul className="space-y-2">
                {suggested.map((s, i) => (
                  <li key={`${s.kind}-${s.workflow_slug || s.skill_slug || i}`} className="card py-3">
                    <div className="text-sm text-ink-100 font-medium truncate">{s.title}</div>
                    <div className="text-xs text-ink-400 mt-0.5 line-clamp-2">{s.reason}</div>
                    <div className="text-[11px] text-ink-500 mt-1">{s.kind === 'popular' ? 'popular agent' : 'suggested for you'}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        </>
        )}
      </div>
    </main>
  );
}
