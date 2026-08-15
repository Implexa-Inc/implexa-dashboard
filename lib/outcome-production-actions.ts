/**
 * lib/outcome-production-actions.ts — the outcome-production write-path
 * allowlist.
 *
 * PURE, mirroring lib/generation-proposal-actions.ts: every client action maps
 * to exactly one upstream call with exactly the fields it needs. No
 * passthrough. This is the security boundary of a path that reserves BUDGET
 * under the user's JWT, so the browser's payload is validated here — on the
 * server side of the JWT boundary — before anything reaches the backend.
 */

export type OutcomeProductionUpstream = {
  path: string;
  method: 'GET' | 'POST';
  body: Record<string, unknown> | null;
  /** Forwarded as the Idempotency-Key header. Start only. */
  idempotencyKey?: string;
};

import { isOutcomeQuality } from './outcome-production.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
// The backend's idempotency-key grammar, enforced here too so a malformed key
// fails before it can burn the user's one start attempt on a 400.
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null);

/** Named attachments only — names and sizes travel; bytes and paths do not. */
function attachmentsInput(v: unknown): Array<{ name: string; sizeBytes: number }> | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 10) return 'At most 10 attachments are supported.';
  const out: Array<{ name: string; sizeBytes: number }> = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'A valid attachment is required.';
    const a = raw as Record<string, unknown>;
    const name = typeof a.name === 'string' ? a.name.trim() : '';
    if (name.length < 1 || name.length > 200) return 'Each attachment needs a name of 1–200 characters.';
    if (!Number.isInteger(a.sizeBytes) || (a.sizeBytes as number) < 0) return 'Each attachment needs a valid size.';
    out.push({ name, sizeBytes: a.sizeBytes as number });
  }
  return out;
}

export function resolveOutcomeProductionAction(action: string, b: Record<string, unknown>): OutcomeProductionUpstream | string {
  switch (action) {
    case 'plan': {
      const goal = typeof b.goal === 'string' ? b.goal.trim() : '';
      if (goal.length < 8 || goal.length > 2000) return 'Describe the outcome in a sentence or two.';
      if (!isOutcomeQuality(b.quality)) return 'A valid quality is required.';
      // Minor units, integer, and bounded: one request can never state a
      // budget the MVP would not honor.
      if (!Number.isInteger(b.maxBudgetCents) || (b.maxBudgetCents as number) < 100 || (b.maxBudgetCents as number) > 500000) {
        return 'A maximum budget between $1 and $5,000 is required.';
      }
      let deadline: string | null = null;
      if (b.deadline !== undefined && b.deadline !== null && b.deadline !== '') {
        if (typeof b.deadline !== 'string' || Number.isNaN(Date.parse(b.deadline))) return 'A valid deadline is required.';
        deadline = new Date(b.deadline).toISOString();
      }
      const attachments = attachmentsInput(b.attachments);
      if (typeof attachments === 'string') return attachments;
      return {
        path: '/api/v2/outcome-productions/plan', method: 'POST',
        body: { goal, quality: b.quality, maxBudgetCents: b.maxBudgetCents, deadline, attachments },
      };
    }
    case 'start': {
      const planId = id(b.planId);
      if (!planId) return 'A valid planId is required.';
      // The digest is forwarded VERBATIM. It is the identity of the plan the
      // user saw; recomputing or defaulting it would defeat the backend's
      // stale-plan check.
      if (typeof b.planDigest !== 'string' || !SHA256.test(b.planDigest)) return 'A valid planDigest is required.';
      if (typeof b.idempotencyKey !== 'string' || !IDEMPOTENCY.test(b.idempotencyKey)) return 'A valid idempotencyKey is required.';
      return {
        path: '/api/v2/outcome-productions', method: 'POST',
        body: { planId, planDigest: b.planDigest },
        idempotencyKey: b.idempotencyKey,
      };
    }
    case 'cancel': {
      const productionId = id(b.productionId);
      if (!productionId) return 'A valid productionId is required.';
      return { path: `/api/v2/outcome-productions/${productionId}/cancel`, method: 'POST', body: {} };
    }
    default:
      return 'Unknown action.';
  }
}
