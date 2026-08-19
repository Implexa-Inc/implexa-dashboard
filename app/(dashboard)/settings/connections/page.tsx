/**
 * /settings/connections — "All your accounts" (the global inventory).
 *
 * Moved out of /connections (now the actionable "Needs you" hub) so the full
 * reachability list still has a home: every account your agents drive in the
 * Implexa browser, whether it's reachable, and which agents need what. Set-up
 * for an account happens on each agent's activation card; broken ones here link
 * to that path.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import {
  getConnectionStatus,
  REACH_PRESENTATION,
  RECONNECT_HREF,
  type ConnectionAccount,
  type AgentConnections,
} from '@/lib/connections';
import BackLink from '../../_components/back-link';
import { ConnectionAdvisoryNote } from '../../_components/connection-attention-banner';

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

/**
 * WHERE this connection lives. Three homes now, not two.
 *
 * A two-way isPrimary check labelled everything non-dedicated as "main · backup", so an
 * agent_browser connection — the STRONGEST evidence there is, proven in the browser the
 * agents actually drive — was displayed as the weakest. Exhaustive by value, so a fourth
 * home cannot silently inherit someone else's label.
 */
const PROFILE_TAG: Record<NonNullable<ConnectionAccount['profile']>, { label: string; title: string }> = {
  agent_browser: {
    label: 'agents’ browser',
    title: 'Proven through the browser extension your agents drive. This is the strongest evidence: it describes the place the work happens.',
  },
  dedicated: {
    label: 'workspace',
    title: 'Signed in to Implexa’s workspace browser over CDP. Useful, but this proof did not come through the browser extension your agents drive — even if it is the same application.',
  },
  main: {
    label: 'main · backup',
    title: 'Found in your main Chrome profile (backup). Move it into your agents’ browser for a reliable connection.',
  },
};

function ProfileTag({ profile }: { profile: ConnectionAccount['profile'] }) {
  if (!profile) return null;
  const tag = PROFILE_TAG[profile];
  if (!tag) return null;
  return (
    <span
      title={tag.title}
      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-ink-700 text-ink-400"
    >
      {tag.label}
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
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-rose-500/40 text-rose-700 dark:text-rose-300">needs a sign-in</span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-700 dark:text-emerald-300">ready</span>
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

export default async function AllConnectionsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const status = await getConnectionStatus();
  const hasData = !!status && (status.connections.length > 0 || status.agents.length > 0);
  const reachable = status?.connections.filter((c) => c.status === 'reachable').length ?? 0;
  const broken = status?.connections.filter((c) => c.status === 'unreachable').length ?? 0;

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <BackLink fallback="/settings" label="Settings" className="text-xs text-ink-500 hover:text-ink-200 inline-flex items-center gap-1.5 mb-4" />
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50">Your accounts</h1>
          <p className="text-sm text-ink-400 mt-2 max-w-2xl">
            Every account your agents drive in the Implexa browser, and which agents need what.
            You sign in once; agents use what you can, no API keys. Set-up happens on each agent&apos;s activation card.
          </p>
        </header>

        {/* Signed in, but not proven through the pinned agents'-browser extension — not the browser
         * the agents drive. Shown here because this page is the answer to "what can my
         * agents reach", and a green list that quietly rests on the weaker evidence is
         * the exact overstatement this surface exists to avoid. */}
        {status && status.advisories.length > 0 && (
          <ConnectionAdvisoryNote advisories={status.advisories} className="mb-6" />
        )}

        {!hasData ? (
          <div className="card-glow">
            <h2 className="text-sm font-semibold text-ink-50">No accounts yet</h2>
            <p className="text-sm text-ink-300 mt-2 leading-relaxed">
              When you activate an agent that needs an account (Gmail, GitHub, …), you sign in to exactly that
              account on its activation card. Everything you connect shows up here.
            </p>
            <Link
              href="/workflows"
              className="inline-flex items-center mt-4 text-sm font-medium rounded-md px-3.5 py-2 bg-brand-500/15 text-brand-600 dark:text-brand-400 hover:bg-brand-500/25 transition-colors"
            >
              See your agents
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-x-6 gap-y-2 flex-wrap text-sm mb-8">
              <span className="text-ink-300"><span className="text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">{reachable}</span> reachable</span>
              {broken > 0 && <span className="text-ink-300"><span className="text-rose-600 dark:text-rose-400 font-semibold tabular-nums">{broken}</span> need a sign-in</span>}
              <span className="text-ink-500">{status!.connections.length} account{status!.connections.length === 1 ? '' : 's'} total</span>
            </div>

            <section className="mb-12">
              <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider mb-3">Accounts</h2>
              {status!.connections.length === 0 ? (
                <div className="card text-sm text-ink-400">No accounts reported yet.</div>
              ) : (
                <div className="card !py-1">
                  <ul className="divide-y divide-ink-800">
                    {status!.connections.map((c) => <AccountRow key={c.id} conn={c} />)}
                  </ul>
                </div>
              )}
            </section>

            {status!.agents.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider mb-3">Which agents need what</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {status!.agents.map((a) => <AgentNeedsCard key={a.slug} agent={a} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
