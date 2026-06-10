/**
 * /runs/[id] — clean permalink for ONE run's deliverable.
 *
 * Where Implexa's "ready to review" links land (record_scheduled_run →
 * implexa://runs/<id>, web fallback https://app.implexa.ai/runs/<id>). Unlike
 * the Results overlay (which only knows the recent feed), this RLS-fetches ANY
 * run by id, so a deep link to an older run still resolves. Renders the
 * deliverable as MARKDOWN (the overlay's look), not a raw <pre> dump — the old
 * page showed the slug + raw source, which is the "ugly page" the founder hit.
 *
 * RLS-scoped: a run that isn't the caller's resolves to null and renders a
 * friendly not-found rather than leaking.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createClient } from '@/lib/supabase/server';
import { listWorkflows } from '@/lib/workflow-catalog';
import { deriveRunState, type RunRow } from '@/lib/run-state';
import { RunStateBadge } from '../../_components/run-state-badge';
import BackLink from '../../_components/back-link';

export const dynamic = 'force-dynamic';

function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function rel(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
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
      .select('id, scheduled_skill_id, orchestration_id, skill_slug, source, output_markdown, status, duration_ms, delivery, review_status, ran_at, run_state, started_at, last_progress_at, completed_at, expected_duration_ms, stalled_at')
      .eq('id', params.id)
      .maybeSingle(),
    listWorkflows(),
  ]);

  const r = run as RunRow | null;

  if (!r) {
    return (
      <main className="min-h-screen px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <BackLink fallback="/inbox" label="Results" className="text-xs text-ink-500 hover:text-ink-200 inline-flex items-center gap-1.5" />
          <div className="card mt-4 text-sm text-ink-300">
            <p className="font-medium text-ink-100 mb-1">Run not found.</p>
            <p>This run does not exist, or it belongs to another account. See your{' '}
              <Link href="/inbox" className="text-brand-500 hover:underline">results</Link>.</p>
          </div>
        </div>
      </main>
    );
  }

  const wf = catalog.find((c) => c.slug === r.skill_slug);
  const name = wf?.name || humanize(r.skill_slug);
  const pending = r.review_status === 'pending';

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <BackLink fallback="/inbox" label="Results" className="text-xs text-ink-500 hover:text-ink-200 inline-flex items-center gap-1.5" />

        <header className="mt-4 mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50">{name}</h1>
          <div className="flex items-center gap-2.5 mt-2 flex-wrap">
            <RunStateBadge info={deriveRunState(r)} size="xs" />
            <span className="text-xs text-ink-500">{rel(r.ran_at)}</span>
            <span className="text-xs text-ink-600 font-mono">{r.skill_slug}</span>
            {wf && (
              <Link
                href={`/workflows/${encodeURIComponent(r.skill_slug)}?source=${encodeURIComponent(wf.source)}`}
                className="text-xs text-brand-500 hover:underline"
              >
                open agent
              </Link>
            )}
          </div>
        </header>

        {pending && (
          <Link
            href={`/inbox?run=${r.id}`}
            className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-brand-500/40 bg-brand-500/10 p-4 hover:bg-brand-500/15 transition-colors"
          >
            <div>
              <div className="text-sm font-semibold text-ink-50">This deliverable is waiting for your review</div>
              <div className="text-xs text-ink-300 mt-0.5">Approve what it produced, or dismiss it. Nothing posts without you.</div>
            </div>
            <span className="text-sm text-brand-500 font-medium whitespace-nowrap">Review →</span>
          </Link>
        )}

        {r.output_markdown ? (
          <div className="prose prose-sm max-w-none rounded-lg border border-ink-800 bg-ink-950/60 p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {r.output_markdown}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-ink-400 italic">No deliverable recorded for this run.</p>
        )}
      </div>
    </main>
  );
}
