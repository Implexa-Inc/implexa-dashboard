/**
 * lib/generation-edit-seed.ts — which source an EDITED plan binds to, decided
 * once, as a pure function.
 *
 * THE BUG THIS EXISTS TO KEEP FIXED. Edit used to carry only the plan's
 * moments; the page then resolved the run's source independently, and on a
 * run with several final videos the ambiguity chooser replaced `?from=` with
 * `?source=` — dropping the plan entirely. The user pressed Edit on a plan cut
 * into video B, clicked through a chooser, and landed on an EMPTY builder
 * bound to whatever they clicked. Every moment gone, and no sign that the
 * plan they meant to change had been left behind.
 *
 * So the seed now travels as a PAIR — the moments AND the exact
 * sourceArtifactId the proposal was compiled against (out of its signed
 * source binding) — and this module decides what that pair means against the
 * run's current sources:
 *
 *   bound              — the plan's own source is present and VERIFIED. The
 *                        editor binds to it, chooser bypassed, even on an
 *                        ambiguous run: the plan already names its file.
 *   source_changed     — the user DELIBERATELY chose a different verified
 *                        source (an explicit ?source= that differs). Moments
 *                        carry over; the switch is stated, never silent.
 *   source_unverified  — the plan's source exists but its length is not
 *                        verified (pre-0158, or re-validated without a probe).
 *                        FAIL CLOSED: no editor, Desktop-verification copy,
 *                        and the change-source choices offered as an explicit
 *                        action.
 *   source_missing     — the plan's source is no longer among the run's
 *                        validated final videos at all. FAIL CLOSED, same
 *                        explicit way out.
 *
 * NO IDENTITY EVER RIDES ALONG. The seed is moments + a source id — never a
 * proposal digest, graph digest, or approval reference. Editing produces a
 * fresh compile with its own identity; the retired plan cannot be approved
 * from anything this module returns.
 */

import type { TimelineMoment } from './professional-v2-timeline.ts';
import {
  selectSource, type GenerationSource, type VerifiedGenerationSource,
} from './generation-source.ts';

export type EditSeed = {
  moments: TimelineMoment[];
  /** From the proposal's SIGNED source binding — never inferred from the run. */
  sourceArtifactId: string;
};

export type EditSeedResolution =
  | { kind: 'bound'; source: VerifiedGenerationSource; moments: TimelineMoment[] }
  | { kind: 'source_changed'; source: VerifiedGenerationSource; moments: TimelineMoment[]; originalSourceArtifactId: string }
  | { kind: 'source_unverified'; source: GenerationSource; moments: TimelineMoment[] }
  | { kind: 'source_missing'; sourceArtifactId: string; moments: TimelineMoment[] };

/**
 * Decide what an edit seed means against the run's current sources.
 *
 * `requestedSourceId` is the explicit `?source=` choice, if any. It can only
 * ever WIDEN into `source_changed` when it names a DIFFERENT verified source —
 * it never rescues a missing/unverified original into `bound`, because that
 * would let a stale link quietly re-home a plan.
 */
export function resolveEditSeed(
  seed: EditSeed,
  sources: readonly GenerationSource[],
  requestedSourceId: string | null = null,
): EditSeedResolution {
  const original = selectSource(sources, seed.sourceArtifactId);

  // A DIFFERENT explicit choice first: this is the deliberate "change source
  // and recompile" action, and it is only honoured toward a VERIFIED source.
  if (requestedSourceId && requestedSourceId !== seed.sourceArtifactId) {
    const requested = selectSource(sources, requestedSourceId);
    if (requested && requested.mediaDurationMs !== null) {
      return {
        kind: 'source_changed',
        source: { ...requested, mediaDurationMs: requested.mediaDurationMs },
        moments: seed.moments,
        originalSourceArtifactId: seed.sourceArtifactId,
      };
    }
    // An explicit choice that cannot be honoured falls through to the plan's
    // own source — never silently to some third file.
  }

  if (!original) return { kind: 'source_missing', sourceArtifactId: seed.sourceArtifactId, moments: seed.moments };
  if (original.mediaDurationMs === null) return { kind: 'source_unverified', source: original, moments: seed.moments };
  return {
    kind: 'bound',
    source: { ...original, mediaDurationMs: original.mediaDurationMs },
    moments: seed.moments,
  };
}

/** The fail-closed copy. Each state names its own next step. */
export const EDIT_SEED_COPY = {
  source_unverified: {
    title: "This plan's source video hasn't had its length verified yet.",
    body: 'The plan you are editing was compiled against a specific video, and its moments are bounded by that video’s length — which Implexa Desktop has not verified yet. Open Implexa Desktop and it will verify the video; then reload this page to continue editing. Implexa will not silently rebuild this plan against a different file.',
    action: 'Open Implexa Desktop to verify this video’s duration.',
  },
  source_missing: {
    title: "This plan's source video is no longer available on this run.",
    body: 'The plan you are editing was compiled against a video that is no longer among this run’s validated final outputs — it may have been replaced or re-rendered. Implexa will not silently rebuild the plan against a different file: choose a source below to recompile these moments against it, deliberately.',
    action: null,
  },
} as const;
