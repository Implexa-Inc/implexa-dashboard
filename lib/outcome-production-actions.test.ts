// node --test lib/outcome-production-actions.test.ts
//
// The write-path allowlist for outcome productions. These pin the security
// boundary: exactly three actions, each mapped to one upstream call with
// exactly the validated fields it needs, and the plan identity (id + digest)
// forwarded VERBATIM so the backend's stale-plan check keeps its teeth.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOutcomeProductionAction } from './outcome-production-actions.ts';

const PLAN_ID = '00000040-0000-4000-8000-000000000040';
const DIGEST = 'a'.repeat(64);
const KEY = 'start-1234-abcd';

const validPlan = {
  goal: 'Produce a final master from my approved sections.',
  quality: 'best',
  maxBudgetCents: 4000,
  deadline: null,
  attachments: [{ name: 'project.zip', sizeBytes: 1024 }],
};

test('plan maps to the plan endpoint with only the contracted fields', () => {
  const target = resolveOutcomeProductionAction('plan', { ...validPlan, extra: 'never-forwarded' });
  assert.ok(typeof target !== 'string', String(target));
  assert.equal(target.path, '/api/v2/outcome-productions/plan');
  assert.equal(target.method, 'POST');
  assert.deepEqual(Object.keys(target.body!).sort(), ['attachments', 'deadline', 'goal', 'maxBudgetCents', 'quality']);
});

test('plan refuses a goal that is too short or absent', () => {
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, goal: 'hi' }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, goal: undefined }), 'string');
});

test('plan refuses an off-contract quality and an out-of-bounds budget', () => {
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, quality: 'ultra' }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, maxBudgetCents: 50 }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, maxBudgetCents: 500001 }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, maxBudgetCents: 40.5 }), 'string');
});

test('plan refuses malformed deadlines and oversized attachment lists', () => {
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, deadline: 'not-a-date' }), 'string');
  const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}`, sizeBytes: 1 }));
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, attachments: eleven }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, attachments: [{ name: '', sizeBytes: 1 }] }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('plan', { ...validPlan, attachments: [{ name: 'f', sizeBytes: -1 }] }), 'string');
});

test('a valid deadline is normalized to ISO; a missing one travels as null', () => {
  const target = resolveOutcomeProductionAction('plan', { ...validPlan, deadline: '2026-08-20T10:00' });
  assert.ok(typeof target !== 'string');
  assert.equal(typeof target.body!.deadline, 'string');
  assert.ok(!Number.isNaN(Date.parse(target.body!.deadline as string)));
  const none = resolveOutcomeProductionAction('plan', { ...validPlan, deadline: '' });
  assert.ok(typeof none !== 'string');
  assert.equal(none.body!.deadline, null);
});

test('start forwards the plan identity verbatim, with the idempotency key as a header', () => {
  const target = resolveOutcomeProductionAction('start', { planId: PLAN_ID, planDigest: DIGEST, idempotencyKey: KEY });
  assert.ok(typeof target !== 'string', String(target));
  assert.equal(target.path, '/api/v2/outcome-productions');
  assert.deepEqual(target.body, { planId: PLAN_ID, planDigest: DIGEST });
  assert.equal(target.idempotencyKey, KEY);
});

test('start refuses a missing or malformed plan identity — it never defaults one', () => {
  assert.equal(typeof resolveOutcomeProductionAction('start', { planDigest: DIGEST, idempotencyKey: KEY }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('start', { planId: 'not-a-uuid', planDigest: DIGEST, idempotencyKey: KEY }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('start', { planId: PLAN_ID, planDigest: 'short', idempotencyKey: KEY }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('start', { planId: PLAN_ID, planDigest: DIGEST, idempotencyKey: 'x' }), 'string');
});

test('cancel maps to the one cancel endpoint for a valid production id only', () => {
  const target = resolveOutcomeProductionAction('cancel', { productionId: PLAN_ID });
  assert.ok(typeof target !== 'string');
  assert.equal(target.path, `/api/v2/outcome-productions/${PLAN_ID}/cancel`);
  assert.equal(typeof resolveOutcomeProductionAction('cancel', { productionId: 'nope' }), 'string');
});

test('unknown actions are refused — no passthrough exists', () => {
  assert.equal(typeof resolveOutcomeProductionAction('receipt', {}), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('', {}), 'string');
});
