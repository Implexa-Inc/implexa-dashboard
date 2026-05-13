/**
 * Billing settings — current plan, credit balance, period end, manage button
 * (opens Stripe Customer Portal).
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import PortalButton from './portal-button';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  let sub: any = {};
  try {
    sub = await callBackend('/api/v2/billing/subscription', { jwt: session.access_token });
  } catch (_) {}

  const periodEnd = sub.subscriptionPeriodEnd ? new Date(sub.subscriptionPeriodEnd).toLocaleDateString() : '—';

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <nav className="text-sm text-ink-500 mb-6">
          <Link href="/skills" className="hover:underline">Skills</Link> &middot;{' '}
          <Link href="/settings/billing" className="text-ink-100">Billing</Link>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
        </header>

        <div className="card space-y-4">
          <div className="flex justify-between items-baseline">
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide">Current plan</div>
              <div className="text-2xl font-semibold mt-1 capitalize">{sub.plan || 'free'}</div>
              <div className="text-sm text-ink-500 mt-1">
                Status: <span className="font-medium text-ink-200 capitalize">{sub.planStatus || 'active'}</span>
              </div>
            </div>
            <Link href="/pricing" className="btn-ghost border border-ink-700">Change plan</Link>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-ink-700">
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide">Credit balance</div>
              <div className="text-xl font-semibold mt-1 tabular-nums">{sub.creditBalance ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide">Monthly quota</div>
              <div className="text-xl font-semibold mt-1 tabular-nums">{sub.monthlyCreditQuota ?? 500}</div>
            </div>
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide">Period ends</div>
              <div className="text-lg mt-1 tabular-nums">{periodEnd}</div>
            </div>
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide">Stripe customer</div>
              <div className="text-lg mt-1">{sub.hasStripeCustomer ? 'Yes' : 'No'}</div>
            </div>
          </div>

          {sub.hasStripeCustomer && (
            <div className="pt-4 border-t border-ink-700">
              <PortalButton jwt={session.access_token} />
              <p className="text-xs text-ink-500 mt-2">
                Open the Stripe portal to update your card, view past invoices, or cancel your subscription.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
