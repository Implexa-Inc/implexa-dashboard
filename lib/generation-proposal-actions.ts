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

import {
  BOUNDS, CONTROL_V2, JUDGE_MODES, JUDGE_MODES_ALLOWING_REPAIR, SUPPORTED_RATIOS,
} from './professional-v2-contract.ts';

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

/**
 * The Professional v2 write input — a MULTI-moment timeline, and the only place
 * a browser payload becomes a v2 request.
 *
 * `controlContractVersion` is written here as an EXPLICIT literal. It is never
 * copied from the client body and never inferred from the fact that the moments
 * happen to carry `judge_mode` or `variants_requested`: a request whose shape
 * looks like v2 is still a v1 request unless it says v2, and letting the browser
 * choose the discriminator would let a forged payload reach the wider compiler
 * path (more tasks, more variants, judge-off moments) without declaring it.
 *
 * Every bound below is the deployed backend's, mirrored from the probed contract
 * so a plan the compiler would refuse is refused here first — on the server side
 * of the JWT boundary, not only in the editor a browser could bypass.
 */
function professionalV2Input(b: Record<string, unknown>): Record<string, unknown> | string {
  const agentSubject = typeof b.agentSubject === 'string' ? b.agentSubject.trim() : '';
  const sourceRunId = id(b.sourceRunId);
  if (!AGENT.test(agentSubject)) return 'A valid agentSubject is required.';
  if (!sourceRunId) return 'A valid sourceRunId is required.';
  if (!Array.isArray(b.moments) || b.moments.length < 1 || b.moments.length > BOUNDS.maxMoments) {
    return `A Professional timeline carries 1–${BOUNDS.maxMoments} moments.`;
  }

  const moments: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let totalTasks = 0;
  let previousEnd: number | null = null;
  let previousStart: number | null = null;

  for (const raw of b.moments) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'A valid B-roll moment is required.';
    const m = raw as Record<string, unknown>;
    const momentId = typeof m.id === 'string' ? m.id.trim() : '';
    const prompt = typeof m.prompt === 'string' ? m.prompt.trim() : '';
    const start = m.startSeconds;
    const end = m.endSeconds;
    const ratio = typeof m.ratio === 'string' ? m.ratio : '';
    const variants = m.variantsRequested;
    const judgeMode = typeof m.judgeMode === 'string' ? m.judgeMode : '';
    const maxRepairs = m.maxRepairs;

    if (!MOMENT.test(momentId) || seen.has(momentId)) return 'Each moment needs its own valid id.';
    seen.add(momentId);
    if (prompt.length < 1 || prompt.length > BOUNDS.promptMaxChars) {
      return `Each moment needs a description of 1–${BOUNDS.promptMaxChars} characters.`;
    }
    if (typeof start !== 'number' || typeof end !== 'number'
      || !Number.isFinite(start) || !Number.isFinite(end)
      || !Number.isInteger(start * 1000) || !Number.isInteger(end * 1000)
      || start < 0 || end <= start
      || end - start < BOUNDS.minDurationSeconds || end - start > BOUNDS.maxDurationSeconds) {
      return `Each moment must be a ${BOUNDS.minDurationSeconds}–${BOUNDS.maxDurationSeconds} second window.`;
    }
    if (!SUPPORTED_RATIOS.includes(ratio)) return 'That aspect ratio is not supported.';
    if (!Number.isInteger(variants)
      || (variants as number) < BOUNDS.minVariantsPerMoment
      || (variants as number) > BOUNDS.maxVariantsPerMoment) {
      return `Each moment requests ${BOUNDS.minVariantsPerMoment}–${BOUNDS.maxVariantsPerMoment} variants.`;
    }
    if (!(JUDGE_MODES as readonly string[]).includes(judgeMode)) return 'That Judge mode is not supported.';
    if (!Number.isInteger(maxRepairs)
      || (maxRepairs as number) < 0 || (maxRepairs as number) > BOUNDS.maxRepairsPerMoment) {
      return `The repair reserve is 0–${BOUNDS.maxRepairsPerMoment} per moment.`;
    }
    // Contingent credits nothing could release are money authorized for work
    // nothing can legitimately spend.
    if ((maxRepairs as number) > 0 && !(JUDGE_MODES_ALLOWING_REPAIR as readonly string[]).includes(judgeMode)) {
      return 'A repair reserve requires a Judge; with judging off nothing could release it.';
    }
    // Ascending and non-overlapping, read in array order exactly as the compiler
    // reads it. Abutting stays valid.
    if (previousStart !== null && start < previousStart) return 'Moments must run in time order.';
    if (previousEnd !== null && start < previousEnd) return 'Moments may touch, but they may not overlap.';
    previousStart = start;
    previousEnd = end;
    totalTasks += (variants as number) + (maxRepairs as number);

    moments.push({
      id: momentId, prompt, start_seconds: start, end_seconds: end, ratio,
      variants_requested: variants, judge_mode: judgeMode, max_repairs: maxRepairs,
    });
  }

  if (totalTasks > BOUNDS.maxTotalTasks) {
    return `This plan authorizes ${totalTasks} generations; one approval covers at most ${BOUNDS.maxTotalTasks}.`;
  }

  return {
    capabilityKey: 'video.generate_broll',
    qualityMode: 'professional',
    // EXPLICIT, and written from the pinned constant — never echoed from `b`.
    controlContractVersion: CONTROL_V2,
    agentSubject, sourceRunId, moments,
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
    case 'preview-professional-v2':
    case 'create-professional-v2': {
      const body = professionalV2Input(b);
      if (typeof body === 'string') return body;
      return {
        path: action === 'preview-professional-v2'
          ? '/api/v2/generation-proposals/preview' : '/api/v2/generation-proposals',
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
