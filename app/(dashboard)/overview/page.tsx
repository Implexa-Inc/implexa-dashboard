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
import { selectRuns, deriveRunState, type RunRow } from '@/lib/run-state';
import { RunStateBadge } from '../_components/run-state-badge';
import { RunAttentionBanner, type AttentionItem } from '../_components/run-attention-banner';
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

function rel(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Last-resort label so a recent result never renders as a bare slug when the
// public catalog has no matching card (e.g. a private, generated agent).
function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

export default async function OverviewPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id, display_name')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

  const [{ data: schedules }, allRuns, { count: pendingCount }] = await Promise.all([
    supabase
      .from('scheduled_skills')
      .select('id, skill_slug, cron_expression, status, last_run_at, post_run_action')
      .in('status', ['active', 'paused', 'failed'])
      .order('created_at', { ascending: false })
      .limit(100),
    // Live run state (running / stalled / done / failed). Reads the 0065
    // run_state columns when present, degrades to the terminal status otherwise.
    selectRuns(supabase, { limit: 50 }),
    supabase
      .from('skill_runs')
      .select('id', { count: 'exact', head: true })
      .eq('review_status', 'pending'),
  ]);

  const sched: Scheduled[] = (schedules as Scheduled[]) || [];

  const active = sched.filter((s) => s.status === 'active');
  const overdue = active.filter((s) => s.status === 'active' && looksOverdue(s.cron_expression, s.last_run_at));
  const failedSchedules = sched.filter((s) => s.status === 'failed');
  const runsThisWeek = allRuns.filter((r) => r.ran_at >= weekAgo).length;
  const lastRunAt = allRuns[0]?.ran_at || null;
  const recentRuns = allRuns.slice(0, 6);

  // Manager's-desk data: the user's own agents + the learning-driven shelf +
  // the public catalog (used both for first-run featured cards and to give
  // recent results a friendly agent name instead of a raw slug).
  const [myAgents, suggested, catalog] = await Promise.all([
    listMyWorkflows(),
    listSuggestedAgents(6),
    listWorkflows(),
  ]);
  const nameBySlug = new Map(catalog.map((c) => [c.slug, c.name]));

  // Live run state for the recent feed + the attention banner. The banner shows
  // only the ones that need a look (stalled, or a permission-blocked failure);
  // it renders nothing in the calm common case.
  const attentionItems: AttentionItem[] = allRuns.map((r) => ({
    id: r.id,
    name: nameBySlug.get(r.skill_slug) || humanize(r.skill_slug),
    info: deriveRunState(r),
    ran_at: r.ran_at,
  }));

  // First-run magic: a brand-new user (no agents, no runs) gets THE OFFER
  // instead of an empty mission control.
  const isFirstRun = active.length === 0 && allRuns.length === 0;
  const featured = isFirstRun ? catalog : [];

  const firstName = (profile.display_name || '').split(' ')[0] || '';

  return (
    <main className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-6xl mx-auto">
        {isFirstRun ? (
          <>
            <TalkToImplexa hasAgents={false} />
            <FirstRunMagic workflows={featured} />
          </>
        ) : (
        <>

        <TalkToImplexa hasAgents={myAgents.length > 0} />

        {/* a stalled or permission-blocked run, loud and at the top - silence is never success */}
        <div className="mt-8">
          <RunAttentionBanner items={attentionItems} />
        </div>

        {/* your agents */}
        <section className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">Your agents</h2>
            {myAgents.length > 0 && (
              <Link href="/workflows" className="text-xs text-ink-400 hover:text-ink-200">all agents</Link>
            )}
          </div>
          {myAgents.length === 0 ? (
            <div className="card p-5 text-sm text-ink-400">
              No agents yet. Describe one above and Implexa builds your first.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {myAgents.slice(0, 9).map((a) => (
                <Link key={a.workflow_id} href={`/workflows/${a.slug}`} className="card p-5 hover:border-ink-600 transition-colors block">
                  <div className="text-sm font-medium text-ink-50 truncate">{a.name}</div>
                  <div className="text-xs text-ink-400 mt-1.5 line-clamp-2">{a.description || a.primary_outcome || `${a.step_count} steps`}</div>
                  <div className="text-[11px] text-ink-500 mt-3 flex items-center gap-2">
                    <span>{a.is_scheduled ? 'scheduled' : 'manual'}</span>
                    <span aria-hidden>·</span>
                    <span>last run {rel(a.last_run_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* recent results */}
        {recentRuns.length > 0 && (
          <section className="mt-12">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">Recent results</h2>
              <Link href="/inbox" className="text-xs text-ink-400 hover:text-ink-200">all results</Link>
            </div>
            <ul>
              {recentRuns.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3 border-b border-ink-800/60 last:border-0">
                  <Link href="/inbox" className="min-w-0 group">
                    <span className="text-sm text-ink-200 truncate group-hover:text-ink-50">{nameBySlug.get(r.skill_slug) || humanize(r.skill_slug)}</span>
                  </Link>
                  <div className="flex items-center gap-2.5 flex-none">
                    <RunStateBadge info={deriveRunState(r)} size="xs" />
                    <span className="text-xs text-ink-500">{rel(r.ran_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* quiet status footer: review queue + attention, muted (no loud banners) */}
        {((pendingCount ?? 0) > 0 || overdue.length + failedSchedules.length > 0) && (
          <div className="mt-12 pt-6 border-t border-ink-800 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-500">
            {(pendingCount ?? 0) > 0 && (
              <Link href="/inbox" className="hover:text-ink-300">{pendingCount} result{pendingCount === 1 ? '' : 's'} to review</Link>
            )}
            {overdue.length + failedSchedules.length > 0 && (
              <Link href="/scheduled" className="hover:text-ink-300">{overdue.length + failedSchedules.length} agent{overdue.length + failedSchedules.length === 1 ? '' : 's'} need attention</Link>
            )}
          </div>
        )}
        </>
        )}
      </div>
    </main>
  );
}
