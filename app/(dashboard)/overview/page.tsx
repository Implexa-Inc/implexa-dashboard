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
import SuggestedShelf from '../_components/suggested-shelf';
import FirstRunMagic from '../_components/first-run-magic';
import TalkToImplexa from '../_components/talk-to-implexa';
import GetStartedIntent from '../_components/get-started-intent';
import { Suspense } from 'react';
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

// A "see all" chip for the Home rail. count>0 shows an amber badge so a pending
// queue (results to review, agents needing attention) is glanceable.
function NavChip({ href, label, count = 0 }: { href: string; label: string; count?: number }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/40 px-3.5 py-2 text-sm text-ink-200 hover:border-ink-500 hover:text-ink-50 transition-colors"
    >
      {label}
      {count > 0 && (
        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold bg-amber-400 text-ink-950">
          {count > 99 ? '99+' : count}
        </span>
      )}
      <span aria-hidden className="text-ink-500">→</span>
    </Link>
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
        <Suspense fallback={null}><GetStartedIntent /></Suspense>
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

        {/* Inbox: a few recent runs (clean), then the rail to the full surfaces.
            Founder: "show max 2-3, then click to see all". The big agent grid +
            the long results list moved behind these links to keep Home calm. */}
        <section className="mt-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">Inbox</h2>
            <Link href="/inbox" className="text-xs text-ink-400 hover:text-ink-200">all results →</Link>
          </div>
          {recentRuns.length === 0 ? (
            <div className="card p-5 text-sm text-ink-400">
              No runs yet. Describe an agent above and it shows up here.
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              {recentRuns.slice(0, 3).map((r, i) => (
                <Link
                  key={r.id}
                  href={`/inbox?run=${r.id}`}
                  className={`flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-ink-900/40 transition-colors ${i > 0 ? 'border-t border-ink-800/60' : ''}`}
                >
                  <span className="text-sm text-ink-100 truncate">{nameBySlug.get(r.skill_slug) || humanize(r.skill_slug)}</span>
                  <div className="flex items-center gap-2.5 flex-none">
                    <RunStateBadge info={deriveRunState(r)} size="xs" />
                    <span className="text-xs text-ink-500">{rel(r.ran_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* the see-all rail: the three places to go deeper */}
          <div className="mt-3 flex flex-wrap gap-2.5">
            <NavChip href="/workflows" label={`Your Agents${myAgents.length ? ` (${myAgents.length})` : ''}`} />
            <NavChip href="/inbox" label="Results" />
            <NavChip
              href="/connections"
              label="Needs you"
              count={(pendingCount ?? 0) + overdue.length + failedSchedules.length}
            />
          </div>
        </section>

        {/* suggested for you - the learning-driven shelf */}
        <SuggestedShelf suggestions={suggested} />
        </>
        )}
      </div>
    </main>
  );
}
