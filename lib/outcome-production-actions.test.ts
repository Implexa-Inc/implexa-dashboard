import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOutcomeProductionAction } from './outcome-production-actions.ts';

const PRODUCTION_ID = '00000040-0000-4000-8000-000000000040';
const ARTIFACT_ID = '00000070-0000-4000-8000-000000000070';
const INPUT_SESSION_ID = '00000080-0000-4000-8000-000000000080';
const IDEMPOTENCY_KEY = '00000090-0000-4000-8000-000000000090';
const DIGEST = 'a'.repeat(64);
const validPrepare = {
  idempotency_key: IDEMPOTENCY_KEY,
  goal: 'Produce a final master from my approved sections.', quality: 'best', deadline_at: null,
  max_budget_credits: 100,
  consequential_action_ceiling: { max_provider_calls: 0, max_spend_minor: 0, currency: 'USD' },
  input_references: [{ kind: 'artifact', id: ARTIFACT_ID, digest: DIGEST, description: 'project.zip', input_type: 'project_bundle', input_session_id: INPUT_SESSION_ID }],
};

test('prepare maps only the Backend-owned wire fields', () => {
  const target = resolveOutcomeProductionAction('prepare', { ...validPrepare, extra: 'never-forwarded' });
  assert.ok(typeof target !== 'string', String(target));
  assert.equal(target.path, '/api/v2/outcome-productions/prepare');
  assert.equal(target.idempotencyKey, IDEMPOTENCY_KEY);
  const { idempotency_key: _discarded, ...expectedBody } = validPrepare;
  assert.deepEqual(target.body, expectedBody);
});

test('prepare forwards one clarification task key and does not invent a recommendation', () => {
  const target = resolveOutcomeProductionAction('prepare', { ...validPrepare, clarification_task_key: 'final_video' });
  assert.ok(typeof target !== 'string');
  assert.equal(target.body!.clarification_task_key, 'final_video');
  assert.equal('recommended' in target.body!, false);
});

test('prepare forwards bounded run instructions separately from the routing goal', () => {
  const target = resolveOutcomeProductionAction('prepare', {
    ...validPrepare, run_instructions: '  Keep the final video 16:9.  ',
  });
  assert.ok(typeof target !== 'string', String(target));
  assert.equal(target.body!.goal, validPrepare.goal);
  assert.equal(target.body!.run_instructions, 'Keep the final video 16:9.');
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, run_instructions: '' }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, run_instructions: 'x'.repeat(2001) }), 'string');
});

test('prepare requires a positive credit ceiling while allowing zero consequential spend', () => {
  const target = resolveOutcomeProductionAction('prepare', {
    ...validPrepare, max_budget_credits: 1,
    consequential_action_ceiling: { max_provider_calls: 0, max_spend_minor: 0, currency: 'USD' },
  });
  assert.ok(typeof target !== 'string', String(target));
  assert.equal(target.body!.max_budget_credits, 1);
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, max_budget_credits: 0 }), 'string');
});

test('prepare refuses malformed goals, ceilings, deadlines, and artifact identities', () => {
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, goal: 'short' }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, quality: 'ultra' }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, max_budget_credits: 1.5 }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, deadline_at: 'not-a-date' }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, consequential_action_ceiling: { max_provider_calls: 0, max_spend_minor: 0, currency: 'EUR' } }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, input_references: [{ name: 'filename-only.zip', sizeBytes: 10 }] }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, input_references: [{ ...validPrepare.input_references[0], digest: 'short' }] }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('prepare', { ...validPrepare, input_references: Array.from({ length: 11 }, () => validPrepare.input_references[0]) }), 'string');
});

test('deadline is normalized and verified input metadata is narrowed', () => {
  const target = resolveOutcomeProductionAction('prepare', {
    ...validPrepare, deadline_at: '2026-08-20T10:00',
    input_references: [{ ...validPrepare.input_references[0], displayName: 'local.zip', inputSessionId: 'not-forwarded' }],
  });
  assert.ok(typeof target !== 'string');
  assert.ok(!Number.isNaN(Date.parse(target.body!.deadline_at as string)));
  assert.deepEqual(Object.keys((target.body!.input_references as Record<string, unknown>[])[0]).sort(), ['description', 'digest', 'id', 'input_session_id', 'input_type', 'kind']);
});

test('start uses the Backend production id and expected digest only', () => {
  const target = resolveOutcomeProductionAction('start', { productionId: PRODUCTION_ID, expected_plan_digest: DIGEST, planId: crypto.randomUUID() });
  assert.ok(typeof target !== 'string', String(target));
  assert.equal(target.path, `/api/v2/outcome-productions/${PRODUCTION_ID}/start`);
  assert.deepEqual(target.body, { expected_plan_digest: DIGEST });
});

test('start, cancel, and reconcile reject malformed production identity', () => {
  assert.equal(typeof resolveOutcomeProductionAction('start', { productionId: 'browser-made', expected_plan_digest: DIGEST }), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('start', { productionId: PRODUCTION_ID, expected_plan_digest: 'short' }), 'string');
  const cancel = resolveOutcomeProductionAction('cancel', { productionId: PRODUCTION_ID });
  assert.ok(typeof cancel !== 'string');
  assert.equal(cancel.path, `/api/v2/outcome-productions/${PRODUCTION_ID}/cancel`);
  const reconcile = resolveOutcomeProductionAction('reconcile', { productionId: PRODUCTION_ID });
  assert.ok(typeof reconcile !== 'string');
  assert.deepEqual(reconcile, {
    path: `/api/v2/outcome-productions/${PRODUCTION_ID}/reconcile`, method: 'POST', body: {},
  });
  assert.equal(typeof resolveOutcomeProductionAction('reconcile', { productionId: 'browser-made' }), 'string');
});

test('old and unknown actions are refused', () => {
  assert.equal(typeof resolveOutcomeProductionAction('plan', validPrepare), 'string');
  assert.equal(typeof resolveOutcomeProductionAction('', {}), 'string');
});
