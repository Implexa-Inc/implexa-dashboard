/**
 * Billing settings — current plan, seat count, period end, Stripe portal.
 *
 * Implexa moved off metered credits in May 2026. Every plan has unlimited
 * skill capture, fork, share, run. Billing surface now shows plan + seats
 * instead of credit balance + quota.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import PortalButton from './portal-button';

export const dynamic = 'force-dynamic';

const PLAN_LABEL: Record<string, string> = {
  free:       'Free',
  pro:        'Pro',
  enterprise: 'Enterprise',
  // legacy plans still recognized for grandfathered customers
  starter:    'Starter (legacy)',
  growth:     'Growth (legacy)',
  scale:      'Scale (legacy)',
};

export default async function BillingPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // Pull org + plan + Founding Creator from Supabase directly (cheap, RLS-scoped)
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

  // Skill creation quota — count NEW (non-fork) skills captured by this user
  // this calendar month. Drives the "3/5 captured" gauge.
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const { count: capturedThisMonth } = await supabase
    .from('org_skills')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', profile?.organization_id)
    .eq('created_by->>userId', profile?.id)
    .is('forked_from_skill_id', null)
    .gte('created_at', startOfMonth.toISOString());
  const captured = capturedThisMonth || 0;
  const isFoundingCreatorEarly = !!profile?.founding_creator_unlocked_at;
  const captureLimit = (plan === 'free' && !isFoundingCreatorEarly) ? 5 : null;

  // Subscription/Stripe state (only meaningful for paid plans)
  let sub: any = {};
  try {
    sub = await callBackend('/api/v2/billing/subscription', { jwt: session.access_token });
  } catch (_) {}
  const periodEnd = sub.subscriptionPeriodEnd ? new Date(sub.subscriptionPeriodEnd).toLocaleDateString() : null;

  const isPaidPlan = plan !== 'free';
  const seatsLimit = plan === 'free' ? 3 : null;
  const isFoundingCreator = !!profile?.founding_creator_unlocked_at;

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <nav className="text-sm text-ink-500 mb-6">
          <Link href="/skills" className="hover:underline">Skills</Link> &middot;{' '}
          <Link href="/settings/billing" className="text-ink-100">Billing</Link>
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
              <div className="flex items-baseline gap-2 mt-1">
                <div className="text-2xl font-semibold text-ink-50">{PLAN_LABEL[plan] || plan}</div>
                {isFoundingCreator && (
                  <span className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-success-400/20 text-success-700 dark:text-success-400">
                    🏆 Founding Creator
                  </span>
                )}
              </div>
              <div className="text-sm text-ink-400 mt-1">
                ✨ Unlimited skills — capture, share, fork, run
              </div>
            </div>
            <Link href="/pricing" className="btn-outline">Compare plans</Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-ink-700">
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide">Skills captured this month</div>
              <div className="text-xl font-semibold mt-1 tabular-nums text-ink-50">
                {captureLimit
                  ? <>{captured}<span className="text-ink-400 text-sm font-normal"> / {captureLimit}</span></>
                  : <>{captured}<span className="text-ink-400 text-sm font-normal"> (unlimited)</span></>}
              </div>
              {captureLimit && captured >= captureLimit && (
                <div className="text-[10px] text-accent-700 dark:text-accent-400 mt-1">At capture cap — upgrade or wait until next month</div>
              )}
              {captureLimit && captured === captureLimit - 1 && (
                <div className="text-[10px] text-ink-400 mt-1">1 capture left this month</div>
              )}
            </div>
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide">Seats</div>
              <div className="text-xl font-semibold mt-1 tabular-nums text-ink-50">
                {seatCount}{seatsLimit ? <span className="text-ink-400 text-sm font-normal"> / {seatsLimit}</span> : null}
              </div>
              {seatsLimit && seatCount >= seatsLimit && (
                <div className="text-[10px] text-accent-700 dark:text-accent-400 mt-1">At seat limit — upgrade for unlimited</div>
              )}
            </div>
            {periodEnd ? (
              <div>
                <div className="text-xs text-ink-500 uppercase tracking-wide">Renews</div>
                <div className="text-lg mt-1 tabular-nums text-ink-100">{periodEnd}</div>
              </div>
            ) : (
              <div>
                <div className="text-xs text-ink-500 uppercase tracking-wide">Skill runs</div>
                <div className="text-lg mt-1 text-ink-100">Unlimited</div>
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

        {/* Founding Creator card (only on free plan, only once unlocked) */}
        {isFoundingCreator && !isPaidPlan && (
          <div className="card !bg-gradient-to-r !from-success-400/10 !to-brand-500/10 !border-success-400/30">
            <div className="flex items-start gap-3">
              <div className="text-2xl shrink-0">🏆</div>
              <div className="flex-1">
                <h2 className="text-sm font-medium text-ink-50 mb-1">
                  Founding Creator perk applies to your account
                </h2>
                <p className="text-xs text-ink-300 leading-relaxed">
                  When the Pro tier launches, your first seat is <strong>free forever</strong>.
                  You&apos;ll see this reflected automatically — no action needed.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Free-plan encouragement to capture + share */}
        {plan === 'free' && !isFoundingCreator && (
          <div className="card !bg-brand-50 !border-brand-500/30">
            <div className="flex items-start gap-3">
              <div className="text-2xl shrink-0">🪙</div>
              <div className="flex-1">
                <h2 className="text-sm font-medium text-ink-50 mb-1">
                  Become a Founding Creator
                </h2>
                <p className="text-xs text-ink-300 leading-relaxed mb-2">
                  Capture and share your first new skill to unlock the Founding Creator badge
                  and your first Pro seat free forever (when Pro launches).
                </p>
                <Link href="/skills" className="text-xs text-brand-600 hover:underline font-medium">
                  Start on /skills →
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
