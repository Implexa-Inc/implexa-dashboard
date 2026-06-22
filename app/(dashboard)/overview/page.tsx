/**
 * /overview , Home. The one todo inbox (the 2-section redesign).
 *
 * Home is now a single surface: describe an agent at the top, then your one
 * todo list below , every run as a colored todo (red = take action, amber =
 * give feedback, green = done), each acted on in a pop-up (output, feedback,
 * review) without leaving the page. This absorbs the old Results feed; the
 * "agents are everywhere" confusion (Home / Agents / Results / Needs you) is
 * gone , there are two places now: Home (this todo) and Your Agents.
 *
 * Server-rendered, RLS-scoped to the caller. The todo + its next-action chips +
 * the pop-ups all live in InboxList; Home and the still-live /inbox route share
 * one loader (lib/inbox) so there is a single source of truth for "needs you".
 */

import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { loadInboxItems } from '@/lib/inbox';
import { loadNeedsYou } from '@/lib/needs-you';
import { getProficiency, isGuided } from '@/lib/proficiency';
import { listWorkflows, listMyWorkflows, listSuggestedAgents } from '@/lib/workflow-catalog';
import NeedsYouStrip from '../_components/needs-you-strip';
import RunningAgents from '../_components/running-agents';
import FirstWinMoment from '../_components/first-win-moment';
import InboxList from '../inbox/inbox-list';
import FirstRunMagic from '../_components/first-run-magic';
import TalkToImplexa from '../_components/talk-to-implexa';
import BuildingAgents from '../_components/building-agents';
import GetStartedIntent from '../_components/get-started-intent';
import OnboardingProgress, { type OnboardingStep } from '../_components/onboarding-progress';
import FirstRunPermissionsNote from '../_components/first-run-permissions-note';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id, display_name')
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

  // Onboarding progress (persistent until every step is genuinely done). Each
  // step is a real signal: experience level set, ≥1 agent, a live connection.
  // The connection check = does an active API key exist (an install happened).
  const { data: activeKeys } = await supabase
    .from('api_keys').select('id').eq('user_id', profile.id).eq('status', 'active').limit(1);
  const connected = (activeKeys || []).length > 0;
  const onboardingSteps: OnboardingStep[] = [
    { label: 'Set your experience level', href: '/onboarding/proficiency', done: proficiency != null },
    { label: 'Add your starter agents',    href: '/onboarding/role',        done: myAgents.length > 0 },
    { label: 'Connect your Claude or Codex', href: '/install',              done: connected },
  ];

  // First-run magic: a brand-new user (no agents, no runs) gets THE OFFER
  // instead of an empty todo list.
  const isFirstRun = myAgents.length === 0 && items.length === 0;

  // First-run permissions heads-up: shown once to a user who hasn't had a run
  // finish cleanly yet. A completed run anywhere in the todo clears it (and the
  // component self-clears via localStorage once seen).
  const hasSucceededRun = items.some((it) => it.state?.state === 'completed');

  // (Stalled / failed runs surface in the run-based Alerts list below — see
  // <RunningAgents alertsOnly /> — which is per-run, dismissible, and suppresses
  // a failure/stall the agent has already recovered from. The old always-on
  // <RunAttentionBanner> duplicated that and never cleared a stale failure, so
  // it was removed.)

  return (
    <main className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-3xl mx-auto">
        <Suspense fallback={null}><GetStartedIntent connected={connected} /></Suspense>

        {/* One-time heads-up: a first run may pause for a permission. Clears itself
            after it's seen / once a run has finished cleanly. */}
        <FirstRunPermissionsNote active={!hasSucceededRun} />

        {/* Resume-anytime onboarding bar — vanishes once all steps are done. */}
        <OnboardingProgress steps={onboardingSteps} />

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


            {/* Alerts: agents that need you right now (held for approval,
                stalled, failed), polled from /scheduled-skills/live — each links
                into the run. Invisible when nothing needs you. */}
            <div className="mt-8">
              <RunningAgents alertsOnly />
            </div>

            {/* Set up: grants to give, accounts to sign into, missed schedules —
                each with one action. (Approvals/stalled now live in Alerts.) */}
            <NeedsYouStrip data={needsYou} variant="home" className="mt-8" />

            {/* Inbox: every run as a colored todo, acted on in a pop-up */}
            <section className="mt-10">
              {items.length === 0 ? (
                <div className="card p-6 text-center">
                  <div className="text-2xl mb-2" aria-hidden="true">✓</div>
                  <p className="text-ink-100 font-medium">Nothing needs you yet.</p>
                  <p className="text-ink-400 text-sm mt-1">
                    Describe an agent above. When it runs, its work shows up here as a todo.
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
