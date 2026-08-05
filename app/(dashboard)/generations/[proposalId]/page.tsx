import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyAgents } from '@/lib/agents-home';
import { getGenerationProposal } from '@/lib/generation-proposal-read';
import { getReviewPacket } from '@/lib/review';
import { requestedByLine } from '@/lib/generation-proposal-state';
import GenerationProposalCard from '../../_components/generation-proposal-card';
import GenerationProgressCard from '../../_components/generation-progress-card';
import GenerationClipResults from '../../_components/generation-clip-results';
import ProfessionalV2ProposalCard from '../../_components/professional-v2-proposal-card';

export const dynamic = 'force-dynamic';

/**
 * /generations/[proposalId] — one paid-generation proposal: what was proposed,
 * where it stands, and the finished clips.
 *
 * Three DIFFERENT non-happy answers, never merged:
 *   unavailable  we could not read it — the proposal may be fine
 *   not_found    the backend affirmatively said it does not exist for this user
 *   unavailable-mode  a real proposal that cannot run (e.g. Production)
 */
export default async function GenerationProposalPage({ params }: { params: { proposalId: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const read = await getGenerationProposal(params.proposalId);

  if (read.state === 'unavailable') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <h1 className="text-lg font-medium text-ink-100">We couldn&apos;t load this proposal.</h1>
        <p className="mt-2 text-sm text-ink-400">
          That doesn&apos;t mean it failed or disappeared — the service didn&apos;t answer
          just now, or answered in a form we refused to guess about. If you were
          waiting on an approval, nothing has been approved from this page.
        </p>
      </div>
    );
  }

  if (read.state === 'not_found') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <h1 className="text-lg font-medium text-ink-100">This proposal doesn&apos;t exist.</h1>
        <p className="mt-2 text-sm text-ink-400">
          Implexa has no generation proposal with this id for your account.
        </p>
      </div>
    );
  }

  /**
   * A `professional-generation-control.v2` plan is a DIFFERENT document: a
   * timeline of moments, each with its own variants, Judge mode and repair
   * reserve. It renders through its own card rather than being flattened into
   * the v1 clip list, which has no place to state any of that — and no place to
   * keep coverage and takes apart.
   *
   * Progress, clip results and the review-packet join stay on the v1 arm: this
   * lane ships no execution surface for v2, and inventing one for a document
   * nothing here validates would be worse than saying so.
   */
  if (read.contract === 'v2') {
    const agents = await getMyAgents();
    const name = new Map(
      [
        ...(agents.status === 'ready' ? agents.active : []),
        ...(agents.status === 'ready' ? agents.needsActivation : []),
        ...(agents.status === 'ready' ? agents.drafts : []),
      ].map((a) => [a.slug, a.name] as const),
    ).get(read.vm.agentSubject) ?? null;
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <header className="mb-5">
          <h1 className="text-xl font-semibold text-ink-100">B-roll generation</h1>
          <p className="mt-1 text-xs text-ink-400">
            Requested by {name ?? read.vm.agentSubject}
            {read.vm.sourceRunId && (
              <>
                {' · '}
                <Link href={`/runs/${read.vm.sourceRunId}`} className="text-sky-400 hover:underline">
                  from this run
                </Link>
              </>
            )}
          </p>
        </header>
        {/* Edit carries THIS plan into the builder (`from`), so editing changes a
            timeline instead of discarding it and starting from blank. */}
        <ProfessionalV2ProposalCard
          vm={read.vm}
          agentName={name}
          editHref={read.vm.sourceRunId
            ? `/runs/${encodeURIComponent(read.vm.sourceRunId)}/generate-broll?from=${encodeURIComponent(read.vm.proposalId)}`
            : null}
        />
      </div>
    );
  }

  const { vm } = read;

  const [myAgents, packet] = await Promise.all([
    getMyAgents(),
    // The clips join against the source run's validated artifacts. No source run,
    // no packet to read.
    vm.sourceRunId && vm.receipt ? getReviewPacket(vm.sourceRunId) : Promise.resolve(null),
  ]);

  const nameBySlug = new Map(
    [
      ...(myAgents.status === 'ready' ? myAgents.active : []),
      ...(myAgents.status === 'ready' ? myAgents.needsActivation : []),
      ...(myAgents.status === 'ready' ? myAgents.drafts : []),
    ].map((a) => [a.slug, a.name] as const),
  );
  const agentName = nameBySlug.get(vm.agentSubject) ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink-100">B-roll generation</h1>
        <p className="mt-1 text-xs text-ink-400">
          {requestedByLine(vm, agentName)}
          {vm.sourceRunId && (
            <>
              {' · '}
              <Link href={`/runs/${vm.sourceRunId}`} className="text-sky-400 hover:underline">
                from this run
              </Link>
            </>
          )}
        </p>
      </header>

      <div className="space-y-4">
        <GenerationProgressCard vm={vm} />

        {/* Awaiting approval renders the live card; an unavailable proposal that
            still carries its task graph (Professional preview) renders the same
            card in its no-money preview form. */}
        {(vm.lifecycle === 'awaiting_approval' || (vm.lifecycle === 'unavailable' && vm.taskCount > 0)) && (
          <GenerationProposalCard
            vm={vm}
            agentName={agentName}
            editHref={vm.sourceRunId ? `/runs/${vm.sourceRunId}` : null}
          />
        )}

        {vm.receipt && (
          <GenerationClipResults
            vm={vm}
            artifacts={packet?.live ? packet.artifacts : []}
            artifactsLive={!!packet?.live}
          />
        )}
      </div>
    </div>
  );
}
