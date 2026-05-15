/**
 * Pricing page — public-facing AND in-dashboard.
 *
 *   🆓 Free        — 5 skills/month capture, unlimited use. Default.
 *   💎 Pro         — $19/mo or $190/yr (2 months free). Unlimited captures
 *                     + ROI dashboard + team library + priority support.
 *   🏢 Enterprise  — Custom. Talk to sales.
 *
 * Founding Creators (users with `founding_creator_unlocked_at`) see a
 * banner above the cards: "Pro is free for you." Their Upgrade button
 * is disabled and labeled "Included".
 *
 * Layout strategy:
 *   - Not signed in → public marketing layout (no sidebar). The page is
 *     reachable from the homepage / footer / share links.
 *   - Signed in     → render INSIDE the dashboard shell (sidebar + topbar).
 *     Logged-in users coming from /settings/billing → Upgrade should keep
 *     their nav context. We mirror the same user/org/setup-status fetch
 *     the (dashboard) layout does so the Sidebar renders consistently.
 *
 * Server component fetches user/plan state once, hands to client component
 * for interactive billing-cycle toggle + upgrade flow.
 */

import { createClient } from '@/lib/supabase/server';
import { computeSetupStatus } from '@/lib/setup-status';
import { Logo } from '@/components/logo';
import Sidebar, { MobileTopBar } from '@/app/(dashboard)/_components/sidebar';
import PricingClient from './pricing-client';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const isAuthed = !!session?.user;

  let currentPlan = 'free';
  let isFoundingCreator = false;
  let userCtx: {
    displayName:       string | null;
    email:             string;
    plan:              string;
    isFoundingCreator: boolean;
    setupStatus:       'active' | 'idle' | 'stale' | 'never';
    lastSeenAt:        string | null;
  } | null = null;

  if (isAuthed) {
    // Pull the same shape the (dashboard) layout needs so we can render the
    // Sidebar consistently. One query — all fields.
    const { data: profile } = await supabase
      .from('users')
      .select('id, organization_id, display_name, email, founding_creator_unlocked_at, last_mcp_call_at, last_hook_event_at')
      .eq('id', session!.user.id)
      .maybeSingle();

    isFoundingCreator = !!profile?.founding_creator_unlocked_at;

    if (profile?.organization_id) {
      const { data: org } = await supabase
        .from('organizations').select('plan')
        .eq('id', profile.organization_id).maybeSingle();
      currentPlan = org?.plan || 'free';
    }

    if (profile) {
      const setup = computeSetupStatus(profile.last_mcp_call_at, profile.last_hook_event_at);
      userCtx = {
        displayName:       profile.display_name,
        email:             profile.email,
        plan:              currentPlan,
        isFoundingCreator,
        setupStatus:       setup.status,
        lastSeenAt:        setup.lastSeenAt,
      };
    }
  }

  // Inner content — the actual pricing page body, no <main> wrapper here
  // since the outer wrapper differs by auth state (dashboard layout
  // already provides <main className="flex-1">; public layout provides
  // its own). Avoids nested <main> elements.
  const inner = (
    <div className="max-w-6xl mx-auto">
      <header className="text-center mb-8">
        <div className="mb-4 flex justify-center"><Logo height={18} /></div>
        <h1 className="text-4xl font-semibold tracking-tight text-ink-50">Pricing</h1>
        <p className="text-ink-300 mt-3 max-w-2xl mx-auto leading-relaxed">
          Bring your own Claude. Bring your own API keys. Free to start with 5 skill captures per
          month and unlimited usage. Upgrade to Pro when you outgrow solo.
        </p>
      </header>

      {/* Trust strip */}
      <div className="text-center mb-10 text-xs text-ink-400">
        ✓ No metered usage  &nbsp;·&nbsp;  ✓ No surprise bills  &nbsp;·&nbsp;  ✓ Cancel anytime  &nbsp;·&nbsp;  ✓ Your data, your control
      </div>

      <PricingClient
        isAuthed={isAuthed}
        currentPlan={currentPlan}
        isFoundingCreator={isFoundingCreator}
      />

      {/* Founding Creator promo strip — only for non-FC visitors (don't double-show) */}
      {!isFoundingCreator && (
        <section className="mt-16 card !bg-gradient-to-r !from-accent-400/10 !to-brand-500/8 !border-accent-400/40">
          <div className="flex items-start gap-4">
            <div className="text-3xl shrink-0" aria-hidden="true">🏆</div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-ink-50 mb-1">
                Skip Pro entirely — become a Founding Creator.
              </h2>
              <p className="text-sm text-ink-200 leading-relaxed">
                Capture a new skill <em>and</em> share it publicly. Your seat on Pro becomes
                <strong> free for life</strong> — no checkout, no card. Plus a Founding Creator badge on every skill
                you share. The earliest people who help compound the skill graph get permanent perks.
              </p>
              {isAuthed && (
                <a href="/skills" className="text-xs text-brand-500 hover:underline font-medium mt-3 inline-block">
                  See your library and start →
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="mt-16 grid md:grid-cols-2 gap-6">
        <FaqItem
          q="What's the difference between 'capture' and 'use'?"
          a="Capture = recording a new skill from a demonstration. Use = running an existing skill (yours, your team's, or a base Playbook). Free caps capture at 5/month but lets you USE skills unlimited times — the moat-building work has a cap, the value-receiving work is free."
        />
        <FaqItem
          q="What counts toward my 5 captures?"
          a="Only NEW skills you author via /implexa:record-skill (or save_workflow_as_skill). Forking a Playbook doesn't count. Running an existing skill doesn't count. Editing a fork into your own version counts once. So onboarding (which forks 5–10 Playbooks) leaves your capture quota fully intact."
        />
        <FaqItem
          q="Monthly or annual?"
          a="Annual saves you 2 full months — same Pro, ~17% cheaper. Switch anytime via the Stripe Customer Portal in Settings → Billing. We don't lock you in."
        />
        <FaqItem
          q="Can I cancel anytime?"
          a="Yes. Cancellations take effect at the end of your current billing period — you keep Pro features until then. After that you revert to Free. Your skill library always stays with you."
        />
      </section>
    </div>
  );

  // Logged-in users get the dashboard shell (Sidebar + MobileTopBar) so they
  // don't lose their nav context when arriving here from /settings/billing.
  // Logged-out users get a clean public-marketing layout.
  if (userCtx) {
    return (
      <div className="flex min-h-screen">
        <Sidebar user={userCtx} />
        <div className="flex-1 flex flex-col min-w-0">
          <MobileTopBar user={userCtx} />
          <main className="flex-1 px-4 py-16">{inner}</main>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen px-4 py-16">{inner}</main>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="card !p-4">
      <div className="text-sm font-medium text-ink-50 mb-1">{q}</div>
      <p className="text-xs text-ink-300 leading-relaxed">{a}</p>
    </div>
  );
}

export const metadata = {
  title:       'Pricing — Implexa',
  description: 'Free forever — 5 skill captures per month, unlimited use. Pro at $19/month or $190/year (2 months free).',
};
