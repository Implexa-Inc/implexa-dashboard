/**
 * /runs — output log for scheduled + ad-hoc skill runs.
 *
 * Powered by skill_runs (migration 0023). Each row is one run's markdown
 * output plus delivery receipt. Rows expand inline via native <details>
 * so we don't need a client component for the toggle.
 *
 * Filters: by status (failed/partial surface first), by source (scheduled
 * vs adhoc vs orchestration). Not implemented yet — page hard-codes
 * "last 50, all sources, newest first" for v1. Filters land in v2 once
 * we have enough rows to need them.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { listWorkflows } from '@/lib/workflow-catalog';

export const dynamic = 'force-dynamic';

type SkillRun = {
  id:                  string;
  scheduled_skill_id:  string | null;
  orchestration_id:    string | null;
  skill_slug:          string;
  source:              'scheduled' | 'adhoc' | 'orchestration';
  output_markdown:     string | null;
  status:              'completed' | 'failed' | 'partial';
  duration_ms:         number | null;
  delivery:            Record<string, unknown>;
  ran_at:              string;
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const diff = (now - then) / 1000;
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function statusBadge(status: SkillRun['status']) {
  const base = 'inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded';
  if (status === 'completed') return <span className={`${base} bg-emerald-500/15 text-emerald-400`}>ok</span>;
  if (status === 'partial')   return <span className={`${base} bg-amber-500/15  text-amber-400`}>partial</span>;
  return <span className={`${base} bg-rose-500/15 text-rose-400`}>failed</span>;
}

function sourceBadge(source: SkillRun['source']) {
  const base = 'inline-block text-[10px] font-medium px-2 py-0.5 rounded text-ink-300 bg-ink-800';
  if (source === 'scheduled')     return <span className={base}>scheduled</span>;
  if (source === 'orchestration') return <span className={base}>chain</span>;
  return <span className={base}>ad-hoc</span>;
}

function deliverySummary(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (d?.dashboard) parts.push('dashboard');
  const slack = (d as { slack?: { via?: 'webhook' | 'plugin'; delivered?: boolean; channel?: string; error?: string } }).slack;
  if (slack) {
    // Show how Slack was delivered (plugin vs webhook) + status. Plugin
    // delivery includes the channel for clarity ("slack #standup ok").
    const label = slack.via === 'plugin'
      ? `slack-plugin${slack.channel ? ` ${slack.channel}` : ''}`
      : 'slack-webhook';
    parts.push(slack.delivered
      ? `${label} ok`
      : `${label} failed${slack.error ? ` (${slack.error.slice(0, 40)})` : ''}`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

export default async function RunsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // RLS-scoped to caller. Output included inline; native <details> avoids
  // a client component for the toggle. The workflow catalog (public read path)
  // lets each run link back to the workflow that produced it.
  const [{ data: runs }, catalog] = await Promise.all([
    supabase
      .from('skill_runs')
      .select('id, scheduled_skill_id, orchestration_id, skill_slug, source, output_markdown, status, duration_ms, delivery, ran_at')
      .order('ran_at', { ascending: false })
      .limit(50),
    listWorkflows(),
  ]);

  const items: SkillRun[] = (runs as SkillRun[]) || [];
  const workflowSourceBySlug = new Map<string, string>(catalog.map((c) => [c.slug, c.source]));

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Runs</h1>
          <p className="text-ink-300 text-sm mt-1">
            What your autopilot delivered. Every scheduled and orchestrated run, latest 50 across all sources.
          </p>
        </header>

        {items.length === 0 && (
          <section className="card text-sm text-ink-300">
            <p className="mb-3">No runs yet.</p>
            <p>
              Schedule a skill with{' '}
              <Link href="/scheduled" className="text-brand-500 hover:underline">/scheduled</Link>{' '}
              or invoke <code className="bg-ink-900 px-1.5 py-0.5 rounded text-brand-400">/implexa:morning</code>{' '}
              from Claude Code to start populating this log.
            </p>
          </section>
        )}

        {items.length > 0 && (
          <ul className="space-y-3">
            {items.map((r) => (
              <li key={r.id} className="card">
                <details>
                  <summary className="cursor-pointer list-none flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-sm text-ink-100">{r.skill_slug}</span>
                    {statusBadge(r.status)}
                    {sourceBadge(r.source)}
                    <span className="text-xs text-ink-400 ml-auto">
                      {formatRelative(r.ran_at)}
                      {r.duration_ms != null && ` · ${r.duration_ms}ms`}
                    </span>
                  </summary>
                  <div className="mt-3 text-xs text-ink-400">
                    delivery: {deliverySummary(r.delivery)}
                    {' · '}
                    {new Date(r.ran_at).toLocaleString()}
                    {workflowSourceBySlug.has(r.skill_slug) && (
                      <>
                        {' · '}
                        <Link
                          href={`/workflows/${encodeURIComponent(r.skill_slug)}?source=${encodeURIComponent(workflowSourceBySlug.get(r.skill_slug)!)}`}
                          className="text-brand-500 hover:underline"
                        >
                          view workflow
                        </Link>
                      </>
                    )}
                  </div>
                  {r.output_markdown ? (
                    <pre className="mt-4 whitespace-pre-wrap text-sm text-ink-200 bg-ink-900 border border-ink-800 rounded-lg p-4 overflow-x-auto">
                      {r.output_markdown}
                    </pre>
                  ) : (
                    <p className="mt-4 text-sm text-ink-400 italic">No output recorded.</p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
