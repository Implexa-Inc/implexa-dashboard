/**
 * /integrations — the integration catalog.
 *
 * Three sections:
 *   1. 🟢 Available now            — wireable today via API key / OAuth
 *   2. 💡 Recommended for you      — dynamically ranked from the user's recent
 *                                    skill runs that hit stubbed external tools
 *   3. 🔘 Coming soon              — the full roadmap, grouped by category,
 *                                    with "Notify me" to capture demand
 *
 * The recommended section is the demand-capture surface: when a user's skill
 * tried to call `lookup_company` but the Fiber adapter is stubbed, this page
 * shows "Looks like your skills tried Fiber 4× this week — want to be first
 * to know when we ship it?" and lets them opt-in to the launch list.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  INTEGRATIONS,
  integrationsForTool,
  integrationsByCategory,
  type Integration,
} from '@/lib/integrations';
import IntegrationCard from './integration-card';

export const dynamic = 'force-dynamic';

type Recommendation = {
  integration: Integration;
  reason: string;
  hits: number;
};

export default async function IntegrationsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id, display_name, email')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // ── 1. Build the "Recommended for you" list ────────────────────────────
  //
  // Pull the last 30 days of MCP tool calls from this user's org. For each
  // tool that maps to a coming-soon integration, count occurrences. Top 3 by
  // hit count become the recommendation.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentToolCalls } = await supabase
    .from('mcp_session_logs')
    .select('tool_name')
    .eq('organization_id', profile.organization_id)
    .gte('started_at', thirtyDaysAgo)
    .limit(2000);

  const toolHitCounts = new Map<string, number>();
  for (const row of recentToolCalls || []) {
    if (!row.tool_name) continue;
    toolHitCounts.set(row.tool_name, (toolHitCounts.get(row.tool_name) || 0) + 1);
  }

  const integrationHits = new Map<string, { integration: Integration; hits: number; topTool: string }>();
  for (const [toolName, hits] of toolHitCounts) {
    for (const integ of integrationsForTool(toolName)) {
      // Only recommend coming-soon ones — available are already in section 1
      if (integ.status !== 'coming-soon') continue;
      const existing = integrationHits.get(integ.slug);
      if (!existing || existing.hits < hits) {
        integrationHits.set(integ.slug, { integration: integ, hits, topTool: toolName });
      } else {
        existing.hits += hits;
      }
    }
  }

  const recommendations: Recommendation[] = Array.from(integrationHits.values())
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3)
    .map(({ integration, hits, topTool }) => ({
      integration,
      hits,
      reason: `Your skills tried to call ${topTool} ${hits}× in the last 30 days — wire ${integration.name} to unlock it.`,
    }));

  // ── 2. Pull existing waitlist memberships so the buttons reflect state ──
  const { data: waitlistRows } = await supabase
    .from('integration_waitlist')
    .select('integration_slug')
    .eq('user_id', profile.id);
  const onWaitlistSet = new Set((waitlistRows || []).map((r) => r.integration_slug));

  // ── 3. Bucket the catalog ──────────────────────────────────────────────
  const recommendedSlugs = new Set(recommendations.map((r) => r.integration.slug));
  const available = INTEGRATIONS.filter((i) => i.status === 'available' || i.status === 'beta');
  const comingSoon = INTEGRATIONS.filter((i) => i.status === 'coming-soon' && !recommendedSlugs.has(i.slug));
  const comingSoonByCategory = integrationsByCategory(comingSoon);

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Top nav */}
        <header className="flex items-baseline justify-between mb-10 flex-wrap gap-4">
          <div>
            <div className="brand-mark text-xs mb-3"><span className="brand-mark-flame">⚡</span> Implexa</div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Integrations</h1>
            <p className="text-ink-300 text-sm mt-1 max-w-2xl">
              Connect Implexa to your stack. Every integration unlocks more skills end-to-end and feeds the attribution dashboard with real outcomes.
            </p>
          </div>
          <nav className="text-sm text-ink-300 flex gap-4">
            <Link href="/skills" className="hover:text-ink-50 hover:underline">Skills</Link>
            <Link href="/roi"    className="hover:text-ink-50 hover:underline">ROI</Link>
            <Link href="/settings" className="hover:text-ink-50 hover:underline">Settings</Link>
          </nav>
        </header>

        {/* ── Section 1 — Available now ─────────────────────────────────── */}
        <section className="mb-12">
          <SectionHeader
            badge="🟢"
            title="Available now"
            subtitle="Plug in an API key — skills start hitting real data immediately."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {available.map((integ) => (
              <IntegrationCard
                key={integ.slug}
                integration={integ}
                alreadyOnWaitlist={onWaitlistSet.has(integ.slug)}
              />
            ))}
          </div>
        </section>

        {/* ── Section 2 — Recommended for you ─────────────────────────── */}
        {recommendations.length > 0 ? (
          <section className="mb-12">
            <SectionHeader
              badge="💡"
              title="Recommended for you"
              subtitle="Your recent skill runs hit these integrations. We&apos;re working on them next — get notified the moment they ship."
              accent="success"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recommendations.map(({ integration, reason }) => (
                <IntegrationCard
                  key={integration.slug}
                  integration={integration}
                  alreadyOnWaitlist={onWaitlistSet.has(integration.slug)}
                  recommendationReason={reason}
                  isRecommended
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="mb-12">
            <SectionHeader
              badge="💡"
              title="Recommended for you"
              subtitle="Once you start running skills, we&apos;ll surface the integrations they need next here."
              accent="success"
            />
            <div className="card !p-6 text-center text-sm text-ink-400">
              No usage data yet — run a Playbook from <Link href="/skills" className="text-brand-500 hover:underline">your skills</Link> and check back.
            </div>
          </section>
        )}

        {/* ── Section 3 — Coming soon (by category) ───────────────────── */}
        <section>
          <SectionHeader
            badge="🔭"
            title="Coming soon"
            subtitle="The roadmap — vote with the bell. We prioritize what users actually ask for."
          />

          {comingSoonByCategory.map(({ category, meta, items }) => (
            <div key={category} className="mb-10">
              <h3 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
                <span aria-hidden="true">{meta.icon}</span>
                {meta.label}
                <span className="text-ink-400 font-normal">({items.length})</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((integ) => (
                  <IntegrationCard
                    key={integ.slug}
                    integration={integ}
                    alreadyOnWaitlist={onWaitlistSet.has(integ.slug)}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Footer note */}
        <footer className="mt-12 text-center text-xs text-ink-400">
          <p>
            Don&apos;t see what you need?{' '}
            <a href="mailto:support@implexa.ai?subject=Integration%20request" className="text-brand-500 hover:underline font-medium">
              Tell us what to build next →
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}

function SectionHeader({
  badge,
  title,
  subtitle,
  accent,
}: {
  badge: string;
  title: string;
  subtitle: string;
  accent?: 'success';
}) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <span className="text-2xl leading-none mt-0.5" aria-hidden="true">{badge}</span>
      <div>
        <h2 className={`text-lg font-semibold ${accent === 'success' ? 'text-success-700 dark:text-success-400' : 'text-ink-50'}`}>
          {title}
        </h2>
        <p className="text-sm text-ink-300 mt-1 max-w-2xl">{subtitle}</p>
      </div>
    </div>
  );
}

export const metadata = {
  title:       'Integrations — Implexa',
  description: 'Connect Implexa to your stack. Every integration unlocks more end-to-end skills.',
};
