/**
 * /admin — internal admin dashboard, gated to ADMIN_EMAILS.
 *
 * Renders a server-fetched snapshot of signups, setup-funnel state, skills
 * activity, Founding Creator status, and revenue. Tables under each card
 * show the recent rows for hands-on monitoring during launch week.
 *
 * Auth strategy: defense-in-depth.
 *   1. Dashboard side: server-component check against NEXT_PUBLIC_ADMIN_EMAILS
 *      (the public env var so we can branch UI + sidebar without leaking
 *      credentials). 404 if not allowed.
 *   2. Backend side: /api/v2/admin/metrics independently checks ADMIN_EMAILS
 *      (server-only env). The two must agree, but the backend is authoritative.
 *
 * The page auto-refreshes every 60 seconds via meta refresh — good enough
 * for launch-week monitoring without setting up a websocket.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';

export const dynamic = 'force-dynamic';

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

type Metrics = {
  signups: {
    allTime: number;
    last7d: number;
    last24h: number;
    topDomains: Array<{ domain: string; count: number }>;
  };
  setup: {
    active: number;
    idle: number;
    stale: number;
    dormant: number;
    never: number;
    withHooks: number;
    total: number;
    timeToFirstMcpMs: { median: number | null; p90: number | null; sampleSize: number };
  };
  skills: {
    capturedAllTime: number;
    captured7d: number;
    captured24h: number;
    scopeCounts: { private: number; org: number; universal: number; system: number };
    totalInvocations: number;
    totalAttributedValueUsd: number;
    topCreators: Array<{ userId: string; displayName: string | null; count: number }>;
    topSkills: Array<{
      id: string; slug: string; name: string; scope: string;
      usageCount: number; attributedOutcomes: number; attributedValueUsd: number;
      creatorName: string | null;
    }>;
  };
  foundingCreators: {
    unlockedCount: number;
    recent: Array<{ id: string; email: string; displayName: string | null; unlockedAt: string }>;
    closeToUnlockCount: number;
    closeToUnlockSample: Array<{ id: string; email: string; displayName: string | null }>;
  };
  revenue: {
    planCounts: { free: number; pro: number; enterprise: number; other: number };
    proMonthly: number;
    proAnnual: number;
    mrrUsd: number;
    arrUsd: number;
    pastDue: number;
  };
  recentSignups: Array<{
    id: string; email: string; displayName: string | null; createdAt: string;
    plan: string; billingCycle: string | null;
    lastMcpCallAt: string | null; lastHookEventAt: string | null;
    isFoundingCreator: boolean;
  }>;
  stuckOnInstall: Array<{ id: string; email: string; displayName: string | null; createdAt: string }>;
  recentUpgrades: Array<{
    id: string; name: string; plan: string; billingCycle: string | null;
    planStatus: string; subscriptionPeriodEnd: string | null; updatedAt: string;
    representativeEmail: string | null;
  }>;
  generatedAt: string;
};

export default async function AdminPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const email = (session?.user?.email || '').toLowerCase();
  if (!email || !ADMIN_EMAILS.includes(email)) {
    notFound();
  }

  let metrics: Metrics | null = null;
  let error: string | null = null;
  try {
    metrics = await callBackend('/api/v2/admin/metrics', { jwt: session!.access_token });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to fetch metrics';
  }

  return (
    <main className="min-h-screen px-4 py-10">
      {/* Auto-refresh every 60 seconds — good enough for launch-week monitoring */}
      <meta httpEquiv="refresh" content="60" />

      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Admin</h1>
            <p className="text-xs text-ink-400 mt-1">
              Internal-only. Auto-refreshes every 60s.
              {metrics?.generatedAt && (
                <> · Snapshot: <span className="text-ink-300">{new Date(metrics.generatedAt).toLocaleTimeString()}</span></>
              )}
            </p>
          </div>
        </header>

        {error && (
          <div className="card !border-red-500/40 !bg-red-500/5 mb-8">
            <p className="text-sm text-red-700 dark:text-red-400">Failed to load metrics: {error}</p>
          </div>
        )}

        {metrics && (
          <>
            {/* Signups */}
            <Section title="Signups">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Stat label="All-time" value={metrics.signups.allTime} />
                <Stat label="Last 7 days" value={metrics.signups.last7d} accent={metrics.signups.last7d > 0 ? 'success' : undefined} />
                <Stat label="Last 24 hours" value={metrics.signups.last24h} accent={metrics.signups.last24h > 0 ? 'brand' : undefined} />
              </div>
              <SubHeading>Top email domains</SubHeading>
              <Table
                columns={['Domain', 'Users']}
                rows={metrics.signups.topDomains.map((d) => [d.domain, d.count.toString()])}
                emptyText="No domain data yet."
              />
            </Section>

            {/* Setup funnel */}
            <Section title="Setup funnel">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <Stat label="🟢 Active (<24h)" value={metrics.setup.active} accent="success" />
                <Stat label="🟢 Idle (<7d)"    value={metrics.setup.idle} />
                <Stat label="🟠 Stale (<30d)"  value={metrics.setup.stale} />
                <Stat label="⚫ Dormant"       value={metrics.setup.dormant} />
                <Stat label="🔴 Never"          value={metrics.setup.never} accent={metrics.setup.never > 0 ? 'red' : undefined} />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Stat label="With hooks installed" value={`${metrics.setup.withHooks} / ${metrics.setup.total}`} />
                <Stat
                  label="Time-to-first-MCP (median)"
                  value={metrics.setup.timeToFirstMcpMs.median != null
                    ? formatDuration(metrics.setup.timeToFirstMcpMs.median)
                    : '—'}
                />
              </div>

              <SubHeading>Stuck on install (signed up &gt;1h ago, no MCP call yet)</SubHeading>
              <Table
                columns={['Email', 'Display name', 'Signed up']}
                rows={metrics.stuckOnInstall.map((u) => [
                  u.email,
                  u.displayName || '—',
                  timeAgo(u.createdAt),
                ])}
                emptyText="🎉 No one stuck. All recent signups completed install."
              />
            </Section>

            {/* Skills activity */}
            <Section title="Skills activity">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <Stat label="Captured (all-time)" value={metrics.skills.capturedAllTime} />
                <Stat label="Captured (7d)" value={metrics.skills.captured7d} />
                <Stat label="Captured (24h)" value={metrics.skills.captured24h} accent={metrics.skills.captured24h > 0 ? 'brand' : undefined} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Stat label="🔒 Private" value={metrics.skills.scopeCounts.private} />
                <Stat label="👥 Org-shared" value={metrics.skills.scopeCounts.org} />
                <Stat label="🌍 Public" value={metrics.skills.scopeCounts.universal} accent="success" />
                <Stat label="⭐ Base Playbooks" value={metrics.skills.scopeCounts.system} />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Stat label="Total invocations" value={metrics.skills.totalInvocations} />
                <Stat label="Attributed value (USD)" value={`$${metrics.skills.totalAttributedValueUsd.toLocaleString()}`} />
              </div>

              <SubHeading>Top creators</SubHeading>
              <Table
                columns={['User', 'Skills authored']}
                rows={metrics.skills.topCreators.map((c) => [
                  c.displayName || c.userId.slice(0, 8) + '…',
                  c.count.toString(),
                ])}
                emptyText="No skills captured yet."
              />

              <SubHeading>Top skills by usage</SubHeading>
              <Table
                columns={['Skill', 'Scope', 'Used', 'Outcomes', 'Value', 'Creator']}
                rows={metrics.skills.topSkills.map((s) => [
                  s.name,
                  s.scope,
                  `${s.usageCount}×`,
                  s.attributedOutcomes.toString(),
                  s.attributedValueUsd > 0 ? `$${Math.round(s.attributedValueUsd / 1000)}K` : '—',
                  s.creatorName || '—',
                ])}
                emptyText="No skills with usage yet."
              />
            </Section>

            {/* Founding Creators */}
            <Section title="Founding Creators">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <Stat label="🏆 Unlocked" value={metrics.foundingCreators.unlockedCount} accent="success" />
                <Stat label="One step away" value={metrics.foundingCreators.closeToUnlockCount} />
                <Stat label="Recent unlocks" value={metrics.foundingCreators.recent.length} />
              </div>

              <SubHeading>Recently unlocked</SubHeading>
              <Table
                columns={['Email', 'Name', 'Unlocked']}
                rows={metrics.foundingCreators.recent.map((u) => [
                  u.email,
                  u.displayName || '—',
                  timeAgo(u.unlockedAt),
                ])}
                emptyText="No Founding Creators yet."
              />

              <SubHeading>One step away (captured, not shared)</SubHeading>
              <Table
                columns={['Email', 'Name']}
                rows={metrics.foundingCreators.closeToUnlockSample.map((u) => [
                  u.email,
                  u.displayName || '—',
                ])}
                emptyText="No candidates yet."
              />
            </Section>

            {/* Revenue */}
            <Section title="Revenue">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Stat label="Free plan" value={metrics.revenue.planCounts.free} />
                <Stat label="Pro plan" value={metrics.revenue.planCounts.pro} accent="brand" />
                <Stat label="Enterprise" value={metrics.revenue.planCounts.enterprise} />
                <Stat label="Past due" value={metrics.revenue.pastDue} accent={metrics.revenue.pastDue > 0 ? 'red' : undefined} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Stat label="Pro monthly" value={metrics.revenue.proMonthly} />
                <Stat label="Pro annual" value={metrics.revenue.proAnnual} />
                <Stat label="MRR" value={`$${metrics.revenue.mrrUsd.toLocaleString()}`} accent="success" />
                <Stat label="ARR (est)" value={`$${metrics.revenue.arrUsd.toLocaleString()}`} accent="success" />
              </div>

              <SubHeading>Recent Pro orgs</SubHeading>
              <Table
                columns={['Org', 'Plan', 'Cycle', 'Status', 'Renews', 'Email']}
                rows={metrics.recentUpgrades.map((o) => [
                  o.name || '—',
                  o.plan,
                  o.billingCycle || '—',
                  o.planStatus,
                  o.subscriptionPeriodEnd ? new Date(o.subscriptionPeriodEnd).toLocaleDateString() : '—',
                  o.representativeEmail || '—',
                ])}
                emptyText="No Pro orgs yet."
              />
            </Section>

            {/* Recent signups — full table */}
            <Section title="Recent signups (last 20)">
              <Table
                columns={['Email', 'Plan', 'Last seen', 'Hooks?', 'FC', 'Signed up']}
                rows={metrics.recentSignups.map((u) => [
                  u.email,
                  u.plan + (u.billingCycle ? ` (${u.billingCycle})` : ''),
                  u.lastMcpCallAt ? timeAgo(u.lastMcpCallAt) : '—',
                  u.lastHookEventAt ? '✓' : '—',
                  u.isFoundingCreator ? '🏆' : '—',
                  timeAgo(u.createdAt),
                ])}
                emptyText="No signups yet."
              />
            </Section>
          </>
        )}

        <footer className="mt-12 text-xs text-ink-400 text-center">
          <Link href="/skills" className="hover:underline">← back to skills</Link>
        </footer>
      </div>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-medium text-ink-50 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs uppercase tracking-wider text-ink-400 font-medium mt-4 mb-2">{children}</h3>
  );
}

