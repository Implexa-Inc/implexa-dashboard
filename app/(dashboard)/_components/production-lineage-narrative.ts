/**
 * The one decision the run permalink makes about production lineage, kept in a
 * plain .ts module so it can be graded by `node --test` — Node's built-in type
 * stripping does not transform JSX, so this cannot live in the .tsx beside it.
 * Same split as engine-override-disclosure.ts / <EngineOverrideBanner>.
 */

import type { ProductionLineage } from '@/lib/outcome-production-detail';

/**
 * Should the run page stop leading with "this run stalled / did not finish"?
 *
 * True exactly when a DIFFERENT run is the authority for this production node.
 * The stall is then a fact about an abandoned execution attempt, not about the
 * work — and a completed related run must never leave the reader with a primary
 * "this run stalled" conclusion.
 *
 * Exported so the page and the banner cannot disagree about it.
 */
export function supersedesFailureNarrative(lineage: ProductionLineage | null): boolean {
  return Boolean(lineage && lineage.superseded);
}
