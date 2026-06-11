'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Plan = 'free' | 'pro' | 'enterprise';
type BillingCycle = 'monthly' | 'annual';

type Props = {
  isAuthed:          boolean;
  currentPlan:       Plan | string;
  isFoundingCreator: boolean;
};

const FREE_FEATURES = [
  '🤖 Unlimited agents: describe a job in a sentence, Implexa builds it',
  '▶️ Unlimited runs and schedules, on the Claude or Codex you already pay for',
  '🧱 Steps grounded in a 40,000+ community skill catalog (license-checked)',
  '🖥️ The Implexa desktop app: guided activation, one-click tool installs, a dedicated browser workspace for your agents',
  '📬 Results inbox with review gates: nothing posts without you',
  '🔔 Watchdog + alerts: know when a run finishes, stalls, or misses',
  '🔒 Runs on YOUR machine, on YOUR subscription: your data never executes on our servers',
] as const;

const PRO_FEATURES = [
  'Everything in Free, plus:',
  '👥 Seats for your team in one workspace',
  '📚 Shared agent library: one person builds it, the whole team runs it',
  '🔗 One-click share links for your agents',
  '📊 Team results: see what every agent delivered across the team',
  '📧 Priority support from the founders',
  '🚀 Early access to new agent packs and features',
] as const;

const CLOUD_FEATURES = [
  'Our thesis: we never run your AI for you.',
  '☁️ When Claude and Codex ship cloud automations, your Implexa routines will schedule there too',
  '💤 Agents run even when your laptop is closed',
  '🏷️ Remote-safe agents are already flagged in your library today',
  '💳 Still your subscription doing the work: we stay the control plane',
] as const;

