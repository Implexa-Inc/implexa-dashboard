import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import BrollProposalBuilder from '../../../_components/broll-proposal-builder';

export const dynamic = 'force-dynamic';

function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function GenerateBrollPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // RLS is the first ownership boundary. The backend repeats the owner-scoped
  // source-run check when it persists the proposal, so a forged browser request
  // cannot bind paid work to another account's run.
  const { data: run } = await supabase.from('skill_runs')
    .select('id,skill_slug,output_markdown,run_state')
    .eq('id', params.id).maybeSingle();
  if (!run) notFound();

  if (!run.output_markdown) {
    return (
      <main className="min-h-screen px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <Link href={`/runs/${encodeURIComponent(params.id)}`} className="text-xs text-ink-500 hover:text-ink-200">← Back to run</Link>
          <div className="mt-4 rounded-lg border border-ink-800 bg-ink-950/50 p-5">
            <h1 className="text-lg font-medium text-ink-100">This run has no result to build from yet.</h1>
            <p className="mt-2 text-sm text-ink-400">Wait for it to deliver, then choose Generate B-roll from the run.</p>
          </div>
        </div>
      </main>
    );
  }

  const agentName = humanize(run.skill_slug);
  return (
    <main className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <Link href={`/runs/${encodeURIComponent(params.id)}`} className="text-xs text-ink-500 hover:text-ink-200">← Back to run</Link>
        <div className="mt-4">
          <BrollProposalBuilder runId={run.id} agentSubject={run.skill_slug} agentName={agentName} />
        </div>
      </div>
    </main>
  );
}
