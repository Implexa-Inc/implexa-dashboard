/**
 * lib/quality-mode.ts — the quality-mode vocabulary, and the Production gate.
 *
 * THE LABELS ARE DISPLAY, THE VALUES ARE IDENTITY. "Quick" is what the user reads;
 * `fast` is what the backend compiled, stored, and will bill against. Nothing here
 * ever persists a display label, and nothing downstream may compare against one —
 * a renamed label must never change behavior.
 *
 * The differences between modes are NOT described here beyond one fixed sentence
 * each. What Quick and Professional actually do — stages, density, review
 * requirements, credits — is compiled by the backend and displayed from the
 * compiled proposal verbatim. The dashboard does not calculate or reinterpret
 * those differences; see modeDifferenceRows().
 */

export type QualityMode = 'fast' | 'professional' | 'production';

export const QUALITY_MODES: readonly QualityMode[] = ['fast', 'professional', 'production'];

export function isQualityMode(v: unknown): v is QualityMode {
  return v === 'fast' || v === 'professional' || v === 'production';
}

/** Display metadata only. The `value` is the only thing that may be persisted or sent. */
export function qualityModeOption(mode: QualityMode): { value: QualityMode; label: string; description: string } {
  switch (mode) {
    case 'fast':
      return {
        value: 'fast', label: 'Quick',
        description: 'Faster, lower-density generation with essential validation.',
      };
    case 'professional':
      return {
        value: 'professional', label: 'Professional',
        description: 'Higher-density planning, per-asset review, and repair-ready output.',
      };
    case 'production':
      return {
        value: 'production', label: 'Production',
        description: 'Full production pipeline with per-clip judging and segmented assembly.',
      };
  }
}

/** The label for a mode value. An UNKNOWN value is named honestly, never dressed as a known mode. */
export function qualityModeLabel(mode: string): string {
  return isQualityMode(mode) ? qualityModeOption(mode).label : `Unrecognized mode (${mode})`;
}

/**
 * Production is not built. This build refuses to offer it REGARDLESS of what any
 * response claims, and the backend refuses to compile it regardless of what the UI
 * sends. Neither side trusts the other alone.
 */
export const PRODUCTION_AVAILABLE_IN_THIS_BUILD = false;

/**
 * May this mode be offered as a live choice?
 *
 * TWO INDEPENDENT GATES, on purpose. Production is disabled by BOTH the static
 * build flag above AND the backend's compiled `availability`. Deleting either one
 * leaves the other standing:
 *
 *   - delete the static gate → a backend proposal with availability=false (which is
 *     what the compiler emits for production) still disables it;
 *   - a corrupted/forged response claiming availability=true → the static gate
 *     still disables it.
 *
 * `compiled` is null when no backend compilation has been seen for this mode yet —
 * an unproven mode is not selectable, because selecting it would promise behavior
 * nobody has compiled.
 */
export function isModeSelectable(
  mode: QualityMode,
  compiled: { availability: boolean } | null,
): boolean {
  if (compiled === null || compiled.availability !== true) return false;
  if (mode === 'production' && !PRODUCTION_AVAILABLE_IN_THIS_BUILD) return false;
  return true;
}

/** Human words for the machine-readable capability keys Production is missing. */
const CAPABILITY_WORDS: Record<string, string> = {
  'video.judge.per_asset': 'per-clip judging',
  'video.orchestration.segmented_assembly': 'segmented assembly',
};

export function capabilityWords(key: string): string {
  // An unknown key is shown verbatim — a made-up friendly name would claim we know
  // what it is when we do not.
  return CAPABILITY_WORDS[key] ?? key;
}

/**
 * Honest user copy for WHY Production is unavailable, translated from the exact
 * machine-readable reason the backend supplied. An unknown reason code is surfaced,
 * not hidden behind generic copy — the code is the truth we actually have.
 */
export function productionUnavailableCopy(
  reason: string | null,
  requiredMissingCapabilities: readonly string[],
): string {
  if (reason === 'missing_required_production_capabilities') {
    const parts = requiredMissingCapabilities.map(capabilityWords);
    const needs = parts.length
      ? parts.join(' and ')
      : 'capabilities that are not built yet';
    return `Production mode isn't available yet — it needs ${needs}, which ${parts.length === 1 ? "isn't" : "aren't"} built yet.`;
  }
  if (reason) {
    return `Production mode isn't available (${reason}).`;
  }
  // No compiled reason in hand. Say the honest minimum; do not invent a cause.
  return "Production mode isn't available in this build yet.";
}

/**
 * The mode-difference rows a selector may display, drawn ONLY from backend-compiled
 * fields. There is deliberately no arithmetic here — no per-mode credit math, no
 * inferred behavior. If the backend did not say it, the row does not exist.
 */
export function modeDifferenceRows(compiled: {
  densityLabel: string | null;
  generationsPerMoment: number | null;
  stageKinds: readonly string[];
  reviewRequirements: readonly string[];
} | null): Array<{ term: string; detail: string }> {
  if (!compiled) return [];
  const rows: Array<{ term: string; detail: string }> = [];
  if (compiled.densityLabel !== null && compiled.generationsPerMoment !== null) {
    rows.push({
      term: 'Density',
      detail: `${compiled.densityLabel} — ${compiled.generationsPerMoment} generation${compiled.generationsPerMoment === 1 ? '' : 's'} per moment`,
    });
  }
  if (compiled.stageKinds.length) {
    rows.push({ term: 'Pipeline', detail: compiled.stageKinds.map((k) => k.replace(/_/g, ' ')).join(' → ') });
  }
  if (compiled.reviewRequirements.length) {
    rows.push({ term: 'Review', detail: compiled.reviewRequirements.map((k) => k.replace(/_/g, ' ')).join(', ') });
  }
  return rows;
}
