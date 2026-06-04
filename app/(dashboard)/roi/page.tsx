/**
 * Skill ROI rollup — which skills are working, by usage / outcomes / dollar value.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

function formatUsd(n: number) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export default async function RoiPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // All org skills with usage > 0
  const { data: skills } = await supabase
    .from('org_skills')
    .select('id, slug, name, status, scope, usage_count, unique_users, last_used_at, outcome_stats')
    .neq('organization_id', SYSTEM_ORG_ID)
    .order('usage_count', { ascending: false })
    .limit(100);

  const totalInvocations = (skills || []).reduce((a, s: any) => a + (s.usage_count || 0), 0);
  const totalOutcomes    = (skills || []).reduce((a, s: any) => a + (s.outcome_stats?.attributedOutcomes || 0), 0);
  const totalValueUsd    = (skills || []).reduce((a, s: any) => a + (s.outcome_stats?.attributedValueUsd || 0), 0);

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <nav className="text-sm text-ink-500 mb-6">
          <Link href="/skills" className="hover:underline">← Skills</Link>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Skill ROI</h1>
          <p className="text-ink-300 text-sm mt-2">
            Which of your saved skills are actually driving outcomes? Updated in real-time as CRM, calendar, and manual attribution events come in.
          </p>
        </header>

        {/* Top-line stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <div className="card">
            <div className="text-xs uppercase tracking-wide text-ink-400 mb-1">Total invocations</div>
            <div className="text-3xl font-semibold tabular-nums text-ink-50">{totalInvocations.toLocaleString()}</div>
          </div>
          <div className="card">
            <div className="text-xs uppercase tracking-wide text-ink-400 mb-1">Attributed outcomes</div>
            <div className="text-3xl font-semibold tabular-nums text-ink-50">{totalOutcomes.toLocaleString()}</div>
          </div>
          <div className="card-success">
            <div className="text-xs uppercase tracking-wide text-success-600 dark:text-success-400 mb-1">Attributed value</div>
            <div className="value-money text-3xl">{formatUsd(totalValueUsd)}</div>
          </div>
        </div>

        {/* Per-skill leaderboard */}
        <section>
          <h2 className="text-lg font-medium mb-3">Top skills by usage</h2>
          {!skills || skills.length === 0 ? (
            <div className="card text-sm text-ink-500">
              No skills with usage data yet. Save a workflow with <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded text-ink-100">/implexa:record-skill</code>, run it a few times, and ROI rollups appear here.
            </div>
          ) : (
            <div className="card !p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-ink-800/50 border-b border-ink-700">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-xs uppercase tracking-wide text-ink-500">Skill</th>
                    <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wide text-ink-500">Runs</th>
                    <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wide text-ink-500">Users</th>
                    <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wide text-ink-500">Outcomes</th>
                    <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wide text-ink-500">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((s: any, idx) => {
                    const stats = s.outcome_stats || {};
                    return (
                      <tr key={s.id} className={`border-t border-ink-700 ${idx === 0 ? 'bg-brand-50/30' : ''}`}>
                        <td className="px-4 py-3">
                          <Link href={`/skills/${s.slug}`} className="font-medium hover:underline">{s.name}</Link>
                          <div className="text-xs text-ink-500 mt-0.5">
                            <code className="font-mono">{s.slug}</code>
                            {s.status === 'draft' && <span className="ml-2 px-1.5 py-0.5 rounded bg-ink-800 text-ink-200">draft</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.usage_count || 0}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.unique_users || 0}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{stats.attributedOutcomes || 0}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${stats.attributedValueUsd ? 'text-success-600 dark:text-success-400 font-semibold' : 'text-ink-400'}`}>
                          {formatUsd(stats.attributedValueUsd || 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Educate on attribution */}
        <section className="mt-10">
          <h2 className="text-lg font-medium mb-3">How attribution works</h2>
          <div className="card">
            <p className="text-sm text-ink-200 mb-3">
              When you invoke a skill via <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded">/implexa:apply</code> or via natural language, Implexa logs the invocation with attribution keys (account ID, opportunity ID, candidate ID, thread ID).
            </p>
            <p className="text-sm text-ink-200 mb-3">
              When a downstream event fires from your CRM, ATS, calendar, or data warehouse — a deal closes, a meeting books, a candidate places, a feature ships — Implexa attempts last-touch attribution within a 30-day window. If the attribution keys overlap, the outcome attributes to the skill.
            </p>
            <p className="text-sm text-ink-200">
              You can also manually attribute outcomes — say <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded">"the Acme deal closed yesterday because of my account-research skill"</code> in Claude Code, and Implexa records it.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