function Stat({
  label, value, accent,
}: {
  label: string; value: string | number; accent?: 'success' | 'brand' | 'red';
}) {
  const accentClass =
    accent === 'success' ? 'text-success-400 border-success-400/40' :
    accent === 'brand'   ? 'text-brand-500 border-brand-500/40'     :
    accent === 'red'     ? 'text-red-500 border-red-500/40'         :
    'text-ink-50 border-ink-700';
  return (
    <div className={`card !p-3 border ${accentClass}`}>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-ink-400 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

function Table({
  columns, rows, emptyText,
}: {
  columns: string[]; rows: string[][]; emptyText: string;
}) {
  if (rows.length === 0) {
    return <div className="text-xs text-ink-400 italic py-2">{emptyText}</div>;
  }
  return (
    <div className="card !p-0 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-ink-700">
            {columns.map((c) => (
              <th key={c} className="text-left text-[10px] uppercase tracking-wider text-ink-400 font-medium px-3 py-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-ink-800 last:border-b-0 hover:bg-ink-800/30">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-ink-200">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)         return 'just now';
  if (ms < 3_600_000)      return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)     return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms < 60_000)     return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000)  return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  return `${(ms / 86_400_000).toFixed(1)} d`;
}

export const metadata = {
  title: 'Admin — Implexa',
};
