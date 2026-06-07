/**
 * /runs/[id] — detail view for ONE run.
 *
 * The review/approve links Implexa emits (record_scheduled_run ->
 * app.implexa.ai/runs/<id>) point here. Without this page those links 404 — the
 * /runs index only renders a list. RLS-scoped: a run that isn't the caller's
 * resolves to null and renders a friendly not-found rather than leaking.
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
  review_status:       'none' | 'pending' | 'approved' | 'dismissed' | null;
  ran_at:              string;
};

function statusBadge(status: SkillRun['status']) {
  const base = 'inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded';
  if (status === 'completed') return <span className={`${base} bg-emerald-500/15 text-emerald-700 dark:text-emerald-400`}>ok</span>;
  if (status === 'partial')   return <span className={`${base} bg-amber-500/15 text-amber-700 dark:text-amber-400`}>partial</span>;
  return <span className={`${base} bg-rose-500/15 text-rose-700 dark:text-rose-400`}>failed</span>;
}

function reviewBadge(rs: SkillRun['review_status']) {
  const base = 'inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded';
  if (rs === 'pending')   return <span className={`${base} bg-brand-500/15 text-brand-600 dark:text-brand-400`}>needs review</span>;
  if (rs === 'approved')  return <span className={`${base} bg-emerald-500/15 text-emerald-700 dark:text-emerald-400`}>approved</span>;
  if (rs === 'dismissed') return <span className={`${base} bg-ink-700 text-ink-300`}>dismissed</span>;
  return null;
}

export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const [{ data: run }, catalog] = await Promise.all([
    supabase
      .from('skill_runs')
      .select('id, scheduled_skill_id, orchestration_id, skill_slug, source, output_markdown, status, duration_ms, delivery, review_status, ran_at')
      .eq('id', params.id)
      .maybeSingle(),
    listWorkflows(),
  ]);

  const r = run as SkillRun | null;

  if (!r) {
    return (
      <main className="min-h-screen px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <Link href="/runs" className="text-xs text-brand-500 hover:underline">← All runs</Link>
          <div className="card mt-4 text-sm text-ink-300">
            <p className="font-medium text-ink-100 mb-1">Run not found.</p>
            <p>This run does not exist, or it belongs to another account. See your{' '}
              <Link href="/runs" className="text-brand-500 hover:underline">recent runs</Link>.</p>
          </div>
        </div>
      </main>
    );
  }

  const workflowSource = catalog.find((c) => c.slug === r.skill_slug)?.source || null;

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <Link href="/runs" className="text-xs text-brand-500 hover:underline">← All runs</Link>

        <header className="mt-3 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-mono text-xl text-ink-50">{r.skill_slug}</h1>
            {statusBadge(r.status)}
            {reviewBadge(r.review_status)}
          </div>
          <p className="text-ink-400 text-xs mt-2">
            {r.source} · {new Date(r.ran_at).toLocaleString()}
            {r.duration_ms != null && ` · ${r.duration_ms}ms`}
            {workflowSource && (
              <>
                {' · '}
                <Link
                  href={`/workflows/${encodeURIComponent(r.skill_slug)}?source=${encodeURIComponent(workflowSource)}`}
                  className="text-brand-500 hover:underline"
                >
                  view workflow
                </Link>
              </>
            )}
          </p>
        </header>

        {r.review_status === 'pending' && (
          <Link
            href="/inbox"
            className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-brand-500/40 bg-brand-500/10 p-4 hover:bg-brand-500/15 transition-colors"
          >
            <div>
              <div className="text-sm font-semibold text-ink-50">This deliverable is waiting for your review</div>
              <div className="text-xs text-ink-300 mt-0.5">Approve what you shipped, or dismiss it.</div>
            </div>
            <span className="text-sm text-brand-500 font-medium whitespace-nowrap">Review in inbox →</span>
          </Link>
        )}

        <h2 className="text-xs font-medium text-ink-300 uppercase tracking-wider mb-2">Output</h2>
        {r.output_markdown ? (
          <pre className="whitespace-pre-wrap text-sm text-ink-200 bg-ink-900 border border-ink-800 rounded-lg p-4 overflow-x-auto">
            {r.output_markdown}
          </pre>
        ) : (
          <p className="text-sm text-ink-400 italic">No output recorded for this run.</p>
        )}
      </div>
    </main>
  );
}
