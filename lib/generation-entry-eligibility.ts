/** A B-roll entry point needs a desktop-validated video, not a path in prose. */
export function isValidatedVideoOutput(artifact: { role: string | null; relativePath: string }): boolean {
  return artifact.role === 'final_output' && /\.(?:mp4|mov|m4v|webm)$/i.test(artifact.relativePath);
}

export type GenerationEntryEligibility = 'eligible' | 'ineligible' | 'unavailable';

/**
 * Fail closed at the direct-route boundary. A malformed or failed artifact read
 * is not evidence that the run has no video; it means eligibility is unknown.
 */
export function classifyGenerationEntryArtifacts(
  rows: unknown,
  readError: unknown = null,
): GenerationEntryEligibility {
  if (readError || !Array.isArray(rows)) return 'unavailable';
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return 'unavailable';
    const artifact = row as Record<string, unknown>;
    if (typeof artifact.status !== 'string'
      || typeof artifact.relative_path !== 'string'
      || !(artifact.role === null || typeof artifact.role === 'string')) return 'unavailable';
  }
  return rows.some((row) => {
    const artifact = row as { status: string; role: string | null; relative_path: string };
    return artifact.status === 'validated'
      && isValidatedVideoOutput({ role: artifact.role, relativePath: artifact.relative_path });
  }) ? 'eligible' : 'ineligible';
}
