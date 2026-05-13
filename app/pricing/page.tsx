/**
 * Pricing page — four tiers + checkout buttons.
 * Server-rendered with current plan highlighted; client component handles
 * the checkout-session call.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import CheckoutButton from './checkout-button';

export const dynamic = 'force-dynamic';

type Plan = {
  slug:        'free' | 'starter' | 'growth' | 'pro';
  name:        string;
  priceLabel:  string;
  credits:     string;
  bullets:     string[];
  cta:         'current' | 'upgrade' | 'contact';
};

const PLANS: Plan[] = [
  { slug: 'free',    name: 'Free',    priceLabel: '$0',       credits: '500 / month',     bullets: ['11 plugin skills', '14 external-data tools', 'Org skill sharing', 'Public share links'],                              cta: 'upgrade' },
  { slug: 'starter', name: 'Starter', priceLabel: '$19 /mo',  credits: '10,000 / month',  bullets: ['Everything in Free', 'Team-gated share links', 'Outcome attribution', '90-day session history'],                       cta: 'upgrade' },
  { slug: 'growth',  name: 'Growth',  priceLabel: '$49 /mo',  credits: '50,000 / month',  bullets: ['Everything in Starter', 'Multi-team admin', 'Skill benchmarks vs your peers', 'Priority support'],                     cta: 'upgrade' },
  { slug: 'pro',     name: 'Pro',     priceLabel: '$149 /mo', credits: '200,000 / month', bullets: ['Everything in Growth', 'SSO + SAML', 'Audit log', 'Universal-share credit grants', 'Dedicated onboarding'],            cta: 'upgrade' },
];

export default async function PricingPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  let currentPlan = 'free';
  try {
    const sub = await callBackend('/api/v2/billing/subscription', { jwt: session.access_token });
    currentPlan = sub.plan || 'free';
  } catch (_) { /* no sub yet */ }

  return (
    <main className="min-h-screen px-4 py-16">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-semibold tracking-tight">Pick a plan</h1>
          <p className="text-ink-500 mt-2">Simple credit-based pricing. Cancel anytime.</p>
        </header>

        <div className="grid md:grid-cols-4 gap-4">
          {PLANS.map((p) => {
            const isCurrent = currentPlan === p.slug;
            return (
              <div key={p.slug} className={`card flex flex-col ${isCurrent ? 'ring-2 ring-brand-500' : ''}`}>
                <h3 className="text-xl font-semibold">{p.name}</h3>
                <div className="mt-2 text-3xl font-semibold">{p.priceLabel}</div>
                <div className="text-xs text-ink-500 mt-1">{p.credits}</div>

                <ul className="mt-6 space-y-2 text-sm text-ink-200 flex-1">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="text-brand-500 mt-0.5">✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6">
                  {isCurrent
                    ? <button disabled className="btn w-full border border-ink-700 text-ink-500">Current plan</button>
                    : p.slug === 'free'
                      ? <span className="block text-xs text-ink-500 text-center py-2">Default for new accounts</span>
                      : <CheckoutButton jwt={session.access_token} plan={p.slug} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
