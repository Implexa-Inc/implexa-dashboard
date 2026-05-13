/**
 * Pricing page — clean 3-tier model (May 2026 rewrite).
 *
 *   🆓 Free        — unlimited skills, capture + share. Default for everyone.
 *   💎 Pro         — multi-seat, attribution, admin. "Coming soon" with waitlist.
 *   🏢 Enterprise  — SSO, audit, custom integrations. "Contact us."
 *
 * Bring your own Claude. Bring your own API keys (Fiber, Coresignal, etc.).
 * Implexa's marginal cost per user ≈ $0 — that's why unlimited free is real.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ProWaitlistButton from './pro-waitlist-button';

export const dynamic = 'force-dynamic';

type Plan = {
  slug:       'free' | 'pro' | 'enterprise';
  name:       string;
  priceLabel: string;
  priceSub:   string;
  tagline:    string;
  highlight?: boolean;
  bullets:    string[];
  ctaLabel:   string;
  ctaType:    'current' | 'waitlist' | 'contact' | 'signin';
};

const PLANS: Plan[] = [
  {
    slug:       'free',
    name:       'Free',
    priceLabel: '$0',
    priceSub:   'forever',
    tagline:    'Unlimited skills, no credit card.',
    bullets:    [
      '✨ Unlimited skill capture, fork, share',
      'Run in any Claude surface (Code, Desktop, Cursor, Cowork)',
      'Up to 3 seats per org',
      'Team-domain share links',
      '5 public share links / month',
      'Bring your own API keys (Fiber, Coresignal, Apollo)',
    ],
    ctaLabel:   'Default for new accounts',
    ctaType:    'current',
  },
  {
    slug:       'pro',
    name:       'Pro',
    priceLabel: '$20',
    priceSub:   '/ seat / month',
    tagline:    'Team unlock + attribution.',
    highlight:  true,
    bullets:    [
      'Everything in Free',
      'Unlimited seats',
      '📊 Attribution dashboard — see which skills drive outcomes',
      'Skill ROI tracking (the moat)',
      'Admin controls — promote/lock org skills',
      'Unlimited public share links',
      'Custom skill triggers',
      'Slack integration (when shipped)',
    ],
    ctaLabel:   'Join the waitlist',
    ctaType:    'waitlist',
  },
  {
    slug:       'enterprise',
    name:       'Enterprise',
    priceLabel: 'Custom',
    priceSub:   'contact us',
    tagline:    'For teams that need security + scale.',
    bullets:    [
      'Everything in Pro',
      'SSO / SAML',
      'Audit logs + compliance docs',
      'Custom integrations (Salesforce write, Bullhorn, etc.)',
      'Dedicated success manager',
      'Security review documentation',
      'White-label share pages',
    ],
    ctaLabel:   'Contact sales',
    ctaType:    'contact',
  },
];

export default async function PricingPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const isAuthed = !!session?.user;

  let currentPlan = 'free';
  let onWaitlist = false;
  let userId: string | null = null;
  if (isAuthed) {
    userId = session!.user.id;
    const { data: profile } = await supabase
      .from('users').select('id, organization_id')
      .eq('id', userId).maybeSingle();
    if (profile?.organization_id) {
      const { data: org } = await supabase
        .from('organizations').select('plan')
        .eq('id', profile.organization_id).maybeSingle();
      currentPlan = org?.plan || 'free';
    }
    const { data: w } = await supabase
      .from('pro_waitlist').select('id').eq('user_id', userId).maybeSingle();
    onWaitlist = !!w;
  }

  return (
    <main className="min-h-screen px-4 py-16">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-4">
          <div className="brand-mark text-xs mb-4 justify-center inline-flex">
            <span className="brand-mark-flame">⚡</span> Implexa
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-ink-50">Pricing</h1>
          <p className="text-ink-300 mt-3 max-w-2xl mx-auto">
            Bring your own Claude. Bring your own API keys. Implexa is free forever for unlimited skills —
            you pay for team features, not for using the product.
          </p>
        </header>

        {/* Trust strip */}
        <div className="text-center mb-12 text-xs text-ink-400">
          ✓ No metered usage  &nbsp;&middot;&nbsp;  ✓ No surprise bills  &nbsp;&middot;&nbsp;  ✓ Cancel anytime  &nbsp;&middot;&nbsp;  ✓ Your data, your control
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {PLANS.map((p) => {
            const isCurrent = currentPlan === p.slug;
            return (
              <div
                key={p.slug}
                className={`card flex flex-col ${isCurrent ? 'ring-2 ring-brand-500' : ''} ${
                  p.highlight ? '!border-brand-500/40 bg-gradient-to-b from-brand-50/5 to-transparent' : ''
                }`}
              >
                {p.highlight && (
                  <div className="text-[10px] uppercase tracking-wider font-bold text-brand-500 mb-2">
                    Most popular when teams join
                  </div>
                )}
                <h3 className="text-xl font-semibold text-ink-50">{p.name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <div className="text-3xl font-semibold text-ink-50">{p.priceLabel}</div>
                  <div className="text-xs text-ink-400">{p.priceSub}</div>
                </div>
                <p className="text-xs text-ink-300 mt-2 leading-relaxed">{p.tagline}</p>

                <ul className="mt-6 space-y-2 text-sm text-ink-200 flex-1">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex gap-2 leading-snug">
                      <span className="text-brand-500 mt-0.5 shrink-0">✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6">
                  {isCurrent
                    ? <button disabled className="btn w-full border border-ink-700 text-ink-500">Current plan</button>
                    : p.ctaType === 'current'
                      ? <span className="block text-xs text-ink-500 text-center py-2">{p.ctaLabel}</span>
                      : p.ctaType === 'waitlist'
                        ? (isAuthed
                            ? <ProWaitlistButton jwt={session!.access_token} alreadyOnWaitlist={onWaitlist} />
                            : <Link href="/signup" className="btn-primary w-full inline-flex items-center justify-center">Sign up to join waitlist</Link>)
                        : p.ctaType === 'contact'
                          ? <a href="mailto:sales@implexa.ai?subject=Implexa%20Enterprise%20inquiry" className="btn-outline w-full inline-flex items-center justify-center">{p.ctaLabel}</a>
                          : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Founding Creator strip */}
        <section className="mt-16 card !bg-gradient-to-r !from-success-400/10 !to-brand-500/10 !border-success-400/30">
          <div className="flex items-start gap-4">
            <div className="text-3xl shrink-0" aria-hidden="true">🏆</div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-ink-50 mb-1">
                Founding Creator perk
              </h2>
              <p className="text-sm text-ink-200 leading-relaxed">
                Capture a new skill <em>and</em> share it before we launch Pro publicly — and your first seat on Pro is <strong>free forever</strong>.
                Plus a Founding Creator badge on every skill you share. The earlier you ship, the more your library compounds.
              </p>
              {isAuthed && (
                <Link href="/skills" className="text-xs text-brand-600 hover:underline font-medium mt-3 inline-block">
                  See your library and start →
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* FAQ — bring-your-own ethos */}
        <section className="mt-16 grid md:grid-cols-2 gap-6">
          <FaqItem
            q="Why is everything unlimited on Free?"
            a="You bring your own Claude (you already pay Anthropic). You bring your own provider keys (Fiber, Coresignal, Apollo — you pay them direct). Our marginal cost per user is near zero, so unlimited isn't a marketing trick — it's the actual unit economics."
          />
          <FaqItem
            q="What do I pay for in Pro?"
            a="Team features: the attribution dashboard (only Implexa sees both skill invocations AND CRM/ATS outcomes), multi-seat admin controls, unlimited public sharing, and the data that proves which skills drive revenue. Solo users get full functional value on Free."
          />
          <FaqItem
            q="Can I cancel anytime?"
            a="Yes — and your skill library stays. We won't hold your data hostage. Export your captured skills as Markdown anytime, or stay on Free and keep using them indefinitely."
          />
          <FaqItem
            q="What about old credit-based plans?"
            a="If you're on a legacy Starter / Growth / Scale plan, your subscription continues as-is via Stripe — but the credit model is going away. We'll migrate you to the equivalent Pro tier before any change affects your access."
          />
        </section>
      </div>
    </main>
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
  description: 'Free forever — unlimited skills, no credit card. Pay only for team features when you outgrow solo.',
};
