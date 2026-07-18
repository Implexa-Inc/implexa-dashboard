// Pure decision logic for <EngineOverrideBanner /> — kept in its own .ts file
// (no JSX) so it's testable with `node --test` (this repo's native-TS pattern);
// Node's built-in type-stripping does not transform JSX, so a .tsx file can't be
// imported this way. See engine-override-disclosure.test.ts.

const ENGINE_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex' };

export type OverrideDisclosure = { pinLabel: string; ranLabel: string; selectionReason: string | null };

/**
 * Pure: null when nothing should be disclosed (no override, or insufficient data).
 * Only 'claude' / 'codex' are real pins — 'auto' (or null/missing) means the user
 * never pinned this agent, so whatever the router picked is its own free choice,
 * not an override worth disclosing.
 */
export function computeOverrideDisclosure(
  originalPreference: string | null | undefined,
  selectedExecutor: string | null | undefined,
  selectionReason: string | null | undefined,
): OverrideDisclosure | null {
  if (originalPreference !== 'claude' && originalPreference !== 'codex') return null;
  if (!selectedExecutor || selectedExecutor === originalPreference) return null;
  return {
    pinLabel: ENGINE_LABEL[originalPreference] || originalPreference,
    ranLabel: ENGINE_LABEL[selectedExecutor] || selectedExecutor,
    selectionReason: selectionReason || null,
  };
}
