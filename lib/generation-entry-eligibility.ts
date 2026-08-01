/** A B-roll entry point needs a desktop-validated video, not a path in prose. */
export function isValidatedVideoOutput(artifact: { role: string | null; relativePath: string }): boolean {
  return artifact.role === 'final_output' && /\.(?:mp4|mov|m4v|webm)$/i.test(artifact.relativePath);
}
