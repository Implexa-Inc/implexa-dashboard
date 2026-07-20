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
 *
 * COMPOSITION BOUNDARY (2026-07-19). Run-level attention — Judge blocks and runs
 * held at a human gate — now comes from the backend's unified read
 * (GET /me/needs-you) instead of a direct skill_runs query here. Everything else
 * stays local, because the endpoint does NOT cover it:
 *
 *   • key/permission grants   (derived from the agent list)
 *   • account sign-ins        (derived from connection reachability)
 *   • missed/unarmed schedules(derived from scheduled_skills + cron)
 *   • stalled runs            (still a direct read — the endpoint deliberately
 *                              returns no stalls until recovery can say a human
 *                              is genuinely needed; see PR #52)
 *
 * So this is a COMPOSITION boundary, not a proxy. Replacing it wholesale with the
 * endpoint — which was the first proposed design — would have silently deleted
 * the four bullets above.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMyAgents, type MyAgent } from '@/lib/agents-home';
import { looksOverdue } from '@/lib/routine-status';
import { getConnectionStatus } from '@/lib/connections';
import { getAttention, type AttentionItem } from '@/lib/attention';

export type NeedGrant = { slug: string; name: string; reason: string };
export type MissedSchedule = { id: string; slug: string; name: string; failed: boolean; neverArmed: boolean; when: string; claudeTaskId: string | null };
export type SignIn = { domain: string; label: string; who: string; fixSlug: string; count: number };
export type Stalled = { id: string; slug: string; name: string };

export type NeedsYou = {
  needGrant: NeedGrant[];
  missed: MissedSchedule[];
  signIns: SignIn[];
  stalled: Stalled[];
  /**
   * RUN-LEVEL attention from the backend's unified read: Judge blocks AND runs
   * held at a human gate, as their own card shape.
   *
   * Deliberately NOT flattened into the old `Approval` type. A Judge block is not
   * an approval — it names a specific human requirement (provide information,
   * grant permission, open a service) that "Review & approve" would misdescribe,
   * and it resolves through a different endpoint. Forcing them into one shape
   * would make the card lie about both what happened and what to do.
   */
  attentionItems: AttentionItem[];
  /**
   * The subset shown on HOME: Judge blocks only. Held runs are omitted because
   * the Home Alerts section (RunningAgents alertsOnly) already owns them —
   * listing both would double-list the same run. Judge blocks are NOT in Alerts
   * (it polls /scheduled-skills/live, which has no notion of a verdict), so
   * without this they would be invisible on the landing page.
   */
  homeAttention: AttentionItem[];
  pendingReviews: number;
  /** Count of the agent/account-level items shown on the Home strip. */
  homeCount: number;
  /** Total attention count (drives the /connections empty state). */
  total: number;
  /**
   * The list could not be verified complete — a source failed, the endpoint was
   * unreachable, or the backend hit its ceiling. NO SURFACE MAY RENDER AN
   * ALL-CLEAR WHILE THIS IS TRUE: "Nothing needs you" over an unread source is
   * the silent-stop failure this whole feature exists to remove.
   */
  partial: boolean;
  truncated: boolean;
};

type SchedRow = {
  id: string; skill_slug: string; cron_expression: string | null;
  schedule_nl: string | null; status: string; last_run_at: string | null;
  claude_task_id: string | null;
};
type StalledRow = { id: string; skill_slug: string; ran_at: string; stalled_at: string | null };

