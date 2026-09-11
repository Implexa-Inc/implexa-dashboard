/**
 * lib/run-artifact-projection.ts — ONE projection of `run_artifacts` rows for
 * the run page, so the two consumers cannot drift:
 *   • `verified`  — what <VerifiedArtifacts/> lists (relative name, validated
 *                   absolute path for Open/Finder, role, size);
 *   • `recovery`  — what `deriveRecoveredWork` needs to recognise a DELIVERABLE:
 *                   identity (id), integrity (sha256) and status, alongside
 *                   role and relative path.
 * 2026-09-11: the page projected only the display fields and handed those to
 * the recovery derivation, which requires a 64-hex sha256 — so no validated
 * final output could ever qualify and the affordance silently never appeared.
 */

export type RunArtifactRow = {
  id?: string | null;
  relative_path?: string | null;
  validated_path?: string | null;
  role?: string | null;
  status?: string | null;
  size_bytes?: number | null;
  sha256?: string | null;
};

export type VerifiedArtifactView = { relativePath: string; validatedPath: string; role: string | null; sizeBytes: number | null };
export type RecoveryArtifactView = { id: string | null; role: string | null; status: string; relative_path: string; sha256: string | null };

/** The exact column list the page must SELECT — a projection cannot recover a column it never read. */
export const RUN_ARTIFACT_COLUMNS = 'id, relative_path, validated_path, role, status, size_bytes, sha256';

export function projectRunArtifacts(rows: unknown, rolePriority: (role: string | null) => number = () => 0): { verified: VerifiedArtifactView[]; recovery: RecoveryArtifactView[] } {
  const list = Array.isArray(rows) ? (rows as RunArtifactRow[]) : [];
  const validated = list.filter((row) => row && typeof row === 'object'
    && typeof row.relative_path === 'string' && typeof row.validated_path === 'string'
    // Only Desktop-VALIDATED rows are ever shown or counted; a declared or
    // rejected row is a claim, never a deliverable.
    && (row.status === undefined || row.status === 'validated'));
  const verified = validated
    .map((row) => ({
      relativePath: row.relative_path as string,
      validatedPath: row.validated_path as string,
      role: typeof row.role === 'string' ? row.role : null,
      sizeBytes: typeof row.size_bytes === 'number' ? row.size_bytes : null,
    }))
    // The delivered file is the user action; receipts and source remain
    // available as evidence but must not bury the actual MP4/document.
    .sort((a, b) => rolePriority(a.role) - rolePriority(b.role) || a.relativePath.localeCompare(b.relativePath));
  const recovery = validated.map((row) => ({
    id: typeof row.id === 'string' ? row.id : null,
    role: typeof row.role === 'string' ? row.role : null,
    status: typeof row.status === 'string' ? row.status : 'validated',
    relative_path: row.relative_path as string,
    sha256: typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256) ? row.sha256 : null,
  }));
  return { verified, recovery };
}
