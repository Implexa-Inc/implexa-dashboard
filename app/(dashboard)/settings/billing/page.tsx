/**
 * Billing settings , plan + (for teams) seats + Stripe portal.
 *
 * Locked vision: the single-person product is FREE forever , unlimited agents
 * that run in the user's own Claude/Codex, no per-run metering, no second AI
 * bill. Money is made on Team (shared agents) and Enterprise. So this surface
 * shows the plan + what it includes + the upgrade path , NO capture quotas, no
 * skill-run meters, no Pro/Playbook framing (all of which were the old model).
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import PortalButton from './portal-button';

export const dynamic = 'force-dynamic';

const PLAN_LABEL: Record<string, string> = {
  free:       'Free',
  team:       'Team',
  enterprise: 'Enterprise',
  pro:        'Team', // legacy 'pro' rows map to Team
};

export default async function BillingPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id, founding_creator_unlocked_at')
    .eq('id', session.user.id).maybeSingle();

  let plan = 'free';
  let seatCount = 1;
  let orgName = '';
  if (profile?.organization_id) {
    const { data: org } = await supabase
      .from('organizations').select('name, plan')
      .eq('id', profile.organization_id).maybeSingle();
    plan = org?.plan || 'free';
    orgName = org?.name || '';
    const { count } = await supabase
      .from('users').select('id', { count: 'exact', head: true })
      .eq('organization_id', profile.organization_id);
    seatCount = count || 1;
  }

  let sub: { subscriptionPeriodEnd?: string | null; hasStripeCustomer?: boolean } = {};
  try {
    sub = await callBackend('/api/v2/billing/subscription', { jwt: session.access_token });
  } catch (_) { /* free plan / no subscription */ }
  const periodEnd = sub.subscriptionPeriodEnd ? new Date(sub.subscriptionPeriodEnd).toLocaleDateString() : null;

  const isFree = plan === 'free';
  const isFoundingCreator = !!profile?.founding_creator_unlocked_at;

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <nav className="text-xs text-ink-500 mb-4">
          <Link href="/settings" className="hover:underline">← Settings</Link>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Billing</h1>
          {orgName && <p className="text-sm text-ink-400 mt-1">{orgName}</p>}
        </header>

        {/* Plan card */}
        <div className="card space-y-4 mb-6">
          <div className="flex justify-between items-baseline gap-4 flex-wrap">
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide">Current plan</div>
              <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                <div className="text-2xl font-semibold text-ink-50">{PLAN_LABEL[plan] || plan}</div>
                {isFoundingCreator && (
                  <span className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-success-400/20 text-success-700 dark:text-success-400">
                    🏆 Founding Creator
                  </span>
                )}
              </div>
              <div className="text-sm text-ink-400 mt-1 max-w-md leading-relaxed">
                {isFree
                  ? 'Unlimited agents, built and run in your own Claude or Codex. No per-run metering, no second AI bill , free forever for one person.'
                  : 'Everything in Free, plus a shared agent library, every teammate’s runs and results in one place, and roles.'}
              </div>
            </div>
            <Link href="/pricing" className="btn-outline">Compare plans</Link>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-ink-700">
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide">Members</div>
              <div className="text-xl font-semibold mt-1 tabular-nums text-ink-50">{seatCount}</div>
              <Link href="/settings/team" className="text-[10px] text-brand-600 hover:underline mt-0.5 inline-block">
                Manage team →
              </Link>
            </div>
            {periodEnd && (
              <div>
                <div className="text-xs text-ink-500 uppercase tracking-wide">Renews</div>
                <div className="text-lg mt-1 tabular-nums text-ink-100">{periodEnd}</div>
              </div>
            )}
          </div>

          {sub.hasStripeCustomer && (
            <div className="pt-4 border-t border-ink-700">
              <PortalButton jwt={session.access_token} />
              <p className="text-xs text-ink-500 mt-2">
                Open the Stripe portal to update your card, view invoices, or cancel.
              </p>
            </div>
          )}
        </div>

        {/* Upgrade path , only on Free, framed as Team (shared agents). */}
        {isFree && (
          <div className="card !border-brand-500/40">
            <div className="flex items-start gap-3">
              <div className="text-2xl shrink-0" aria-hidden="true">👥</div>
              <div className="flex-1">
                <h2 className="text-sm font-medium text-ink-50 mb-1">Running agents with a team?</h2>
                <p className="text-xs text-ink-200 leading-relaxed mb-3">
                  Team adds a shared agent library (build once, the whole team runs it), everyone&apos;s
                  runs and results in one place, and roles. $20 per seat / month. Your solo use stays free.
                </p>
                <Link href="/pricing" className="btn-primary inline-flex items-center justify-center text-sm py-1.5 px-4">
                  See plans →
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
