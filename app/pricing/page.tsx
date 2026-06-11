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
          Build, run, and manage hundreds of agents on the Claude or Codex subscription you
          already have. Free for your one-person company. Pro when your team joins. We never
          charge for AI compute, because your agents run on yours.
        </p>
      </header>

      {/* Trust strip */}
      <div className="text-center mb-10 text-xs text-ink-400">
        ✓ Runs on your machine  &nbsp;·&nbsp;  ✓ No metered usage  &nbsp;·&nbsp;  ✓ No surprise bills  &nbsp;·&nbsp;  ✓ Cancel anytime
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
                Build an agent <em>and</em> share it publicly. Your seat on Pro becomes
                <strong> free for life</strong> — no checkout, no card. Plus a Founding Creator badge on every agent
                you share. The earliest builders get permanent perks.
              </p>
              {isAuthed && (
                <a href="/workflows" className="text-xs text-brand-500 hover:underline font-medium mt-3 inline-block">
                  See your agents and start →
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="mt-16 grid md:grid-cols-2 gap-6">
        <FaqItem
          q="Why is it free?"
          a="Your agents run in YOUR Claude or Codex, on the subscription you already pay for. We never run AI compute for you, so we never charge for it. Implexa is the control plane: building, activating, scheduling, and watching your agents."
        />
        <FaqItem
          q="What do I need to start?"
          a="A Claude (or Codex) subscription and the free Implexa app. Describe a job in a sentence; Implexa builds the agent, walks you through a one-time activation, and it runs on your machine."
        />
        <FaqItem
          q="What is Pro actually for?"
          a="People. Free covers everything a one-person company needs. Pro adds seats, a shared agent library (one teammate builds it, everyone runs it), team results, and priority support."
        />
        <FaqItem
          q="Do agents run when my laptop is closed?"
          a="Today runs happen on your machine (the desktop app keeps your Mac awake, and the watchdog tells you if a schedule ever misses). When Claude and Codex ship cloud automations, your routines will be able to schedule there too: still your subscription, still your data."
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
  description: 'Build, run, and manage hundreds of agents on your existing Claude or Codex subscription. Free for individuals; Pro for teams at $19/seat/month.',
};
