/**
 * Synchronous ordering for two producers of one run-input field:
 * automatic saved-source verification and a newer manual picker result.
 *
 * This is intentionally a tiny mutable clock. React state commits too late to
 * order promise continuations that can settle within the same render.
 */
export function readInputRevision(revisions: Record<string, number>, key: string): number {
  return revisions[key] || 0;
}

export function advanceInputRevision(revisions: Record<string, number>, key: string): number {
  const next = readInputRevision(revisions, key) + 1;
  revisions[key] = next;
  return next;
}

export function inputRevisionIsCurrent(
  revisions: Record<string, number>,
  key: string,
  expected: number,
): boolean {
  return readInputRevision(revisions, key) === expected;
}
