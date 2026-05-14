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

/**
 * Popular MCPs we've seen users capture from. Informational only — Implexa
 * captures these automatically when installed in the user's Claude, no
 * connection needed on our side.
 */
const POPULAR_BYO_MCPS = [
  { name: 'GitHub',           icon: '🐙', note: 'Issues, PRs, code reviews, releases' },
  { name: 'Linear',           icon: '📐', note: 'Sprints, tickets, project planning' },
  { name: 'Notion',           icon: '📝', note: 'Docs, databases, knowledge base ops' },
  { name: 'Slack',            icon: '💬', note: 'Send / search messages, channel ops' },
  { name: 'Gmail',            icon: '✉️', note: 'Read inbox, draft / send replies' },
  { name: 'Google Calendar',  icon: '📅', note: 'Read meetings, create events' },
  { name: 'Google Drive',     icon: '📂', note: 'Search docs, share files' },
  { name: 'Microsoft Teams',  icon: '💜', note: 'Messages + meetings' },
  { name: 'Outlook',          icon: '📨', note: 'Mail + calendar via Graph' },
  { name: 'Salesforce',       icon: '☁️', note: 'CRM queries, contact + deal ops' },
  { name: 'HubSpot',          icon: '🟧', note: 'CRM + marketing automation' },
  { name: 'Jira',             icon: '🌀', note: 'Issues, sprints, workflows' },
  { name: 'Sentry',           icon: '🛡️', note: 'Errors, performance issues' },
  { name: 'Stripe',           icon: '💳', note: 'Customers, subscriptions, payments' },
  { name: 'Vercel',           icon: '▲', note: 'Deployments, env vars, projects' },
  { name: 'Cloudflare',       icon: '☁️', note: 'DNS, Workers, Pages' },
  { name: 'Apollo',           icon: '🚀', note: 'B2B contact + company data' },
  { name: 'PostgreSQL',       icon: '🐘', note: 'Database queries via mcp-server-postgres' },
  { name: 'Playwright',       icon: '🎭', note: 'Browser automation, scraping' },
  { name: 'Computer use',     icon: '🖥️', note: 'Native app + browser interaction' },
  { name: 'Browser MCP',      icon: '🌐', note: 'Claude-in-Chrome, fetch, DOM extraction' },
  { name: '...and your own',  icon: '✨', note: 'Custom MCPs you built — captured the same way' },
];

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
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Integrations</h1>
          <p className="text-ink-300 text-sm mt-1 max-w-2xl leading-relaxed">
            Implexa captures workflows from <strong>any MCP server you have installed</strong> in Claude — no setup required.
            Below are the native data providers we ship for users who don&apos;t have their own.
          </p>
        </header>

        {/* ── Hero callout — the BYO MCP message ────────────────────────── */}
        <section className="mb-12">
          <div className="card !bg-gradient-to-r !from-success-400/10 !to-brand-500/10 !border-success-400/30 !p-6">
            <div className="flex items-start gap-4">
              <div className="text-3xl shrink-0">🌐</div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-ink-50 mb-2">
                  Bring your own MCP — Implexa captures everything
                </h2>
                <p className="text-sm text-ink-200 leading-relaxed mb-3">
                  Already have GitHub, Linear, Notion, Slack, Salesforce, Gmail, or any other MCP installed in Claude?
                  During a recording, Implexa&apos;s <code className="text-xs bg-ink-800 px-1.5 py-0.5 rounded text-ink-100">PostToolUse</code> hook captures every tool call
                  regardless of which MCP provides it. Your captured skill references the actual tool names you used —
                  so anyone with the same MCP installed can run it.
                </p>
                <p className="text-xs text-ink-300 leading-relaxed">
                  <strong>You don&apos;t need to connect anything to Implexa to capture workflows.</strong>
                  Install MCPs in Claude as you normally would. Implexa is the meta-layer that records + replays the choreography.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 1 — Native data providers ─────────────────────────── */}
        <section className="mb-12">
          <SectionHeader
            badge="🟢"
            title="Native data providers"
            subtitle="The few categories where Implexa ships its own MCP. Useful if you don't have a prospect data MCP of your own."
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
        {recommendations.length > 0 && (
          <section className="mb-12">
            <SectionHeader
              badge="💡"
              title="Recommended for you"
              subtitle="Your recent skill runs hit these integrations. We&apos;re considering them for native support — get notified when shipped."
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
        )}

        {/* ── Section 3 — Popular MCPs users capture ──────────────────── */}
        <section className="mb-12">
          <SectionHeader
            badge="📡"
            title="Popular MCPs we've seen captured"
            subtitle="Workflows we know Implexa captures cleanly. Install the MCP in Claude — recording works automatically."
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {POPULAR_BYO_MCPS.map((m) => (
              <div key={m.name} className="card !p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xl shrink-0" aria-hidden="true">{m.icon}</span>
                  <div className="text-sm font-medium text-ink-50 truncate">{m.name}</div>
                </div>
                <p className="text-[11px] text-ink-300 leading-snug">{m.note}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-400 mt-4 leading-relaxed">
            Have an MCP not listed here? It still works — Implexa captures any tool call. Tell us at{' '}
            <a href="mailto:support@implexa.ai" className="text-brand-500 hover:underline">support@implexa.ai</a>{' '}and we&apos;ll add it to the list.
          </p>
        </section>

        {/* ── Section 4 — Future attribution sinks ─────────────────────── */}
        <section>
          <SectionHeader
            badge="📊"
            title="Attribution sinks (coming with Pro)"
            subtitle="Different from execution integrations — these passively listen for outcomes (deals closed, candidates placed, tickets resolved) and attribute them back to the skill that drove the win."
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
