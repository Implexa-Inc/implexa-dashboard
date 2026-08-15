// node --test lib/outcome-production.test.ts
//
// The outcome-production contract boundary. Everything here consumes the
// BACKEND-GENERATED fixture (test-fixtures/generated/outcome-orchestration.json)
// verbatim — the producer owns the wire shapes — and then proves the parsers
// fail CLOSED on drift: a body that no longer matches the contract must come
// back `null`, never a best-effort object the UI would confidently render.

import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };
import {
  canStartPlan, formatMinor, formatMinorRange,
  parsePlanResponse, parseProductionResponse, parseReceiptResponse,
} from './outcome-production.ts';

test('the fixture is the producer’s: schema stamp and producer path are pinned', () => {
  assert.equal(fixture.schema, 'implexa.outcome-orchestration.fixture.v1');
  assert.equal(fixture.producer, 'implexa-backend/scripts/generate-outcome-orchestration-dashboard-fixture.js');
});

test('a prepared single-agent plan parses and is startable', () => {
  const outcome = parsePlanResponse(fixture.responses.planPrepared);
  assert.ok(outcome && outcome.kind === 'plan');
  assert.equal(outcome.plan.nodes.length, 1);
  assert.equal(outcome.plan.nodes[0].agentName, 'Cinematic compositor');
  assert.ok(outcome.plan.nodes[0].reasons.length >= 1, 'every selection carries its reasons');
  assert.equal(outcome.plan.state, 'prepared');
  assert.equal(canStartPlan(outcome.plan), true);
  assert.equal(outcome.plan.digest, fixture.plans.single.digest, 'the digest is preserved verbatim for Start');
});

test('a two-node plan parses with both agents in order; three nodes is off-contract', () => {
  const outcome = parsePlanResponse(fixture.responses.planTwoNode);
  assert.ok(outcome && outcome.kind === 'plan');
  assert.deepEqual(outcome.plan.nodes.map((n) => n.order), [1, 2]);

  const inflated = structuredClone(fixture.responses.planTwoNode);
  inflated.plan.nodes.push(structuredClone(inflated.plan.nodes[1]));
  assert.equal(parsePlanResponse(inflated), null, 'the MVP contract is at most two nodes — more must not render');
});

test('a plan blocked on setup parses but is NOT startable', () => {
  const outcome = parsePlanResponse(fixture.responses.planBlockedOnSetup);
  assert.ok(outcome && outcome.kind === 'plan');
  assert.equal(outcome.plan.state, 'blocked_on_setup');
  assert.ok(outcome.plan.missingSetup.length >= 1);
  assert.equal(canStartPlan(outcome.plan), false);
});

test('no-eligible is an explicit contracted answer, not a parse failure', () => {
  const outcome = parsePlanResponse(fixture.responses.planNoEligible);
  assert.ok(outcome && outcome.kind === 'no_eligible');
  assert.equal(outcome.noEligible.reasonCode, 'no_eligible_candidate');
  assert.ok(outcome.noEligible.exclusions.length >= 1, 'exclusions carry their reasons');
});

test('plan responses fail closed on drift', () => {
  assert.equal(parsePlanResponse(null), null);
  assert.equal(parsePlanResponse({}), null);
  assert.equal(parsePlanResponse({ ok: true }), null, 'an envelope without a typed result is unreadable');
  assert.equal(parsePlanResponse({ ok: true, result: 'surprise' }), null, 'an unknown result kind is unreadable, not empty');

  const noDigest = structuredClone(fixture.responses.planPrepared);
  delete (noDigest.plan as Record<string, unknown>).digest;
  assert.equal(parsePlanResponse(noDigest), null, 'a plan without its digest has no identity to start');

  const noReasons = structuredClone(fixture.responses.planPrepared);
  (noReasons.plan.nodes[0] as Record<string, unknown>).reasons = [];
  assert.equal(parsePlanResponse(noReasons), null, 'a selection with no reasons is not inspectable and must not render');

  const noScorer = structuredClone(fixture.responses.planPrepared);
  delete (noScorer.plan as Record<string, unknown>).scorerVersion;
  assert.equal(parsePlanResponse(noScorer), null, 'an unversioned scorer output is not evidence');

  const notOk = structuredClone(fixture.responses.planPrepared);
  (notOk as Record<string, unknown>).ok = false;
  assert.equal(parsePlanResponse(notOk), null);

  const badApproval = structuredClone(fixture.responses.planPrepared);
  delete (badApproval.plan.approvals[0] as Record<string, unknown>).ceilingCents;
  assert.equal(parsePlanResponse(badApproval), null, 'an approval without its ceiling cannot be acknowledged');
});

test('production status parses parent-first fields and children', () => {
  const production = parseProductionResponse(fixture.responses.statusRunning);
  assert.ok(production);
  assert.equal(production.id, fixture.productions.running.id);
  assert.equal(production.children.length, 2);
  assert.equal(production.canCancel, true);
  assert.equal(production.budget.currency, 'USD');

  const done = parseProductionResponse(fixture.responses.statusCompleted);
  assert.ok(done);
  assert.equal(done.canCancel, false, 'a settled production offers no stop');

  const blocked = parseProductionResponse(fixture.responses.statusBlocked);
  assert.ok(blocked);
  assert.ok(blocked.blockers.length >= 1);
  assert.ok(blocked.children.some((c) => c.blocker), 'the failing child carries its typed blocker');
});

test('production responses fail closed on drift', () => {
  assert.equal(parseProductionResponse({ ok: true, production: {} }), null);

  const noBudget = structuredClone(fixture.responses.statusRunning);
  delete (noBudget.production as Record<string, unknown>).budget;
  assert.equal(parseProductionResponse(noBudget), null, 'a production without its budget must not render as free');

  const noCancel = structuredClone(fixture.responses.statusRunning);
  delete (noCancel.production as Record<string, unknown>).canCancel;
  assert.equal(parseProductionResponse(noCancel), null, 'cancellability is contracted, never guessed');

  const badChild = structuredClone(fixture.responses.statusRunning);
  delete (badChild.production.children[0] as Record<string, unknown>).spentCents;
  assert.equal(parseProductionResponse(badChild), null, 'one drifted child makes the whole answer unreadable');
});

test('receipts parse with typed outcomes; drift fails closed', () => {
  const success = parseReceiptResponse(fixture.responses.receiptSuccess);
  assert.ok(success);
  assert.equal(success.outcome.type, 'success');
  assert.equal(success.artifacts.length, 2);
  assert.equal(success.planDigest, fixture.plans.twoNode.digest, 'the receipt names the exact plan it settled');

  const partial = parseReceiptResponse(fixture.responses.receiptPartial);
  assert.ok(partial);
  assert.equal(partial.outcome.type, 'partial');
  assert.equal(partial.childReceipts[1].verification, 'not_verified', 'unknown stays unknown — never converted to success');

  const badOutcome = structuredClone(fixture.responses.receiptSuccess);
  (badOutcome.receipt.outcome as Record<string, unknown>).type = 'great';
  assert.equal(parseReceiptResponse(badOutcome), null, 'an untyped outcome is unreadable');

  const noTotals = structuredClone(fixture.responses.receiptSuccess);
  delete (noTotals.receipt as Record<string, unknown>).totals;
  assert.equal(parseReceiptResponse(noTotals), null);
});

test('money formatting is minor-units + explicit currency, verbatim', () => {
  assert.equal(formatMinor(2250, 'USD'), (2250 / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' }));
  assert.match(formatMinorRange([1400, 2200], 'USD'), /14.*22/);
});
