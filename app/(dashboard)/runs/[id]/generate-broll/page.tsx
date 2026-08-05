import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { classifyGenerationEntryArtifacts } from '@/lib/generation-entry-eligibility';
import { getGenerationProposal } from '@/lib/generation-proposal-read';
import { timelineFromCompiledProposal, type TimelineMoment } from '@/lib/professional-v2-entry';
import BrollProposalBuilder from '../../../_components/broll-proposal-builder';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The moments of the plan the user chose to edit, or null.
 *
 * `?from=` is a URL parameter, so it is treated as an ID TO LOOK UP and nothing
 * more. The proposal is read through the same owner-scoped, JWT-authenticated
 * backend read as everywhere else, so a foreign or invented id simply resolves
 * to nothing. It must also be a v2 plan for THIS run — carrying a plan across
 * runs would bind a timeline to a source it was never written for.
 *
 * No identity travels with the moments: the editor arrives with a plan and no
 * preview, so a fresh compile is required before anything can be saved.
 */
async function seedFromEditedProposal(proposalId: unknown, runId: string): Promise<TimelineMoment[] | null> {
  if (typeof proposalId !== 'string' || !UUID.test(proposalId)) return null;
  const read = await getGenerationProposal(proposalId);
  if (read.state !== 'ready' || read.contract !== 'v2') return null;
  if (read.vm.sourceRunId !== runId) return null;
  return timelineFromCompiledProposal(read.vm.compiled);
}

function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function GenerateBrollPage({ params, searchParams }: {
  params: { id: string };
  searchParams?: { from?: string };
}) {
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

  let eligibility: ReturnType<typeof classifyGenerationEntryArtifacts> = 'unavailable';
  try {
    const { data, error } = await supabase.from('run_artifacts')
      .select('status,role,relative_path')
      .eq('run_id', run.id)
      .eq('status', 'validated');
    eligibility = classifyGenerationEntryArtifacts(data, error);
  } catch {
    eligibility = 'unavailable';
  }

  if (eligibility !== 'eligible') {
    const unavailable = eligibility === 'unavailable';
    return (
      <main className="min-h-screen px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <Link href={`/runs/${encodeURIComponent(params.id)}`} className="text-xs text-ink-500 hover:text-ink-200">← Back to run</Link>
          <div className="mt-4 rounded-lg border border-ink-800 bg-ink-950/50 p-5">
            <h1 className="text-lg font-medium text-ink-100">
              {unavailable ? "Implexa couldn't verify this run's video." : 'This run has no validated final video.'}
            </h1>
            <p className="mt-2 text-sm text-ink-400">
              {unavailable
                ? 'The artifact check is unavailable right now. Reload before preparing paid generation.'
                : 'B-roll generation is available only after the desktop validates a final MP4, MOV, M4V, or WebM output.'}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const agentName = humanize(run.skill_slug);
  const seedMoments = await seedFromEditedProposal(searchParams?.from, run.id);
  const editRequestedButUnavailable = !!searchParams?.from && seedMoments === null;
  return (
    <main className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <Link href={`/runs/${encodeURIComponent(params.id)}`} className="text-xs text-ink-500 hover:text-ink-200">← Back to run</Link>
        {editRequestedButUnavailable && (
          <p role="status" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {/* Say what happened. Silently opening a blank builder would look like
                the edit worked and leave the user rebuilding without knowing it. */}
            Implexa couldn&apos;t load the plan you asked to edit, so this builder is starting
            empty. Nothing was changed or approved — check that plan before rebuilding it here.
          </p>
        )}
        <div className="mt-4">
          <BrollProposalBuilder
            runId={run.id} agentSubject={run.skill_slug} agentName={agentName}
            seedMoments={seedMoments}
          />
        </div>
      </div>
    </main>
  );
}