export default function PricingClient({ isAuthed, currentPlan, isFoundingCreator }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [cycle, setCycle] = useState<BillingCycle>('annual');                              // default annual (more savings, anchors the value)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPro = currentPlan === 'pro';

  async function handleUpgrade() {
    if (!isAuthed) {
      router.push('/signup?next=/pricing');
      return;
    }
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session expired — please sign in again');

      const res = await callBackend('/api/v2/billing/checkout', {
        jwt:    session.access_token,
        method: 'POST',
        body:   { plan: 'pro', billingCycle: cycle, returnUrl: `${window.location.origin}/settings/billing` },
      });

      if (res?.url) {
        // Redirect to Stripe-hosted checkout
        window.location.href = res.url;
      } else {
        throw new Error('Checkout session did not return a URL');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upgrade failed';
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <>
      {/* Founding Creator notice — shows ABOVE pricing when applicable */}
      {isAuthed && isFoundingCreator && (
        <div className="mb-10 rounded-lg border border-success-400/40 bg-gradient-to-r from-accent-400/10 to-brand-500/8 p-5">
          <div className="flex items-start gap-4">
            <span className="text-3xl leading-none" aria-hidden="true">🏆</span>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-ink-50 mb-1">You&apos;re a Founding Creator — Pro is free for life.</h2>
              <p className="text-sm text-ink-200 leading-relaxed mb-3">
                Your seat on Pro is permanently included with your Founding Creator status. No checkout needed.
                Everything in Pro is already unlocked for you.
              </p>
              <Link href="/settings/billing" className="text-xs text-brand-500 hover:underline font-medium">
                Manage your seat →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Billing cycle toggle */}
      {!isFoundingCreator && (
        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ink-700 bg-ink-800/40">
            <button
              type="button"
              onClick={() => setCycle('monthly')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                cycle === 'monthly' ? 'bg-brand-500 text-ink-950' : 'text-ink-300 hover:text-ink-100'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle('annual')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                cycle === 'annual' ? 'bg-brand-500 text-ink-950' : 'text-ink-300 hover:text-ink-100'
              }`}
            >
              Annual
              <span className={`text-[9px] uppercase tracking-wider font-bold rounded px-1 py-0.5 ${
                cycle === 'annual'
                  ? 'bg-ink-950/15 text-ink-950'
                  : 'bg-success-400/20 text-success-700 dark:text-success-400'
              }`}>
                2 months free
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Pricing cards */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Free */}
        <PlanCard
          name="Free"
          priceLabel="$0"
          priceSub="forever"
          tagline="The whole product, for your one-person company."
          bullets={FREE_FEATURES}
          isCurrent={currentPlan === 'free' && !isFoundingCreator}
          cta={
            currentPlan === 'free' && !isFoundingCreator
              ? <DisabledBtn label="Current plan" />
              : <span className="block text-xs text-ink-500 text-center py-2">Default for every new account</span>
          }
        />

        {/* Pro */}
        <PlanCard
          name="Pro"
          priceLabel={cycle === 'annual' ? '$15.83' : '$19'}
          priceSub={cycle === 'annual' ? '/ seat / mo — billed $190/yr' : '/ seat / month'}
          tagline="For when your team joins your agents."
          highlight
          bullets={PRO_FEATURES}
          isCurrent={isPro || isFoundingCreator}
          cta={
            isFoundingCreator
              ? <DisabledBtn label="✓ Included (Founding Creator)" green />
              : isPro
                ? <DisabledBtn label="Current plan" />
                : <button onClick={handleUpgrade} disabled={loading} className="btn-primary w-full">
                    {loading ? 'Loading…' : `Upgrade to Pro (${cycle === 'annual' ? 'Annual' : 'Monthly'})`}
                  </button>
          }
          extraNote={error ? <p className="text-xs text-red-500 mt-2">{error}</p> : null}
        />

        {/* Cloud routines (roadmap teaser, not purchasable) */}
        <PlanCard
          name="Cloud routines"
          priceLabel="Soon"
          priceSub="on the roadmap"
          tagline="Runs even when your laptop is closed."
          bullets={CLOUD_FEATURES}
          isCurrent={false}
          cta={<DisabledBtn label="Coming when the vendors ship it" />}
        />
      </div>
    </>
  );
}

function PlanCard({
  name,
  priceLabel,
  priceSub,
  tagline,
  bullets,
  highlight,
  isCurrent,
  cta,
  extraNote,
}: {
  name:       string;
  priceLabel: string;
  priceSub:   string;
  tagline:    string;
  bullets:    readonly string[];
  highlight?: boolean;
  isCurrent?: boolean;
  cta:        React.ReactNode;
  extraNote?: React.ReactNode;
}) {
  return (
    <div className={`card flex flex-col ${isCurrent ? 'ring-2 ring-brand-500' : ''} ${
      highlight ? '!border-brand-500/40 bg-gradient-to-b from-brand-500/5 to-transparent' : ''
    }`}>
      {highlight && (
        <div className="text-[10px] uppercase tracking-wider font-bold text-brand-500 mb-2">
          Most popular
        </div>
      )}
      <h3 className="text-xl font-semibold text-ink-50">{name}</h3>
      <div className="mt-2 flex items-baseline gap-1">
        <div className="text-3xl font-semibold text-ink-50 tabular-nums">{priceLabel}</div>
        <div className="text-xs text-ink-400">{priceSub}</div>
      </div>
      <p className="text-xs text-ink-300 mt-2 leading-relaxed">{tagline}</p>

      <ul className="mt-6 space-y-2 text-sm text-ink-200 flex-1">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2 leading-snug">
            <span className="text-brand-500 mt-0.5 shrink-0">✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">{cta}</div>
      {extraNote}
    </div>
  );
}

function DisabledBtn({ label, green }: { label: string; green?: boolean }) {
  return (
    <button disabled className={`btn w-full border ${green ? 'border-success-400/40 text-success-700 dark:text-success-400' : 'border-ink-700 text-ink-500'}`}>
      {label}
    </button>
  );
}
