/**
 * /connections — "Needs you": ONLY things waiting on the user, each with one
 * clear action. Permissions to grant, results to review, schedules that missed,
 * runs that stalled, accounts that need a sign-in. No inventory, no health
 * dashboard — the full account list moved to /settings/connections.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getMyAgents } from '@/lib/agents-home';
import { looksOverdue } from '@/lib/routine-status';
import { getConnectionStatus } from '@/lib/connections';

export const dynamic = 'force-dynamic';

export default async function NeedsYouPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const [status, myAgents, { data: schedules }, { count: pendingCount }, { data: stalledRows }] = await Promise.all([
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
    supabase
      .from('skill_runs')
      .select('id, skill_slug, ran_at, stalled_at')
      .eq('run_state', 'stalled')
      .gte('ran_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order('ran_at', { ascending: false })
      .limit(10),
  ]);

  type SchedRow = { id: string; skill_slug: string; cron_expression: string | null; schedule_nl: string | null; status: string; last_run_at: string | null };
  const sched = ((schedules as SchedRow[]) || []).filter((r) => r.cron_expression);
  const missed = sched.filter((r) =>
    r.status === 'failed' || (r.status === 'active' && looksOverdue(r.cron_expression || '', r.last_run_at)));
  const allMyAgents = myAgents ? [...myAgents.active, ...myAgents.needsActivation] : [];
  const nameBySlug = new Map(allMyAgents.map((a) => [a.slug, a.name]));
  const needGrant = allMyAgents.filter((a) => a.needsIntervention);
  type StalledRow = { id: string; skill_slug: string; ran_at: string; stalled_at: string | null };
  const stalled = ((stalledRows as StalledRow[]) || []);

  // Accounts a SPECIFIC agent needs that are signed out. Built from status.agents
  // (which names the agent), grouped by domain so one account = one card that
  // says WHO needs it and links to THAT agent's activation card (where the
  // per-account Sign in / Verify lives) — not the generic install page.
  const signInMap = new Map<string, { label: string; domain: string; agents: { slug: string; name: string }[] }>();
  for (const a of (status?.agents || [])) {
    for (const n of a.needs) {
      if (n.status !== 'unreachable') continue;
      const e = signInMap.get(n.domain);
      if (e) { if (!e.agents.some((x) => x.slug === a.slug)) e.agents.push({ slug: a.slug, name: a.name }); }
      else signInMap.set(n.domain, { label: n.label, domain: n.domain, agents: [{ slug: a.slug, name: a.name }] });
    }
  }
  const signIns = [...signInMap.values()];

  const attentionCount = needGrant.length + missed.length + stalled.length + signIns.length + ((pendingCount ?? 0) > 0 ? 1 : 0);

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50">Needs you</h1>
          <p className="text-sm text-ink-400 mt-2 max-w-2xl">
            Only the things waiting on you, each with one action. When this is empty, your agents are running on their own.
          </p>
        </header>

        {attentionCount === 0 ? (
          <div className="card text-center py-10">
            <div className="text-xl mb-1" aria-hidden>✓</div>
            <p className="text-ink-100 font-medium text-sm">Nothing needs you right now.</p>
            <p className="text-xs text-ink-500 mt-1">Grants, reviews, missed schedules, and sign-ins will show up here.</p>
          </div>
        ) : (
          <section className="space-y-3">
            {stalled.map((r) => (
              <div key={r.id} className="card flex items-center justify-between gap-3 border-amber-500/40">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-100 truncate">{nameBySlug.get(r.skill_slug) || r.skill_slug}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                    Stalled mid-run, likely waiting for a permission. Open Claude Code and approve the prompt to let it continue.
                  </p>
                </div>
                <Link href={`/workflows/${r.skill_slug}`} className="btn-outline text-xs px-3 py-1.5 flex-none">Open agent</Link>
              </div>
            ))}
            {needGrant.map((a) => (
              <div key={a.slug} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-100 truncate">{a.name}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{a.interventionReason || 'A permission needs your OK before it can really run.'}</p>
                </div>
                <Link href={`/workflows/${a.slug}/activate`} className="btn-outline text-xs px-3 py-1.5 flex-none">Grant</Link>
              </div>
            ))}
            {signIns.map((s) => {
              const who = s.agents.length === 1 ? s.agents[0].name : `${s.agents.length} agents`;
              const fixSlug = s.agents[0].slug; // sign-in is shared; fix it from the first agent's card
              return (
                <div key={s.domain} className="card flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-100 truncate">{s.label || s.domain} needs a sign-in</p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      <span className="text-ink-300">{who}</span> {s.agents.length === 1 ? 'needs' : 'need'} <code className="font-mono text-ink-400">{s.domain}</code>, but you&apos;re signed out. Sign in once on the agent&apos;s setup.
                    </p>
                  </div>
                  <Link href={`/workflows/${encodeURIComponent(fixSlug)}/activate`} className="btn-outline text-xs px-3 py-1.5 flex-none">Set up</Link>
                </div>
              );
            })}
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

        <p className="text-xs text-ink-500 mt-10">
          Looking for the full account list? <Link href="/settings/connections" className="text-brand-500 hover:underline">All your accounts →</Link>
        </p>
      </div>
    </main>
  );
}
