export type ProjectBundleRefusal = { title: string; details: string[] };
export function projectBundleRefusal(error: unknown): ProjectBundleRefusal | null {
  const body = error && typeof error === 'object' && 'body' in error ? error.body : error;
  if (!body || typeof body !== 'object' || (body as any).reason !== 'project_bundle_contract_incompatible') return null;
  const remediation = (body as any).remediation;
  const details: string[] = [];
  if (remediation?.contractVersion === 'project-bundle-remediation.v1' && Array.isArray(remediation.issues)) {
    for (const issue of remediation.issues.slice(0, 100)) {
      if (issue?.code === 'timeline_slot_too_short' && Number.isSafeInteger(issue.index) && issue.index >= 0
          && Number.isSafeInteger(issue.actualFrames) && issue.actualFrames > 0
          && Number.isSafeInteger(issue.requiredMinFrames) && issue.requiredMinFrames > 0) {
        details.push(`Range ${issue.index + 1}: ${issue.actualFrames} frames; at least ${issue.requiredMinFrames} frames required.`);
      } else if (issue?.code === 'planned_asset_identity_mismatch') {
        details.push('A planned asset is missing its matching output destination.');
      }
    }
  }
  if (!details.length) details.push('The export needs an explicit timing contract and verified planned-asset destinations.');
  return { title: 'Project bundle needs an updated Planner export', details };
}
