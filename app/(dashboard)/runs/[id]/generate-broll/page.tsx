import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import {
  SOURCE_STATE_COPY, classifyGenerationSource, formatDurationMs, selectSource,
  type GenerationSourceState, type VerifiedGenerationSource,
} from '@/lib/generation-source';
import { getGenerationProposal } from '@/lib/generation-proposal-read';
import { timelineFromCompiledProposal } from '@/lib/professional-v2-entry';
import { EDIT_SEED_COPY, resolveEditSeed, type EditSeed } from '@/lib/generation-edit-seed';
import BrollProposalBuilder from '../../../_components/broll-proposal-builder';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The plan the user chose to edit — its moments AND the exact source artifact
 * its signed binding names — or null.
 *
 * `?from=` is a URL parameter, so it is treated as an ID TO LOOK UP and nothing
 * more. The proposal is read through the same owner-scoped, JWT-authenticated
 * backend read as everywhere else, so a foreign or invented id simply resolves
 * to nothing. It must also be a v2 plan for THIS run — carrying a plan across
 * runs would bind a timeline to a source it was never written for.
 *
 * THE SOURCE TRAVELS WITH THE MOMENTS, as one seed. A seed that carried only
 * moments left the page to resolve the source on its own, and on a run with
 * several final videos the ambiguity chooser then swallowed the edit entirely
 * — the plan's timeline gone, the builder blank, bound to whichever file the
 * user happened to click. The plan already NAMES its file, in a binding the
 * backend signed; the page's job is to honour it or refuse loudly.
 *
 * No approval identity travels: moments and a source id only, so a fresh
 * compile with its own identity is required before anything can be saved.
 */
async function seedFromEditedProposal(proposalId: unknown, runId: string): Promise<EditSeed | null> {
  if (typeof proposalId !== 'string' || !UUID.test(proposalId)) return null;
  const read = await getGenerationProposal(proposalId);
  if (read.state !== 'ready' || read.contract !== 'v2') return null;
  if (read.vm.sourceRunId !== runId) return null;
  const moments = timelineFromCompiledProposal(read.vm.compiled);
  if (!moments) return null;
  return { moments, sourceArtifactId: read.vm.compiled.sourceBinding.sourceArtifactId };
}

