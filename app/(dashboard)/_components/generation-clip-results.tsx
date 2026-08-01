/**
 * <GenerationClipResults /> — each finished clip, separately, with its task label
 * and timestamp window.
 *
 * RULES THIS COMPONENT ENFORCES:
 *
 *  * NO local path and NO preview URL ever passes through here. A clip opens only
 *    via a route into the existing Review Room, which owns the opaque
 *    `implexa-artifact://preview/<token>` protocol, its desktop/update-required
 *    degradation, and its clip-switch state resets.
 *  * Comments are clip-scoped: the link opens the Review Room preselected on this
 *    clip's own artifact, so a timestamp comment binds to that artifact's digest.
 *    Whole-run feedback belongs on the run, not on any clip timeline.
 *  * Regenerate renders DISABLED with the honest reason — the backend offers no
 *    per-clip regeneration yet, and this surface does not simulate one.
 *  * An unreadable artifact source is bannered; clips are never quietly rendered
 *    as if they had no files.
 */

import Link from 'next/link';
import type { ReviewArtifact } from '@/lib/review';
import type { GenerationProposalViewModel } from '@/lib/generation-proposal';
import { clipActions, clipReviewHref, clipRows } from '@/lib/generation-clips';

const STATUS_CLASSES: Record<string, string> = {
  succeeded: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
  unknown: 'bg-amber-500/15 text-amber-300',
};

const STATUS_LABEL: Record<string, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  unknown: 'Outcome unknown',
};

export default function GenerationClipResults({ vm, artifacts, artifactsLive }: {
  vm: GenerationProposalViewModel;
  artifacts: ReviewArtifact[];
  /** Whether the review packet (the artifact source) was actually readable. */
  artifactsLive: boolean;
}) {
  const result = clipRows(vm, artifacts, artifactsLive);
  if (result.state === 'no_results_yet') return null;

  return (
    <section aria-label="Generated clips" className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
      <h2 className="text-sm font-medium text-ink-200">Generated clips</h2>

      {result.state === 'artifacts_unavailable' && (
        <p role="status" className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
          We couldn&apos;t load this run&apos;s files just now, so these clips can&apos;t be
          opened from here yet. The clips themselves are listed from the durable
          generation receipt.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {result.rows.map((row) => {
          const acts = clipActions(row);
          return (
            <li key={row.taskId} className="rounded border border-ink-800 bg-ink-950 p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-ink-200">{row.label}</span>
                {row.window && <span className="font-mono text-ink-400">{row.window}</span>}
                <span className={`ml-auto rounded px-1.5 py-0.5 ${STATUS_CLASSES[row.status]}`}>
                  {STATUS_LABEL[row.status]}
                </span>
              </div>

              {!row.artifactId && row.noArtifactReason && (
                <p className="mt-1.5 text-[11px] text-ink-500">{row.noArtifactReason}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {acts.canOpen && vm.sourceRunId && row.artifactId ? (
                  <>
                    <Link
                      href={clipReviewHref(vm.sourceRunId, row.artifactId)}
                      className="rounded-md bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-950"
                    >
                      Play in Review Room
                    </Link>
                    <Link
                      href={clipReviewHref(vm.sourceRunId, row.artifactId)}
                      className="rounded-md border border-ink-700 px-2.5 py-1 text-xs text-ink-200"
                    >
                      Comment on this clip
                    </Link>
                  </>
                ) : null}
                <button
                  type="button"
                  disabled
                  title={acts.regenerate.reason}
                  className="rounded-md border border-ink-800 px-2.5 py-1 text-xs text-ink-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Regenerate this clip
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-snug text-ink-500">
        Regenerating a single clip isn&apos;t supported yet — the backend doesn&apos;t offer
        it. Comment on a clip and request fixes in the Review Room instead.
      </p>
    </section>
  );
}
