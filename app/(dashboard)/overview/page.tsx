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
import { RunAttentionBanner, type AttentionItem } from '../_components/run-attention-banner';
import NeedsYouStrip from '../_components/needs-you-strip';
import FirstWinMoment from '../_components/first-win-moment';
import InboxList from '../inbox/inbox-list';
import FirstRunMagic from '../_components/first-run-magic';
import TalkToImplexa from '../_components/talk-to-implexa';
import GetStartedIntent from '../_components/get-started-intent';
import OnboardingProgress, { type OnboardingStep } from '../_components/onboarding-progress';

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

  // The loud surface: any run that did not finish cleanly (stalled, or a
  // permission-blocked failure) gets a banner at the very top, so a stuck run is
  // impossible to miss. It renders nothing in the calm common case.
  const attentionItems: AttentionItem[] = items.map((it) => ({
    id: it.id, name: it.name, info: it.state, ran_at: it.ran_at,
  }));

  return (
    <main className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-3xl mx-auto">
        <Suspense fallback={null}><GetStartedIntent connected={connected} /></Suspense>

        {/* Resume-anytime onboarding bar — vanishes once all steps are done. */}
        <OnboardingProgress steps={onboardingSteps} />

        {isFirstRun ? (
          <>
            <TalkToImplexa hasAgents={false} guided={guided} suggestions={suggested} />
            <FirstRunMagic workflows={catalog} />
          </>
        ) : (
          <>
            <TalkToImplexa hasAgents={myAgents.length > 0} guided={guided} suggestions={suggested} />

            {/* first-win celebration -> tailored 2nd agent (fires once, early users) */}
            <FirstWinMoment
              delivered={items.length}
              nextTitle={suggested[0]?.title}
              nextIntent={suggested[0]?.suggested_intent}
            />

            {/* a stalled or permission-blocked run, loud and at the top */}
            <div className="mt-8">
              <RunAttentionBanner items={attentionItems} />
            </div>

            {/* needs you: grants to give, accounts to sign into, missed schedules,
                each with one action (folds in the old "Needs you" surface) */}
            <NeedsYouStrip data={needsYou} variant="home" className="mt-8" />

            {/* the one todo: every run as a colored todo, acted on in a pop-up */}
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