function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function GenerateBrollPage({ params, searchParams }: {
  params: { id: string };
  searchParams?: { from?: string; source?: string };
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

  // THE AUTHORITATIVE SOURCE AND ITS LENGTH.
  //
  // `media_duration_ms` is read, never derived. The browser cannot open the
  // file, and every number it could reach for instead — size_bytes, a filename,
  // a <video> element's duration after a partial fetch — is a guess or an
  // attacker-controlled value. A confidently-wrong ceiling is worse than none:
  // it would refuse legitimate plans and accept illegitimate ones with equal
  // confidence.
  let sourceState: GenerationSourceState = { state: 'unavailable' };
  try {
    const { data, error } = await supabase.from('run_artifacts')
      .select('id,status,role,relative_path,media_duration_ms')
      .eq('run_id', run.id)
      .eq('status', 'validated');
    sourceState = classifyGenerationSource(data, error);
  } catch {
    sourceState = { state: 'unavailable' };
  }

  // THE EDIT SEED LOADS BEFORE THE SOURCE IS RESOLVED, because an edited plan
  // already names its source and that naming outranks the run-level chooser.
  const seed = await seedFromEditedProposal(searchParams?.from, run.id);
  const editRequested = !!searchParams?.from;
  const allSources = 'sources' in sourceState ? sourceState.sources : [];

  // The edited plan's own resolution: bind to ITS source, honour an explicit
  // different choice as a stated change, or fail closed — decided by the pure
  // resolver so the A/B case is a unit test, not a page walkthrough.
  const editResolution = seed ? resolveEditSeed(seed, allSources, searchParams?.source ?? null) : null;

  // AMBIGUITY IS RESOLVED BY THE USER, NEVER BY US. With several validated final
  // videos, `?source=` carries their explicit choice; without one the page asks.
  // An EDIT bypasses the chooser entirely when its plan's source is verified —
  // the choice was made when the plan was compiled.
  const chosen = sourceState.state === 'ambiguous'
    ? selectSource(sourceState.sources, searchParams?.source ?? null)
    : null;
  // Narrowed to a VERIFIED source or nothing. The type carries the guarantee so
  // the builders cannot be handed a `mediaDurationMs: null` — an unverified
  // source is not a source this lane can compile against, and saying that in the
  // type means no component has to re-check it.
  const chosenDuration = chosen === null ? null : chosen.mediaDurationMs;
  const source: VerifiedGenerationSource | null =
    editResolution && (editResolution.kind === 'bound' || editResolution.kind === 'source_changed')
      ? editResolution.source
      : editResolution
        ? null // an edit whose source cannot be honoured NEVER falls back to the chooser's pick
        : sourceState.state === 'eligible'
          ? sourceState.source
          : (chosen !== null && chosenDuration !== null ? { ...chosen, mediaDurationMs: chosenDuration } : null);

  // ── AN EDIT THAT CANNOT BIND FAILS CLOSED, with its own copy ──────────────
  if (editResolution && (editResolution.kind === 'source_unverified' || editResolution.kind === 'source_missing')) {
    const copy = EDIT_SEED_COPY[editResolution.kind];
    // The deliberate way out: recompile these SAME moments against another
    // verified source. `from` is preserved so the plan's timeline survives the
    // click; `source` states the change; nothing happens without this click.
    const alternates = allSources.filter((candidate) => candidate.mediaDurationMs !== null
      && candidate.artifactId !== seed!.sourceArtifactId);
    return (
      <main className="min-h-screen px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <Link href={`/runs/${encodeURIComponent(params.id)}`} className="text-xs text-ink-500 hover:text-ink-200">← Back to run</Link>
          <div className="mt-4 rounded-lg border border-ink-800 bg-ink-950/50 p-5">
            <h1 className="text-lg font-medium text-ink-100">{copy.title}</h1>
            <p className="mt-2 text-sm text-ink-400">{copy.body}</p>
            {copy.action && (
              <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{copy.action}</p>
            )}
            {alternates.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-ink-300">Change source and recompile these moments</p>
                <ul className="mt-2 space-y-2">
                  {alternates.map((candidate) => (
                    <li key={candidate.artifactId}>
                      <Link
                        href={`/runs/${encodeURIComponent(params.id)}/generate-broll?from=${encodeURIComponent(String(searchParams?.from))}&source=${encodeURIComponent(candidate.artifactId)}`}
                        className="flex items-center justify-between rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:border-ink-500"
                      >
                        <span>{candidate.relativePath}</span>
                        <span className="text-xs text-ink-400">{formatDurationMs(candidate.mediaDurationMs as number)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (!source) {
    // Which unavailable state, exactly — because "unavailable" with no reason is
    // a dead end, and for the commonest case the next step is genuinely "open
    // the desktop app", not anything the user can do in this tab.
    const state = sourceState.state === 'ambiguous' && chosen && chosen.mediaDurationMs === null
      ? 'needs_verification'
      : (sourceState.state === 'eligible' ? 'unavailable' : sourceState.state);
    const copy = SOURCE_STATE_COPY[state];
    const choices = sourceState.state === 'ambiguous' ? sourceState.sources : [];
    return (
      <main className="min-h-screen px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <Link href={`/runs/${encodeURIComponent(params.id)}`} className="text-xs text-ink-500 hover:text-ink-200">← Back to run</Link>
          <div className="mt-4 rounded-lg border border-ink-800 bg-ink-950/50 p-5">
            <h1 className="text-lg font-medium text-ink-100">{copy.title}</h1>
            <p className="mt-2 text-sm text-ink-400">{copy.body}</p>
            {copy.action && (
              <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {copy.action}
              </p>
            )}
            {choices.length > 0 && (
              <ul className="mt-4 space-y-2">
                {choices.map((candidate) => (
                  <li key={candidate.artifactId}>
                    <Link
                      href={`/runs/${encodeURIComponent(params.id)}/generate-broll?source=${encodeURIComponent(candidate.artifactId)}${searchParams?.from ? `&from=${encodeURIComponent(searchParams.from)}` : ''}`}
                      className="flex items-center justify-between rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:border-ink-500"
                    >
                      <span>{candidate.relativePath}</span>
                      <span className="text-xs text-ink-400">
                        {/* An unverified candidate is offered and LABELLED, not
                            hidden: the file the user meant may be this one, and
                            choosing it should tell them what is missing. */}
                        {candidate.mediaDurationMs === null
                          ? 'length not verified yet'
                          : formatDurationMs(candidate.mediaDurationMs)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    );
  }

  const agentName = humanize(run.skill_slug);
  const seedMoments = editResolution ? editResolution.moments : null;
  const editRequestedButUnavailable = editRequested && seed === null;
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
        {editResolution && editResolution.kind === 'source_changed' && (
          <p role="status" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {/* A stated change, never a silent one: the moments came from a plan
                compiled against a different video, and the new source's length is
                what these windows will now be checked against. */}
            You&apos;re recompiling this plan against a <span className="font-medium">different source video</span> than
            it was originally built for. The moments carried over; their windows will be checked
            against the new video&apos;s length when you preview.
          </p>
        )}
        <div className="mt-4">
          <BrollProposalBuilder
            runId={run.id} agentSubject={run.skill_slug} agentName={agentName}
            source={source}
            seedMoments={seedMoments}
          />
        </div>
      </div>
    </main>
  );
}