export async function loadNeedsYou(supabase: SupabaseClient): Promise<NeedsYou> {
  const [status, myAgents, { data: schedules }, attention, { data: stalledRows }] = await Promise.all([
    getConnectionStatus(),
    getMyAgents(),
    supabase
      .from('scheduled_skills')
      .select('id, skill_slug, cron_expression, schedule_nl, status, last_run_at, claude_task_id')
      .in('status', ['active', 'failed'])
      .order('created_at', { ascending: false })
      .limit(100),
    // REPLACES the direct `review_status='pending'` read. The backend owns this
    // now, and covers strictly more: 'needs_input' holds as well as 'pending',
    // plus Judge blocks, each with the typed action that resolves it. Reading
    // skill_runs here as well would create a second read model that can disagree
    // with the first — the drift the backend derives (rather than copies) to avoid.
    getAttention(),
    // STAYS a direct read, deliberately. The backend read model passes
    // `stalls: []` on purpose: a stall enters Needs You only once recovery says a
    // human is genuinely needed, and that determination lives in the recovery work
    // (PR #52) which is not merged. Dropping this query now would delete stall
    // visibility from /connections in exchange for nothing — the same silent
    // functionality loss as replacing the whole loader. It moves to the unified
    // feed when the backend actually emits stalls, not before.
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
  // A scheduled routine with no claude_task_id was activated but NEVER ARMED in
  // Claude's runtime (the SessionStart reconcile that registers the cron never
  // ran — usually activated on web with the desktop closed). It physically can't
  // fire, so it's not a "missed run" (a one-time failure) — it's incomplete setup.
  // Surface it as "finish arming" REGARDLESS of overdue, and don't let an unarmed
  // routine masquerade as a recurring missed-schedule alarm forever.
  const isNeverArmed = (r: SchedRow) => r.status === 'active' && !r.claude_task_id;
  const missed: MissedSchedule[] = sched
    .filter((r) =>
      r.status === 'failed'
      || isNeverArmed(r)                                                              // setup incomplete
      || (r.status === 'active' && r.claude_task_id && looksOverdue(r.cron_expression || '', r.last_run_at)))  // armed but missed
    .map((r) => ({
      id: r.id,
      slug: r.skill_slug,
      name: nameBySlug.get(r.skill_slug) || r.skill_slug,
      failed: r.status === 'failed',
      neverArmed: isNeverArmed(r),
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

  // Run-level attention, straight from the backend's unified read. The agent name
  // is resolved here because the card carries a slug, and only this loader has the
  // slug→display-name map.
  const attentionItems: AttentionItem[] = attention.items.map((it) => ({
    ...it,
    agentSlug: it.agentSlug,
    agentName: it.agentSlug ? (nameBySlug.get(it.agentSlug) || it.agentSlug) : null,
  })) as AttentionItem[];
  const pendingReviews = attentionItems.filter((i) => i.sourceType === 'held_run').length;
  // Home now has a dedicated live "Alerts" section (RunningAgents alertsOnly)
  // that owns held-for-approval + stalled/failed runs, and a loud attention
  // banner for stalled ones. So the Home strip is ONLY the setup-level items
  // (a grant to give, an account to sign into, a missed schedule) — keeping
  // approvals/stalled here too produced a duplicate "needs you" section.
  // Judge blocks appear on HOME too. The Home "Alerts" section (RunningAgents
  // alertsOnly) polls /scheduled-skills/live, which knows about held/stalled/
  // failed runs and NOTHING about Judge — so without this a blocked verdict would
  // be invisible on the page the user actually lands on. Held runs are excluded
  // here precisely because Alerts already owns them; listing both would duplicate.
  const homeAttention = attentionItems.filter((i) => i.sourceType === 'judge_block');
  // setupCount is the shared base. total must NOT be homeCount + attentionItems:
  // homeCount already folds in homeAttention (the Judge blocks), and
  // attentionItems contains those SAME Judge blocks, so adding both counts every
  // Judge block twice — a card that renders once but inflates the badge and, at
  // the boundary, could keep /connections out of its empty state on nothing.
  const setupCount = needGrant.length + missed.length + signIns.length;
  const homeCount = setupCount + homeAttention.length;
  // /connections (variant=full) shows everything: setup items + ALL run-level
  // attention (Judge blocks AND held runs, once each) + stalls.
  const total = setupCount + attentionItems.length + stalled.length;

  return {
    needGrant, missed, signIns, stalled, attentionItems, homeAttention, pendingReviews, homeCount, total,
    // Carried all the way to the surface so an empty list can never be mistaken
    // for a verified all-clear.
    partial: attention.partial,
    truncated: attention.truncated,
  };
}
