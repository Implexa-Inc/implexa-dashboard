/**
 * lib/needs-you.ts , the "needs you" attention list, in one place.
 *
 * The 2-section redesign drops the "Needs you" nav item; its actionable items
 * fold into Home. The agent/account-level ones (a grant to give, an account to
 * sign into, a missed schedule) surface as a strip ABOVE the Home todo; the
 * run-level ones (results to review, a stalled run) are already the Home todo +
 * the attention banner, so the Home strip omits them to avoid double-listing.
 *
 * Both Home and the still-live /connections route load from here, so there is a
 * single source of truth for "what is waiting on the user".
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMyAgents, type MyAgent } from '@/lib/agents-home';
import { looksOverdue } from '@/lib/routine-status';
import { getConnectionStatus } from '@/lib/connections';

export type NeedGrant = { slug: string; name: string; reason: string };
export type MissedSchedule = { id: string; slug: string; name: string; failed: boolean; when: string; claudeTaskId: string | null };
export type SignIn = { domain: string; label: string; who: string; fixSlug: string; count: number };
export type Stalled = { id: string; slug: string; name: string };
/** A run held at a human-approval gate, awaiting the user's approve-&-continue. */
export type Approval = { id: string; slug: string; name: string };

export type NeedsYou = {
  needGrant: NeedGrant[];
  missed: MissedSchedule[];
  signIns: SignIn[];
  stalled: Stalled[];
  approvals: Approval[];
  pendingReviews: number;
  /** Count of the agent/account-level items shown on the Home strip. */
  homeCount: number;
  /** Total attention count (drives the /connections empty state). */
  total: number;
};

type SchedRow = {
  id: string; skill_slug: string; cron_expression: string | null;
  schedule_nl: string | null; status: string; last_run_at: string | null;
  claude_task_id: string | null;
};
type StalledRow = { id: string; skill_slug: string; ran_at: string; stalled_at: string | null };

export async function loadNeedsYou(supabase: SupabaseClient): Promise<NeedsYou> {
  const [status, myAgents, { data: schedules }, { data: pendingRows }, { data: stalledRows }] = await Promise.all([
    getConnectionStatus(),
    getMyAgents(),
    supabase
      .from('scheduled_skills')
      .select('id, skill_slug, cron_expression, schedule_nl, status, last_run_at, claude_task_id')
      .in('status', ['active', 'failed'])
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('skill_runs')
      .select('id, skill_slug, ran_at')
      .eq('review_status', 'pending')
      .order('ran_at', { ascending: false })
      .limit(20),
    supabase
      .from('skill_runs')
      .select('id, skill_slug, ran_at, stalled_at')
      .eq('run_state', 'stalled')
      .gte('ran_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order('ran_at', { ascending: false })
      .limit(10),
  ]);

  const allMyAgents: MyAgent[] = myAgents ? [...myAgents.active, ...myAgents.needsActivation] : [];
  const nameBySlug = new Map(allMyAgents.map((a) => [a.slug, a.name]));

  const needGrant: NeedGrant[] = allMyAgents
    .filter((a) => a.needsIntervention)
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      reason: a.interventionReason || 'A permission needs your OK before it can really run.',
    }));

  const sched = ((schedules as SchedRow[]) || []).filter((r) => r.cron_expression);
  const missed: MissedSchedule[] = sched
    .filter((r) => r.status === 'failed' || (r.status === 'active' && looksOverdue(r.cron_expression || '', r.last_run_at)))
    .map((r) => ({
      id: r.id,
      slug: r.skill_slug,
      name: nameBySlug.get(r.skill_slug) || r.skill_slug,
      failed: r.status === 'failed',
      when: r.schedule_nl || r.cron_expression || 'its schedule',
      claudeTaskId: r.claude_task_id || null,
    }));

  // Accounts a specific agent needs that are signed out, grouped by domain so
  // one account = one item naming WHO needs it + a link to fix it.
  const signInMap = new Map<string, { label: string; domain: string; agents: { slug: string; name: string }[] }>();
  for (const a of (status?.agents || [])) {
    for (const n of a.needs) {
      if (n.status !== 'unreachable') continue;
      const e = signInMap.get(n.domain);
      if (e) { if (!e.agents.some((x) => x.slug === a.slug)) e.agents.push({ slug: a.slug, name: a.name }); }
      else signInMap.set(n.domain, { label: n.label, domain: n.domain, agents: [{ slug: a.slug, name: a.name }] });
    }
  }
  const signIns: SignIn[] = [...signInMap.values()].map((s) => ({
    domain: s.domain,
    label: s.label,
    who: s.agents.length === 1 ? s.agents[0].name : `${s.agents.length} agents`,
    fixSlug: s.agents[0].slug,
    count: s.agents.length,
  }));

  const stalled: Stalled[] = ((stalledRows as StalledRow[]) || []).map((r) => ({
    id: r.id,
    slug: r.skill_slug,
    name: nameBySlug.get(r.skill_slug) || r.skill_slug,
  }));

  // Runs held at a human-approval gate (review_status='pending'): actionable —
  // the user reads the deliverable, approves, and the gated work continues.
  const approvals: Approval[] = ((pendingRows as { id: string; skill_slug: string }[]) || []).map((r) => ({
    id: r.id,
    slug: r.skill_slug,
    name: nameBySlug.get(r.skill_slug) || r.skill_slug,
  }));
  const pendingReviews = approvals.length;
  // Approvals are actionable, so they belong ON the Home strip (not just the
  // /connections full view).
  const homeCount = needGrant.length + missed.length + signIns.length + approvals.length;
  const total = homeCount + stalled.length;

  return { needGrant, missed, signIns, stalled, approvals, pendingReviews, homeCount, total };
}
