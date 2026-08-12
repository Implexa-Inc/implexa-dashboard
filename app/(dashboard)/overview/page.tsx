/**
 * /overview — Home, the manager's desk. THREE zones, in the order a manager
 * actually thinks (2026-07-24 redesign):
 *
 *   BUILD    — what should I delegate next? (describe it, or take a suggestion)
 *   TODAY    — what do my agents need from me? (ONE list, one all-clear)
 *   RESULTS  — what did they produce? (recent finished runs; /inbox is the archive)
 *
 * WHAT CHANGED AND WHY. Home had grown to eight stacked blocks, three of which
 * ("Alerts", "Set up", the todo Inbox) all answered "what needs me?" using three
 * different keying models — per-run live, per-agent/account/schedule, and per-run
 * server-rendered. They were hand-deduped against each other, but the reader
 * still had to check three places, and the page could render its own "Nothing
 * needs you" all-clear directly beneath a section listing real work.
 *
 * <TodayFeed> is now the single answer to that question and the only thing
 * allowed to claim the all-clear (it is a client component precisely so it can
 * see BOTH the live alert count and the server-known setup count). Results makes
 * a narrower, non-overlapping statement about deliverables only, so the two can
 * never contradict each other.
 *
 * Server-rendered, RLS-scoped to the caller. Home and /inbox still share one
 * loader (lib/inbox) so there is a single source of truth for run results.
 */

import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadInboxItems } from '@/lib/inbox';
import { loadNeedsYou } from '@/lib/needs-you';
import { attentionWarning } from '@/lib/attention';
import { getProficiency, isGuided } from '@/lib/proficiency';
import { isExecutorConnected } from '@/lib/connection';
import { listWorkflows, listMyWorkflows, listSuggestedAgents } from '@/lib/workflow-catalog';
import TodayFeed from '../_components/today-feed';
import FirstWinMoment from '../_components/first-win-moment';
import InboxList from '../inbox/inbox-list';
import FirstRunMagic from '../_components/first-run-magic';
import TalkToImplexa from '../_components/talk-to-implexa';
import BuildingAgents from '../_components/building-agents';
import GetStartedIntent from '../_components/get-started-intent';
import FirstRunPermissionsNote from '../_components/first-run-permissions-note';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id, display_name, last_mcp_call_at, last_hook_event_at')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // The todo list + "needs you" (grants/sign-ins/missed) + the manager's-desk
  // side data (own agents, learning shelf, public catalog for first-run cards).
  const [items, needsYou, myAgents, suggested, catalog, proficiency] = await Promise.all([
    loadInboxItems(supabase, 40),
    loadNeedsYou(supabase),
    listMyWorkflows(),
    listSuggestedAgents(6),
    listWorkflows(),
    getProficiency(supabase, session.user.id),
  ]);
  const guided = isGuided(proficiency);

  // "Connected" uses the ONE shared definition (isExecutorConnected) so Home and
  // the hard-gate never disagree. Reaching /overview already implies connected
  // (the gate redirects never-connected users to /get-app), but we compute it
  // properly so the page is self-consistent. The old check ("an active API key
  // row exists") diverged from the gate and made Home show "Download the app /
  // Connect your Claude" to users the gate had already let in.
  const connected = await isExecutorConnected(supabase, profile.id, {
    lastMcpCallAt: profile.last_mcp_call_at, lastHookEventAt: profile.last_hook_event_at,
  });
  // NOTE: the web onboarding checklist (experience level / starter agents /
  // connect) was removed — onboarding now happens IN THE APP (tiered onboarding),
  // and the hard-gate guarantees the user is connected before Home renders, so
  // the checklist only ever showed stale "connect" steps to connected users.

  // First-run magic: a brand-new user (no agents, no runs) gets THE OFFER
  // instead of an empty todo list.
  const isFirstRun = myAgents.length === 0 && items.length === 0;

  // First-run permissions heads-up: shown once to a user who hasn't had a run
  // finish cleanly yet. A completed run anywhere in the todo clears it (and the
  // component self-clears via localStorage once seen).
  const hasSucceededRun = items.some((it) => it.state?.state === 'completed');

  // (Stalled / failed runs surface inside <TodayFeed> — per-run, dismissible, and
  // suppressing a failure/stall the agent has already recovered from. The old
  // always-on <RunAttentionBanner> duplicated that and never cleared a stale
  // failure, so it was removed.)

  return (
    <main className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-3xl mx-auto">
        <Suspense fallback={null}><GetStartedIntent connected={connected} /></Suspense>

        {/* One-time heads-up: a first run may pause for a permission. Clears itself
            after it's seen / once a run has finished cleanly. */}
        <FirstRunPermissionsNote active={!hasSucceededRun} />

        {isFirstRun ? (
          <>
            <TalkToImplexa hasAgents={false} guided={guided} suggestions={suggested} connected={connected} />
            <BuildingAgents />
            <FirstRunMagic workflows={catalog} />
          </>
        ) : (
          <>
            <TalkToImplexa hasAgents={myAgents.length > 0} guided={guided} suggestions={suggested} connected={connected} />
            <BuildingAgents />

            {/* first-win celebration -> tailored 2nd agent (fires once, early users) */}
            <FirstWinMoment
              delivered={items.length}
              nextTitle={suggested[0]?.title}
              nextIntent={suggested[0]?.suggested_intent}
            />


            {/* ZONE 2 — TODAY. The one "what needs me?" surface: live run-keyed
                alerts (held, needs-attention with the Manager's diagnosis, failed,
                queued) plus the setup blockers no run represents (grants,
                sign-ins, missed schedules, Judge verdicts). Owns the all-clear. */}
            <TodayFeed
              data={needsYou}
              warning={attentionWarning({ partial: needsYou.partial, truncated: needsYou.truncated, live: !needsYou.partial })}
              className="mt-8"
            />

            {/* ZONE 3 — RESULTS. Deliverables only, newest first. Its empty state
                makes a statement about RESULTS, never about whether anything needs
                you — that is Today's to make, and the two must not be able to
                contradict each other (they did, on the old page). */}
            <section className="mt-10">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 className="text-xs font-semibold text-ink-300 uppercase tracking-wide">Results</h2>
                {items.length > 0 && (
                  <Link href="/work?view=delivered" className="text-xs text-ink-500 hover:text-ink-300 hover:underline">
                    View all →
                  </Link>
                )}
              </div>
              {items.length === 0 ? (
                <div className="card p-6 text-center">
                  <p className="text-ink-300 text-sm">No results yet.</p>
                  <p className="text-ink-500 text-sm mt-1">
                    Describe an agent above. When it runs, what it produced shows up here.
                  </p>
                </div>
              ) : (
                <InboxList initialItems={items} basePath="/overview" />
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
