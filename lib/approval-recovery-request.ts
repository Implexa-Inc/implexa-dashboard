import { createHash } from 'node:crypto';

/**
 * Cross-repo identity for the one permitted historical approval recovery.
 * Backend owns creation and validates every authority; Dashboard uses the same
 * deterministic id only to suppress the already-consumed one-shot action.
 */
export function approvalRecoveryRequestId(runId: string): string {
  const hex = createHash('sha256')
    .update(`approval-continuation-recovery.v1:${runId}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
