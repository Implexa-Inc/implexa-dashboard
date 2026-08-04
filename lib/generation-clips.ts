/**
 * lib/generation-clips.ts — mapping finished generation clips to reviewable
 * artifacts.
 *
 * A receipt row names a clip by task id and (when the desktop validated one) an
 * artifact by sha256 digest. The Review Room packet carries the run's validated
 * artifacts with the same digests. The JOIN IS THE DIGEST — never a filename and
 * never a path: identical bytes are the same artifact, and nothing else is.
 *
 * These rows carry NO preview URLs and NO paths. Playback happens only inside the
 * existing Review Room, which mints an opaque `implexa-artifact://preview/<token>`
 * capability per view through the desktop bridge, with its existing
 * desktop_required / update_required degradation and its clip-switch state resets.
 * This module hands the Review Room an artifact id and nothing more.
 */

import type { ReviewArtifact } from './review.ts';
import type { GenerationProposalViewModel } from './generation-proposal.ts';
import { taskLabel, taskWindowLabel } from './generation-proposal-state.ts';

export type ClipRow = {
  taskId: string;
  /** Human label: moment + variant, e.g. "hook — primary". */
  label: string;
  /** The clip's timestamp window in the parent timeline, e.g. "0:12–0:17". */
  window: string;
  status: 'succeeded' | 'failed' | 'unknown';
  /** The digest the receipt bound this clip's output to, if any. */
  artifactSha256: string | null;
  /** The matching VALIDATED artifact in this run's review packet, if present. */
  artifactId: string | null;
  /** Why there is nothing to open, when there isn't. Null when artifactId is set. */
  noArtifactReason: string | null;
};

export type ClipRowsResult =
  | { state: 'ready'; rows: ClipRow[] }
  /** The proposal has no receipt yet — there are no finished clips to list. */
  | { state: 'no_results_yet' }
  /** The review packet (artifact source) could not be read. NOT an empty list. */
  | { state: 'artifacts_unavailable'; rows: ClipRow[] };

/**
 * Build one row per receipt task. `artifactsLive` is whether the review packet
 * read succeeded — when it did not, rows are still listed (the receipt is real)
 * but each is marked unopenable-for-now rather than quietly artifact-less, and
 * the caller must banner the degradation.
 */
export function clipRows(
  vm: Pick<GenerationProposalViewModel, 'tasks' | 'receipt'>,
  artifacts: ReviewArtifact[],
  artifactsLive: boolean,
): ClipRowsResult {
  if (!vm.receipt || vm.receipt.tasks.length === 0) return { state: 'no_results_yet' };

  const tasksById = new Map(vm.tasks.map((t) => [t.taskId, t]));
  // Only validated artifacts are candidates: an unvalidated file is not reviewable
  // evidence anywhere in this product, and the Review Room would refuse it anyway.
  const validatedByDigest = new Map(
    artifacts.filter((a) => a.status === 'validated' && a.sha256)
      .map((a) => [String(a.sha256).toLowerCase(), a] as const),
  );

  const rows: ClipRow[] = vm.receipt.tasks.map((row) => {
    const task = tasksById.get(row.taskId);
    const digest = row.artifactSha256 ? row.artifactSha256.toLowerCase() : null;
    const artifact = digest && artifactsLive ? validatedByDigest.get(digest) ?? null : null;
    let noArtifactReason: string | null = null;
    if (!artifact) {
      if (!digest) {
        noArtifactReason = row.status === 'succeeded'
          ? 'The receipt does not name a validated file for this clip.'
          : 'This clip did not produce a validated file.';
      } else if (!artifactsLive) {
        noArtifactReason = "We couldn't load this run's files just now, so this clip can't be opened here yet.";
      } else {
        noArtifactReason = 'The generated file for this clip is not in this run’s validated files.';
      }
    }
    return {
      taskId: row.taskId,
      // The parser guarantees receipt tasks ⊆ proposal tasks; the fallback keeps
      // this total function total.
      label: task ? taskLabel(task) : row.taskId,
      window: task ? taskWindowLabel(task) : '',
      status: row.status,
      artifactSha256: row.artifactSha256,
      artifactId: artifact?.id ?? null,
      noArtifactReason,
    };
  });

  return artifactsLive ? { state: 'ready', rows } : { state: 'artifacts_unavailable', rows };
}

// ── per-clip actions ────────────────────────────────────────────────────────

export type ClipActions = {
  /** Open in the Review Room (which owns preview, comments, and accept). */
  canOpen: boolean;
  /** Comment goes through the Review Room's issue rail, bound to this artifact. */
  canComment: boolean;
  regenerate: { enabled: false; reason: string };
};

/**
 * What may be offered on one clip. Derived from what the backend actually
 * supports, not from what a label suggests.
 *
 * Regeneration: contract `2026-08-01` compiles every task with paid_retries: 0
 * and paid_alternatives: 0 and exposes NO per-clip regeneration endpoint. So the
 * control renders disabled with that truth — it is not simulated, and it does not
 * silently disappear (a user deciding between "comment and request fixes" and
 * "just regenerate this one" deserves to know the second option is not real yet).
 * When a future contract declares a regeneration capability, this is the single
 * place it binds.
 */
export function clipActions(row: Pick<ClipRow, 'artifactId' | 'status'>): ClipActions {
  const opensSomething = row.artifactId !== null;
  return {
    canOpen: opensSomething,
    canComment: opensSomething,
    regenerate: {
      enabled: false,
      reason: 'Regenerating a single clip isn’t supported yet — the backend doesn’t offer per-clip regeneration. You can comment on this clip and request fixes instead.',
    },
  };
}

/**
 * Where a clip opens. A ROUTE, never a bridge call and never a URL derived from
 * data: the Review Room page owns every preview decision, including old-desktop
 * `update_required` degradation.
 */
export function clipReviewHref(sourceRunId: string, artifactId: string): string {
  return `/review/${encodeURIComponent(sourceRunId)}?artifact=${encodeURIComponent(artifactId)}`;
}
