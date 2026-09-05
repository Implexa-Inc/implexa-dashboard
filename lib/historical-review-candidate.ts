/** Public provenance only. Technical QA does not establish editorial completion. */
export type HistoricalReviewCandidate = {
  scope: 'historical_partial_candidate';
  recoveryId: string;
  artifactId: string;
  implementedCount: number;
  deferredCount: number;
  technicalQaStatus: 'pass';
  managerProof: false;
  issueAnchorTransfer: 'not_transferred';
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = ['scope', 'recoveryId', 'artifactId', 'implementedCount', 'deferredCount', 'technicalQaStatus', 'managerProof', 'issueAnchorTransfer'];
export function parseHistoricalCandidates(raw: unknown, source: unknown, artifacts: Array<{ id: string; role: string | null; status: string | null }>): HistoricalReviewCandidate[] | null {
  // Older backends do not report this feature. An explicit unavailable source
  // never carries seemingly authoritative candidate rows.
  if (raw === undefined && source === undefined) return [];
  if (!['ready', 'unavailable', 'disabled'].includes(String(source)) || !Array.isArray(raw)) return null;
  if (source !== 'ready') return raw.length === 0 ? [] : null;
  const ids = new Set<string>();
  const recoveries = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== KEYS.length || !KEYS.every((key) => key in value)) return null;
    const c = value as HistoricalReviewCandidate;
    if (c.scope !== 'historical_partial_candidate' || !UUID.test(c.recoveryId) || !UUID.test(c.artifactId)
      || !Number.isInteger(c.implementedCount) || c.implementedCount < 1
      || !Number.isInteger(c.deferredCount) || c.deferredCount < 1 || c.implementedCount + c.deferredCount > 100
      || c.technicalQaStatus !== 'pass' || c.managerProof !== false || c.issueAnchorTransfer !== 'not_transferred'
      || ids.has(c.artifactId) || recoveries.has(c.recoveryId)
      || !artifacts.some((a) => a.id === c.artifactId && a.role === 'other' && a.status === 'validated')) return null;
    ids.add(c.artifactId); recoveries.add(c.recoveryId);
  }
  return raw as HistoricalReviewCandidate[];
}
