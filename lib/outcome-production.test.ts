import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };
import {
  canStartPlan, parsePlanResponse, parseProductionListResponse, parseProductionResponse,
  parseReceiptResponse, shouldPollProduction, suggestOutcomeInputType,
} from './outcome-production.ts';

const PRODUCTION_ID = '00000040-0000-4000-8000-000000000040';
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const ARTIFACT_ID = '77777777-7777-4777-8777-777777777777';
const INPUT_SESSION_ID = '88888888-8888-4888-8888-888888888888';
const DIGEST = 'a'.repeat(64);
const intent = {
  goal: 'Produce a final master from the attached editable project.', quality: 'balanced', deadline_at: null,
  max_budget_credits: 100,
  consequential_action_ceiling: { max_provider_calls: 0, max_spend_minor: 0, currency: 'USD' },
  input_references: [{ kind: 'artifact', id: ARTIFACT_ID, digest: DIGEST, description: 'project.zip', input_type: 'project_bundle', input_session_id: INPUT_SESSION_ID }],
};
const plan = {
  digest: DIGEST, contract_version: 'outcome-production-plan.v1', scorer_version: 'outcome-scorer-v1',
  weight_set_digest: 'b'.repeat(64), intent_digest: 'c'.repeat(64), quality: 'balanced', deadline_at: null,
  nodes: [{ ordinal: 0, role: 'produce_outcome', workflow_id: WORKFLOW_ID, workflow_version_id: VERSION_ID, slug: 'final-video-compositor', budget_credits: 100, max_duration_ms: 3600000, max_retries: 1, max_invocations: 1000 }],
  budget: { max_budget_credits: 100, allocations: [{ ordinal: 0, budget_credits: 100 }] },
  unresolved_missing_assets: [],
  stop_conditions: { max_nodes: 2, sequential_only: true, on_child_failure: 'stop_with_typed_failure', on_budget_exhausted: 'stop_with_typed_failure', on_cancel: 'release_and_cancel_children' },
};

test('prepare plan preserves Backend production and digest identities', () => {
  const outcome = parsePlanResponse({ ok: true, kind: 'plan', productionId: PRODUCTION_ID, intent, plan });
  assert.ok(outcome && outcome.kind === 'plan');
  assert.equal(outcome.productionId, PRODUCTION_ID);
  assert.equal(outcome.plan.digest, DIGEST);
  assert.equal(outcome.plan.nodes[0].slug, 'final-video-compositor');
  assert.equal(canStartPlan(outcome.plan), true);
});

test('clarification, no-match, and existing no-eligible outcomes are distinct', () => {
  const clarification = parsePlanResponse({ ok: true, kind: 'clarification_required', clarification: { question: 'Which outcome?', choices: [{ taskKey: 'video', label: 'Final video', outputTypes: ['video'] }] } });
  assert.ok(clarification && clarification.kind === 'clarification_required');
  assert.equal(clarification.clarification.choices[0].taskKey, 'video');
  assert.equal('recommended' in clarification.clarification, false);

  const noMatch = parsePlanResponse({ ok: true, kind: 'no_match', reason: 'unsupported_goal', message: 'No outcome type matched.' });
  assert.ok(noMatch && noMatch.kind === 'no_match');

  const needsInput = parsePlanResponse({ ok: true, kind: 'needs_input', taskKey: 'video.final_master', question: 'Add the project bundle.', missingInputTypes: ['project_bundle'] });
  assert.ok(needsInput && needsInput.kind === 'needs_input');
  assert.deepEqual(needsInput.missingInputTypes, ['project_bundle']);

  const old = fixture.responses.prepare.no_eligible.noEligible;
  const noEligible = parsePlanResponse({ ok: true, kind: 'no_eligible', ...old });
  assert.ok(noEligible && noEligible.kind === 'no_eligible');
});

test('prepare responses fail closed on identity and nested-plan drift', () => {
  assert.equal(parsePlanResponse(null), null);
  assert.equal(parsePlanResponse({ ok: true, kind: 'surprise' }), null);
  assert.equal(parsePlanResponse({ ok: true, kind: 'plan', productionId: 'browser-id', intent, plan }), null);
  assert.equal(parsePlanResponse({ ok: true, kind: 'plan', productionId: PRODUCTION_ID, intent, plan: { ...plan, digest: 'short' } }), null);
  assert.equal(parsePlanResponse({ ok: true, kind: 'plan', productionId: PRODUCTION_ID, intent: { ...intent, consequential_action_ceiling: { ...intent.consequential_action_ceiling, currency: 'EUR' } }, plan }), null);
  assert.equal(parsePlanResponse({ ok: true, kind: 'clarification_required', clarification: { question: 'Which?', choices: [] } }), null);
});

test('a plan with an unresolved asset is inspectable but not startable', () => {
  const outcome = parsePlanResponse({ ok: true, kind: 'plan', productionId: PRODUCTION_ID, intent, plan: { ...plan, unresolved_missing_assets: [{ kind: 'video', description: 'Presenter video' }] } });
  assert.ok(outcome && outcome.kind === 'plan');
  assert.equal(canStartPlan(outcome.plan), false);
});

test('input type suggestions are deterministic and correction vocabulary is bounded', () => {
  assert.equal(suggestOutcomeInputType('project-bundle.zip', 'application/octet-stream'), 'project_bundle');
  assert.equal(suggestOutcomeInputType('talk.MOV', 'application/octet-stream'), 'presenter_video');
  assert.equal(suggestOutcomeInputType('photo.bin', 'image/png'), 'image');
  assert.equal(suggestOutcomeInputType('brief.pdf', 'application/pdf'), 'document');
});

test('existing production, list, and receipt readers remain fail closed', () => {
  const running = parseProductionResponse(fixture.responses.statusRunning);
  assert.ok(running && running.children.length === 2);
  assert.equal(shouldPollProduction(running), true);
  assert.equal(shouldPollProduction(parseProductionResponse(fixture.responses.statusCompleted)!), false);
  assert.ok(parseProductionListResponse(fixture.responses.list));
  assert.ok(parseReceiptResponse(fixture.responses.receiptSuccess));

  const driftedProduction = structuredClone(fixture.responses.statusRunning);
  delete (driftedProduction.production.children[0] as Record<string, unknown>).spentCredits;
  assert.equal(parseProductionResponse(driftedProduction), null);
  const driftedReceipt = structuredClone(fixture.responses.receiptSuccess);
  (driftedReceipt.receipt.outcome as Record<string, unknown>).type = 'great';
  assert.equal(parseReceiptResponse(driftedReceipt), null);
});
