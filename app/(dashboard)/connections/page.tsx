/**
 * /connections - the health panel for your agents' access.
 *
 * One glance at whether your agents can actually do their work: each account/app
 * with green/red reachability, which agents need what, and a one-tap sign-in for
 * anything broken. The pitch this surface makes real: "sign in once in your
 * Implexa browser, and your agents can use everything you can, with no keys to
 * wire." (CONNECTIONS_ONBOARDING.md, stream C.)
 *
 * Data comes from the owner-scoped backend read (lib/connections.ts). A parallel
 * backend stream is building that endpoint; until it lands, getConnectionStatus()
 * returns null and this page shows a calm not-set-up-yet state instead of an
 * error. Silence is never success: when an agent needs an account that is not
 * reachable, the loud ConnectionAttentionBanner sits at the top.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getMyAgents } from '@/lib/agents-home';
import { looksOverdue } from '@/lib/routine-status';
import {
  getConnectionStatus,
  REACH_PRESENTATION,
  RECONNECT_HREF,
  type ConnectionAccount,
  type AgentConnections,
} from '@/lib/connections';
import { ConnectionAttentionBanner } from '../_components/connection-attention-banner';

export const dynamic = 'force-dynamic';

function rel(iso: string | null): string {
  if (!iso) return 'not yet';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ReachBadge({ status }: { status: ConnectionAccount['status'] }) {
  const spec = REACH_PRESENTATION[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium text-xs px-2.5 py-1 ${spec.classes}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${spec.dot}`} aria-hidden="true" />
      {spec.label}
    </span>
  );
}

function ProfileTag({ profile }: { profile: ConnectionAccount['profile'] }) {
  if (!profile) return null;
  const isPrimary = profile === 'dedicated';
  return (
    <span
      title={isPrimary
        ? 'Signed in to your dedicated Implexa profile, the reliable home for your agents.'
        : 'Found in your main Chrome profile (backup). Move it into the dedicated Implexa profile for a reliable connection.'}
      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-ink-700 text-ink-400"
    >
      {isPrimary ? 'dedicated' : 'main · backup'}
    </span>
  );
}

function AccountRow({ conn }: { conn: ConnectionAccount }) {
  const broken = conn.status === 'unreachable';
  return (
    <li className="flex items-start justify-between gap-3 py-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ink-100 truncate">{conn.label}</span>
          <ProfileTag profile={conn.profile} />
        </div>
        <div className="text-xs text-ink-500 mt-1 flex items-center gap-2 flex-wrap">
          <code className="font-mono text-ink-400">{conn.domain}</code>
          <span aria-hidden>·</span>
          <span>{conn.status === 'unknown' ? 'not checked yet' : `verified ${rel(conn.verified_at)}`}</span>
        </div>
      </div>
      <div className="flex items-center gap-2.5 flex-none">
        <ReachBadge status={conn.status} />
        {broken && (
          <Link
            href={RECONNECT_HREF}
            title="Connect this account in the Implexa desktop app — you sign in once in the Implexa browser, no API keys."
            className="text-xs font-medium rounded-md px-2.5 py-1 bg-rose-500/20 text-rose-700 dark:text-rose-200 hover:bg-rose-500/30 transition-colors whitespace-nowrap"
          >
            Set up
          </Link>
        )}
      </div>
    </li>
  );
}

function AgentNeedsCard({ agent }: { agent: AgentConnections }) {
  const anyBroken = agent.needs.some((n) => n.status === 'unreachable');
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-3">
        <Link href={`/workflows/${agent.slug}`} className="text-sm font-medium text-ink-100 hover:text-ink-50 truncate">
          {agent.name}
        </Link>
        {anyBroken ? (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-rose-500/40 text-rose-700 dark:text-rose-300">
            needs a sign-in
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
            ready
          </span>
        )}
      </div>
      {agent.needs.length === 0 ? (
        <p className="text-xs text-ink-500">No accounts needed. This agent runs without signing in anywhere.</p>
      ) : (
        <ul className="space-y-2">
          {agent.needs.map((n, i) => {
            const spec = REACH_PRESENTATION[n.status];
            return (
              <li key={`${n.domain}-${i}`} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full flex-none ${spec.dot}`} aria-hidden="true" />
                  <span className="text-sm text-ink-200 truncate">{n.label}</span>
                </span>
                <span className={`text-[11px] font-medium flex-none ${
                  n.status === 'reachable' ? 'text-emerald-600 dark:text-emerald-400'
                  : n.status === 'unreachable' ? 'text-rose-600 dark:text-rose-400'
                  : 'text-ink-500'
                }`}>{spec.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SetupCallout() {
  // Shown when the status read is not live yet (endpoint not shipped, or the
  // desktop has not reported anything). Calm, not an error.
  return (
    <div className="card-glow">
      <h2 className="text-sm font-semibold text-ink-50">Set up your agents' workspace</h2>
      <p className="text-sm text-ink-300 mt-2 leading-relaxed">
        Your agents work the web as you, in a dedicated Implexa browser. Sign in once to the accounts they need (Gmail, LinkedIn, and the rest) and they can use everything you can, with no API keys to wire.
      </p>
      <p className="text-xs text-ink-500 mt-3">
        Once your Implexa browser reports in, every account and which agent needs it shows up here, green when reachable, red when it needs a sign-in.
      </p>
      <Link
        href={RECONNECT_HREF}
        className="inline-flex items-center mt-4 text-sm font-medium rounded-md px-3.5 py-2 bg-brand-500/15 text-brand-600 dark:text-brand-400 hover:bg-brand-500/25 transition-colors"
      >
        Connect your Implexa browser
      </Link>
    </div>
  );
}

export default async function ConnectionsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // ── Needs-you data: everything waiting on the user, assembled in parallel ──
  // (founder: "show all alerts/pending tasks here since Activate does the
  // connections bit too"). Connections health demotes to a section below.
  const [status, myAgents, { data: schedules }, { count: pendingCount }] = await Promise.all([
    getConnectionStatus(),
    getMyAgents(),
    supabase
      .from('scheduled_skills')
      .select('id, skill_slug, cron_expression, schedule_nl, status, last_run_at')
      .in('status', ['active', 'failed'])
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('skill_runs')
      .select('id', { count: 'exact', head: true })
      .eq('review_status', 'pending'),
  ]);

  type SchedRow = { id: string; skill_slug: string; cron_expression: string | null; schedule_nl: string | null; status: string; last_run_at: string | null };
  const sched = ((schedules as SchedRow[]) || []).filter((r) => r.cron_expression);
  const missed = sched.filter((r) =>
    r.status === 'failed' || (r.status === 'active' && looksOverdue(r.cron_expression || '', r.last_run_at)));
  const allMyAgents = myAgents ? [...myAgents.active, ...myAgents.needsActivation] : [];
  const nameBySlug = new Map(allMyAgents.map((a) => [a.slug, a.name]));
  const needGrant = allMyAgents.filter((a) => a.needsIntervention);
  const attentionCount = needGrant.length + missed.length + ((pendingCount ?? 0) > 0 ? 1 : 0) + (status?.warnings.length ? 1 : 0);

  const hasData = !!status && (status.connections.length > 0 || status.agents.length > 0);
  const reachable = status?.connections.filter((c) => c.status === 'reachable').length ?? 0;
  const broken = status?.connections.filter((c) => c.status === 'unreachable').length ?? 0;

  return (
    <main className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50">Needs you</h1>
          <p className="text-sm text-ink-400 mt-2 max-w-2xl">
            Everything waiting on you, in one place: permissions to grant, runs to review, schedules that missed, and accounts that need a sign-in.
          </p>
        </header>

        {/* ── Waiting on you ─────────────────────────────────────────────── */}
        {attentionCount === 0 ? (
          <div className="card mb-12 text-center py-8">
            <div className="text-xl mb-1" aria-hidden>✓</div>
            <p className="text-ink-100 font-medium text-sm">Nothing needs you right now.</p>
            <p className="text-xs text-ink-500 mt-1">Grants, reviews, missed schedules, and sign-ins will show up here.</p>
          </div>
        ) : (
          <section className="mb-12 space-y-3">
            {needGrant.map((a) => (
              <div key={a.slug} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-100 truncate">{a.name}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{a.interventionReason || 'A permission needs your OK before it can really run.'}</p>
                </div>
                <Link href={`/workflows/${a.slug}/activate`} className="btn-outline text-xs px-3 py-1.5 flex-none">Grant</Link>
              </div>
            ))}
            {(pendingCount ?? 0) > 0 && (
              <div className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-100">{pendingCount} result{pendingCount === 1 ? '' : 's'} held for your review</p>
                  <p className="text-xs text-ink-500 mt-0.5">Approve or dismiss; nothing posts without you.</p>
                </div>
                <Link href="/inbox" className="btn-outline text-xs px-3 py-1.5 flex-none">Review</Link>
              </div>
            )}
            {missed.map((m) => (
              <div key={m.id} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-100 truncate">{nameBySlug.get(m.skill_slug) || m.skill_slug}</p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {m.status === 'failed'
                      ? 'Its schedule is marked failed.'
                      : `Missed its schedule (${m.schedule_nl || m.cron_expression}). It runs when your machine is awake; it will catch up, or run it now.`}
                  </p>
                </div>
                <Link href={`/workflows/${m.skill_slug}`} className="btn-outline text-xs px-3 py-1.5 flex-none">Open agent</Link>
              </div>
            ))}
          </section>
        )}

        <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider mb-4">Connection health</h2>

        {/* loud first: anything an agent needs that is signed out - silence is never success */}
        {status && status.warnings.length > 0 && (
          <div className="mb-8">
            <ConnectionAttentionBanner warnings={status.warnings} />
          </div>
        )}

        {!hasData ? (
          <SetupCallout />
        ) : (
          <>
            {/* at-a-glance counts */}
            <div className="flex items-center gap-x-6 gap-y-2 flex-wrap text-sm mb-8">
              <span className="text-ink-300">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">{reachable}</span> reachable
              </span>
              {broken > 0 && (
                <span className="text-ink-300">
                  <span className="text-rose-600 dark:text-rose-400 font-semibold tabular-nums">{broken}</span> need a sign-in
                </span>
              )}
              <span className="text-ink-500">{status!.connections.length} account{status!.connections.length === 1 ? '' : 's'} total</span>
            </div>

            {/* accounts */}
            <section className="mb-12">
              <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider mb-3">Your accounts</h2>
              {status!.connections.length === 0 ? (
                <div className="card text-sm text-ink-400">
                  No accounts reported yet. Sign in to the accounts your agents need in your Implexa browser and they will show up here.
                </div>
              ) : (
                <div className="card !py-1">
                  <ul className="divide-y divide-ink-800">
                    {status!.connections.map((c) => (
                      <AccountRow key={c.id} conn={c} />
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* which agents need what */}
            {status!.agents.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider mb-3">Which agents need what</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {status!.agents.map((a) => (
                    <AgentNeedsCard key={a.slug} agent={a} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
