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
  idempotencyKey?: string;
};

import { isOutcomeQuality } from './outcome-production.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null);

const INPUT_TYPES = new Set(['project_bundle', 'presenter_video', 'image', 'document']);

function inputReferences(v: unknown): Array<{ kind: 'artifact'; id: string; digest: string; description: string; input_type: string; input_session_id: string }> | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 10) return 'At most 10 verified artifacts are supported.';
  const out: Array<{ kind: 'artifact'; id: string; digest: string; description: string; input_type: string; input_session_id: string }> = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'A valid artifact reference is required.';
    const a = raw as Record<string, unknown>;
    const artifactId = id(a.id);
    const description = typeof a.description === 'string' ? a.description.trim() : '';
    if (a.kind !== 'artifact' || !artifactId) return 'Each input must be a verified Desktop artifact.';
    if (typeof a.digest !== 'string' || !SHA256.test(a.digest)) return 'Each input needs a valid SHA-256 digest.';
    if (description.length < 1 || description.length > 300) return 'Each input needs a description of 1–300 characters.';
    if (typeof a.input_type !== 'string' || !INPUT_TYPES.has(a.input_type)) return 'Each input needs a valid input type.';
    const inputSessionId = id(a.input_session_id);
    if (!inputSessionId) return 'Each input must retain its verified Desktop input session.';
    out.push({ kind: 'artifact', id: artifactId, digest: a.digest, description, input_type: a.input_type, input_session_id: inputSessionId });
  }
  return out;
}

export function resolveOutcomeProductionAction(action: string, b: Record<string, unknown>): OutcomeProductionUpstream | string {
  switch (action) {
    case 'prepare': {
      const idempotencyKey = id(b.idempotency_key);
      if (!idempotencyKey) return 'A valid idempotency key is required.';
      const goal = typeof b.goal === 'string' ? b.goal.trim() : '';
      if (goal.length < 8 || goal.length > 2000) return 'Describe the outcome in a sentence or two.';
      if (!isOutcomeQuality(b.quality)) return 'A valid quality is required.';
      if (!Number.isInteger(b.max_budget_credits) || (b.max_budget_credits as number) < 1 || (b.max_budget_credits as number) > 100000) {
        return 'The credit limit must be a whole number from 1 to 100,000.';
      }
      let deadlineAt: string | null = null;
      if (b.deadline_at !== undefined && b.deadline_at !== null && b.deadline_at !== '') {
        if (typeof b.deadline_at !== 'string' || Number.isNaN(Date.parse(b.deadline_at))) return 'A valid deadline is required.';
        deadlineAt = new Date(b.deadline_at).toISOString();
      }
      const ceiling = b.consequential_action_ceiling;
      if (!ceiling || typeof ceiling !== 'object' || Array.isArray(ceiling)) return 'A consequential action ceiling is required.';
      const c = ceiling as Record<string, unknown>;
      if (!Number.isInteger(c.max_provider_calls) || (c.max_provider_calls as number) < 0) return 'A valid provider-call ceiling is required.';
      if (!Number.isInteger(c.max_spend_minor) || (c.max_spend_minor as number) < 0) return 'A valid spend ceiling is required.';
      if (c.currency !== 'USD') return 'The spend ceiling currency must be USD.';
      const refs = inputReferences(b.input_references);
      if (typeof refs === 'string') return refs;
      let clarificationTaskKey: string | undefined;
      if (b.clarification_task_key !== undefined) {
        clarificationTaskKey = typeof b.clarification_task_key === 'string' ? b.clarification_task_key.trim() : '';
        if (!clarificationTaskKey || clarificationTaskKey.length > 200) return 'A valid clarification choice is required.';
      }
      return {
        path: '/api/v2/outcome-productions/prepare', method: 'POST',
        idempotencyKey,
        body: {
          goal, quality: b.quality, deadline_at: deadlineAt,
          max_budget_credits: b.max_budget_credits,
          consequential_action_ceiling: {
            max_provider_calls: c.max_provider_calls,
            max_spend_minor: c.max_spend_minor,
            currency: 'USD',
          },
          input_references: refs,
          ...(clarificationTaskKey ? { clarification_task_key: clarificationTaskKey } : {}),
        },
      };
    }
    case 'start': {
      const productionId = id(b.productionId);
      if (!productionId) return 'A valid productionId is required.';
      if (typeof b.expected_plan_digest !== 'string' || !SHA256.test(b.expected_plan_digest)) return 'A valid expected_plan_digest is required.';
      return {
        path: `/api/v2/outcome-productions/${productionId}/start`, method: 'POST',
        body: { expected_plan_digest: b.expected_plan_digest },
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
