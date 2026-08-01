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
const AGENT = /^[a-z0-9][a-z0-9-]{1,119}$/;
const MOMENT = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MODES = new Set(['fast', 'professional', 'production']);

const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null);

function generationInput(b: Record<string, unknown>): Record<string, unknown> | string {
  const agentSubject = typeof b.agentSubject === 'string' ? b.agentSubject.trim() : '';
  const sourceRunId = id(b.sourceRunId);
  const qualityMode = typeof b.qualityMode === 'string' ? b.qualityMode : '';
  if (!AGENT.test(agentSubject)) return 'A valid agentSubject is required.';
  if (!sourceRunId) return 'A valid sourceRunId is required.';
  if (!MODES.has(qualityMode)) return 'A valid qualityMode is required.';
  // Wave 1's founder smoke is intentionally one bounded moment. A future
  // multi-moment composer must widen this contract deliberately, not by passing
  // an arbitrary browser array through to the paid compiler.
  if (!Array.isArray(b.moments) || b.moments.length !== 1) return 'Exactly one B-roll moment is required.';
  const raw = b.moments[0];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'A valid B-roll moment is required.';
  const m = raw as Record<string, unknown>;
  const momentId = typeof m.id === 'string' ? m.id.trim() : '';
  const prompt = typeof m.prompt === 'string' ? m.prompt.trim() : '';
  const start = m.startSeconds;
  const end = m.endSeconds;
  if (!MOMENT.test(momentId) || prompt.length < 1 || prompt.length > 700
    || typeof start !== 'number' || typeof end !== 'number'
    || !Number.isFinite(start) || !Number.isFinite(end)
    || !Number.isInteger(start * 1000) || !Number.isInteger(end * 1000)
    || start < 0 || end <= start || end - start < 2 || end - start > 10) {
    return 'A valid 2–10 second B-roll moment is required.';
  }
  return {
    capabilityKey: 'video.generate_broll', qualityMode, agentSubject, sourceRunId,
    moments: [{ id: momentId, prompt, start_seconds: start, end_seconds: end, ratio: '720:1280' }],
  };
}

export function resolveProposalAction(action: string, b: Record<string, unknown>): ProposalUpstream | string {
  switch (action) {
    case 'preview':
    case 'create': {
      const body = generationInput(b);
      if (typeof body === 'string') return body;
      return {
        path: action === 'preview' ? '/api/v2/generation-proposals/preview' : '/api/v2/generation-proposals',
        method: 'POST', body,
      };
    }
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
