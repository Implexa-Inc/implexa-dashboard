/**
 * lib/generation-proposal-actions.ts — the proposal write-path allowlist.
 *
 * PURE, mirroring lib/review-actions.ts: every client action maps to exactly one
 * upstream call with exactly the fields it needs. No passthrough. This is the
 * security boundary of a path that authorizes PAID work under the user's JWT.
 */

export type ProposalUpstream = {
  path: string;
  method: 'POST';
  body: Record<string, unknown>;
  /** Forwarded as the Idempotency-Key header. Approve only. */
  idempotencyKey?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
// The backend's own idempotency-key grammar. Enforced here too, so a malformed
// key fails before it can burn the user's one approval attempt on a 400.
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null);

export function resolveProposalAction(action: string, b: Record<string, unknown>): ProposalUpstream | string {
  switch (action) {
    case 'approve': {
      const proposalId = id(b.proposalId);
      if (!proposalId) return 'A valid proposalId is required.';
      // The version/digest pair is forwarded VERBATIM. It is the identity of what
      // the user saw; recomputing or defaulting either would defeat the backend's
      // stale-approval check.
      if (typeof b.proposalVersion !== 'string' || !b.proposalVersion) return 'A proposalVersion is required.';
      if (typeof b.proposalDigest !== 'string' || !SHA256.test(b.proposalDigest)) return 'A valid proposalDigest is required.';
      if (typeof b.idempotencyKey !== 'string' || !IDEMPOTENCY.test(b.idempotencyKey)) return 'A valid idempotencyKey is required.';
      return {
        path: `/api/v2/generation-proposals/${proposalId}/approve`, method: 'POST',
        body: { proposalVersion: b.proposalVersion, proposalDigest: b.proposalDigest },
        idempotencyKey: b.idempotencyKey,
      };
    }
    case 'cancel': {
      const proposalId = id(b.proposalId);
      if (!proposalId) return 'A valid proposalId is required.';
      return { path: `/api/v2/generation-proposals/${proposalId}/cancel`, method: 'POST', body: {} };
    }
    default:
      return 'Unknown action.';
  }
}
