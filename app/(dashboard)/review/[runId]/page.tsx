import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyAgents } from '@/lib/agents-home';
import { getReviewPacket, unavailableSources } from '@/lib/review';
import ReviewRoom from '../../_components/review-room';

export const dynamic = 'force-dynamic';

/**
 * /review/[runId] — the Review Room.
 *
 * Four DIFFERENT authorities are shown here and are never merged (spec Sec.2):
 *
 *   this page's issues  human opinion
 *   Judge               a machine's opinion, labelled as such
 *   Verified files      deterministic proof (a digest was checked)
 *   Agent health        operational, and deliberately NOT rendered as review work
 *
 * Accepting a result says a human accepted it. It does not mean Judge passed, and it
 * does not mean anything was verified.
 */
export default async function ReviewRoomPage({ params, searchParams }: {
  params: { runId: string };
  searchParams?: { artifact?: string };
}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const [packet, myAgents] = await Promise.all([getReviewPacket(params.runId), getMyAgents()]);

  if (!packet.live || !packet.run) {
    // Explicitly "we could not load it", never "it does not exist".
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <h1 className="text-lg font-medium text-ink-100">We couldn&apos;t load this review.</h1>
        <p className="mt-2 text-sm text-ink-400">
          That doesn&apos;t mean the result is gone — the review service didn&apos;t answer just now.
        </p>
        <Link href="/review" className="mt-6 inline-block text-sm text-sky-400 hover:underline">
          Back to Review
        </Link>
      </div>
    );
  }

  const nameBySlug = new Map(
    [
      ...(myAgents.status === 'ready' ? myAgents.active : []),
      ...(myAgents.status === 'ready' ? myAgents.needsActivation : []),
      ...(myAgents.status === 'ready' ? myAgents.drafts : []),
    ].map((a) => [a.slug, a.name] as const),
  );
  const agentName = (packet.run.slug ? nameBySlug.get(packet.run.slug) : null) || packet.run.slug || 'Unnamed agent';
  const broken = unavailableSources(packet.sources);
  const isApprovalHold = packet.run.holdKind === 'approval_before_action';

  const versions = packet.lineage?.versions || [];
  const currentLabel = versions.find((v) => v.runId === packet.run!.id)?.label ?? null;
  type ReviewLearningProof = { id: string; launch_attempt_id: string; fencing_epoch: number; context_digest: string;
    context: { rules?: Array<{ id: string; version: number; versionDigest: string; instruction: string }> } };
  let reviewLearningProof: ReviewLearningProof | null = null;
  let reviewLearningHandling: Array<{ rule_version_id: string; handling: string; reason: string }> = [];
  let reviewLearningAvailable = true;
  try {
    const proof = await supabase.from('run_learning_attempt_contexts').select('*').eq('run_id', packet.run.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (proof.error) reviewLearningAvailable = false;
    else if (proof.data) {
      reviewLearningProof = proof.data as ReviewLearningProof;
      const handling = await supabase.from('run_learning_handling_receipts')
        .select('rule_version_id,handling,reason').eq('attempt_context_id', proof.data.id).order('created_at', { ascending: true });
      if (handling.error) reviewLearningAvailable = false;
      else reviewLearningHandling = handling.data || [];
    }
  } catch { reviewLearningAvailable = false; }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4">
        <Link href="/review" className="text-xs text-ink-500 hover:text-ink-300">← Review</Link>
      </div>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Agent name is the identity; the revision label is secondary context. */}
          <h1 className="truncate text-xl font-semibold text-ink-100">{agentName}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
            {currentLabel && <span className="rounded bg-ink-800 px-1.5 py-0.5">{currentLabel}</span>}
            {packet.sources.judgment === 'unavailable' ? (
              <span className="text-amber-300">Judge state unavailable</span>
            ) : packet.judgment ? (
              <span>Judge: {packet.judgment.verdict}</span>
            ) : (
              <span className="text-ink-500">No Judge verdict</span>
            )}
            {packet.session?.state === 'accepted' && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">Accepted</span>
            )}
          </p>
        </div>
      </header>

      {broken.length > 0 && (
        <div role="status" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Some of this review couldn&apos;t be loaded ({broken.join(', ')}). What you see may be incomplete.
        </div>
      )}

      <section className="mb-5 rounded-lg border border-ink-800 bg-ink-950/40 p-4" aria-label="Learning proof">
        <h2 className="text-sm font-semibold text-ink-100">Learning proof</h2>
        {!reviewLearningAvailable ? (
          <p className="mt-2 text-xs text-amber-300">Attempt-bound learning proof is unavailable. No handling state is inferred.</p>
        ) : !reviewLearningProof ? (
          <p className="mt-2 text-xs text-ink-500">No learning context was frozen for this run.</p>
        ) : (
          <div className="mt-2">
            <p className="text-[11px] text-ink-500">Attempt {reviewLearningProof.launch_attempt_id.slice(0, 12)} · fence {reviewLearningProof.fencing_epoch} · context {reviewLearningProof.context_digest.slice(0, 12)}</p>
            <ul className="mt-2 space-y-2">
              {(reviewLearningProof.context.rules || []).map((rule) => {
                const receipt = reviewLearningHandling.find((item) => item.rule_version_id === rule.id);
                return <li key={rule.id} className="rounded border border-ink-800 px-3 py-2 text-xs text-ink-300">
                  <p>{rule.instruction}</p>
                  <p className="mt-1 text-ink-500">v{rule.version} · {rule.versionDigest.slice(0, 12)} · executor handling {receipt ? receipt.handling.replaceAll('_', ' ') : 'pending'}</p>
                  {receipt?.reason && <p className="mt-1 text-ink-500">Reason: {receipt.reason}</p>}
                  <p className="mt-1 text-ink-500">Applied is an executor report, not proof of causation or success.</p>
                </li>;
              })}
            </ul>
          </div>
        )}
      </section>

      <ReviewRoom
        runId={packet.run.id}
        agentSlug={packet.run.slug}
        agentName={agentName}
        artifacts={packet.artifacts}
        production={packet.production}
        issues={packet.issues}
        session={packet.session}
        reviewArtifacts={packet.reviewArtifacts}
        sources={packet.sources}
        isApprovalHold={isApprovalHold}
        // A generated-clip deep link (?artifact=) opens on that clip. The id is
        // honored only if the packet actually contains it.
        initialArtifactId={typeof searchParams?.artifact === 'string' ? searchParams.artifact : null}
      />

      {/* Distinct authorities, kept visually and semantically separate. */}
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
          <h2 className="text-sm font-medium text-ink-200">Judge</h2>
          <p className="mt-1 text-xs text-ink-500">A machine&apos;s opinion. Not proof, and not your decision.</p>
          {packet.sources.judgment === 'unavailable' ? (
            <p className="mt-2 text-xs text-amber-300">Unavailable — we couldn&apos;t read it.</p>
          ) : packet.judgment ? (
            <>
              <p className="mt-2 text-sm text-ink-200">{packet.judgment.verdict}</p>
              <p className="mt-1 text-xs text-ink-400">{packet.judgment.summary}</p>
            </>
          ) : (
            <p className="mt-2 text-xs text-ink-500">No verdict recorded.</p>
          )}
        </div>

        <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
          <h2 className="text-sm font-medium text-ink-200">Verified files</h2>
          <p className="mt-1 text-xs text-ink-500">Deterministic checks. Independent of Judge and of your review.</p>
          {packet.sources.verification === 'unavailable' ? (
            <p className="mt-2 text-xs text-amber-300">Unavailable — we couldn&apos;t read it.</p>
          ) : packet.verification.receipts.length ? (
            <ul className="mt-2 space-y-1 text-xs text-ink-300">
              {packet.verification.receipts.map((r) => (
                <li key={r.id}>{r.adapterKind}: {r.status}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-500">No verification receipts.</p>
          )}
        </div>

        <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
          <h2 className="text-sm font-medium text-ink-200">Versions</h2>
          {packet.sources.lineage === 'unavailable' ? (
            <p className="mt-2 text-xs text-amber-300">
              Version history unavailable — we can&apos;t say how this relates to earlier runs.
            </p>
          ) : versions.length ? (
            <ul className="mt-2 space-y-1 text-xs">
              {versions.map((v) => (
                <li key={v.runId}>
                  {v.runId === packet.run!.id ? (
                    <span className="text-ink-100">{v.label} (viewing)</span>
                  ) : (
                    <Link href={`/review/${v.runId}`} className="text-sky-400 hover:underline">{v.label}</Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-500">No revisions yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
