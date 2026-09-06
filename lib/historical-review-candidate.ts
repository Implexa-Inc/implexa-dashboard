/** Public provenance only. Technical QA does not establish editorial completion. */
type HistoricalReviewCandidateBase = {
  recoveryId: string;
  artifactId: string;
  technicalQaStatus: 'pass';
  managerProof: false;
  issueAnchorTransfer: 'not_transferred';
};

export type HistoricalPartialReviewCandidate = HistoricalReviewCandidateBase & {
  scope: 'historical_partial_candidate';
  implementedCount: number;
  deferredCount: number;
};

export type HistoricalUnverifiedReviewCandidate = HistoricalReviewCandidateBase & {
  scope: 'historical_unverified_candidate';
  implementedCount: 0;
  deferredCount: 0;
  /** Count only. The private issue identities do not belong in this projection. */
  unresolvedCount: number;
};

export type HistoricalReviewCandidate = HistoricalPartialReviewCandidate | HistoricalUnverifiedReviewCandidate;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMON_KEYS = ['scope', 'recoveryId', 'artifactId', 'implementedCount', 'deferredCount', 'technicalQaStatus', 'managerProof', 'issueAnchorTransfer'];
const PARTIAL_KEYS = COMMON_KEYS;
const UNVERIFIED_KEYS = [...COMMON_KEYS, 'unresolvedCount'];
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => key in value);
export function parseHistoricalCandidates(raw: unknown, source: unknown, artifacts: Array<{ id: string; role: string | null; status: string | null }>): HistoricalReviewCandidate[] | null {
  // Older backends do not report this feature. An explicit unavailable source
  // never carries seemingly authoritative candidate rows.
  if (raw === undefined && source === undefined) return [];
  if (!['ready', 'unavailable', 'disabled'].includes(String(source)) || !Array.isArray(raw)) return null;
  if (source !== 'ready') return raw.length === 0 ? [] : null;
  const ids = new Set<string>();
  const recoveries = new Set<string>();
  const parsed: HistoricalReviewCandidate[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.scope === 'historical_partial_candidate') {
      if (!exactKeys(record, PARTIAL_KEYS)
        || !Number.isInteger(record.implementedCount) || Number(record.implementedCount) < 1
        || !Number.isInteger(record.deferredCount) || Number(record.deferredCount) < 1
        || Number(record.implementedCount) + Number(record.deferredCount) > 100) return null;
    } else if (record.scope === 'historical_unverified_candidate') {
      if (!exactKeys(record, UNVERIFIED_KEYS)
        || record.implementedCount !== 0 || record.deferredCount !== 0
        || !Number.isInteger(record.unresolvedCount) || Number(record.unresolvedCount) < 1
        || Number(record.unresolvedCount) > 100) return null;
    } else return null;
    const c = record as unknown as HistoricalReviewCandidate;
    if (!UUID.test(c.recoveryId) || !UUID.test(c.artifactId)
      || c.technicalQaStatus !== 'pass' || c.managerProof !== false || c.issueAnchorTransfer !== 'not_transferred'
      || ids.has(c.artifactId) || recoveries.has(c.recoveryId)
      || !artifacts.some((a) => a.id === c.artifactId && a.role === 'other' && a.status === 'validated')) return null;
    ids.add(c.artifactId); recoveries.add(c.recoveryId);
    parsed.push(c);
  }
  return parsed;
}
