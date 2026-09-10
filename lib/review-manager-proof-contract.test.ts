import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKET_SOURCE_KEYS, parseReviewPacketResponse, parseStageManagerProof } from './review.ts';

const passing = {
  status: 'ready',
  stageCount: 1,
  stages: [{
    stage: 'revision', decisionCount: 5, handlingStatus: 'reported',
    appliedCount: 5, exceptionCount: 0, unavailableCount: 0, refusedCount: 0,
    causationClaim: 'not_claimed', verificationStatus: 'passed',
    requiredCriterionCount: 5, verifiedCriterionCount: 5,
  }],
  handlingStatus: 'ready',
  verificationStatus: 'passed',
  disclosure: 'aggregate_stage_proof_only',
};

test('accepts the exact aggregate composed 5/5 Manager proof', () => {
  const proof = parseStageManagerProof(passing);
  assert.ok(proof);
  assert.equal(proof.verificationStatus, 'passed');
  assert.equal(proof.stages[0].verifiedCriterionCount, 5);
});

test('accepts typed Needs You only for an aggregate hard-stage non-application', () => {
  const needsYou = {
    ...passing,
    stages: [{ ...passing.stages[0], appliedCount: 4, refusedCount: 1,
      verificationStatus: 'needs_you', requiredCriterionCount: 0, verifiedCriterionCount: 0 }],
    verificationStatus: 'needs_you',
  };
  const parsed = parseStageManagerProof(needsYou);
  assert.ok(parsed);
  assert.equal(parsed.verificationStatus, 'needs_you');
  assert.equal(parsed.stages[0].refusedCount, 1);

  assert.equal(parseStageManagerProof({ ...needsYou, verificationStatus: 'incomplete' }), null,
    'a typed non-application must not be downgraded back to generic incomplete');
  assert.equal(parseStageManagerProof({ ...needsYou, stages: [{ ...needsYou.stages[0],
    verificationStatus: 'passed', requiredCriterionCount: 5, verifiedCriterionCount: 5 }] }), null,
  'the root cannot claim Needs You while its stage claims verified');
  assert.equal(parseStageManagerProof({ ...needsYou, stages: [{ ...needsYou.stages[0],
    appliedCount: 5, refusedCount: 0 }] }), null,
  'Needs You requires an actual non-applied handling, not merely the label');
});

test('never promotes partial, contradictory, duplicated, or private Manager data', () => {
  const mutations = [
    { ...passing, verificationStatus: 'failed' },
    { ...passing, stageCount: 2 },
    { ...passing, stages: [...passing.stages, passing.stages[0]], stageCount: 2 },
    { ...passing, stages: [{ ...passing.stages[0], appliedCount: 4 }] },
    { ...passing, stages: [{ ...passing.stages[0], verifiedCriterionCount: 4 }] },
    { ...passing, disclosure: 'private_decisions' },
    { ...passing, stages: [{ ...passing.stages[0], instruction: 'private' }] },
  ];
  for (const value of mutations) assert.equal(parseStageManagerProof(value), null);
});

test('keeps none and unavailable distinct and fail-closed', () => {
  assert.ok(parseStageManagerProof({ status: 'none', stageCount: 0, stages: [], verificationStatus: 'not_required' }));
  assert.ok(parseStageManagerProof({ status: 'unavailable', unavailableReason: 'read_failed',
    stageCount: 0, stages: [], verificationStatus: 'unavailable' }));
  assert.equal(parseStageManagerProof({ status: 'unavailable', stageCount: 0, stages: [],
    verificationStatus: 'not_required' }), null);
});

test('Review packet preserves Manager proof and requires its owner-scoped sources', () => {
  const packet = {
    ok: true,
    run: { id: 'run-1', slug: 'agent', runState: 'failed', status: 'failed', reviewStatus: null, holdKind: null, startedAt: null },
    lineage: { rootRunId: 'run-1', versions: [{ runId: 'run-1', label: 'Original', runState: 'failed', startedAt: null }] },
    artifacts: [], historicalCandidates: [], judgment: null, verification: { receipts: [] },
    production: null, session: null, reviewArtifacts: [], issues: [], managerProof: passing,
    sources: { ...Object.fromEntries(PACKET_SOURCE_KEYS.map((key) => [key, 'ready'])),
      historical_candidates: 'ready', carry_membership: 'ready',
      manager_context: 'ready', manager_handling: 'ready' },
  };
  const parsed = parseReviewPacketResponse(packet, 'run-1');
  assert.ok(parsed);
  assert.equal(parsed.managerProof.verificationStatus, 'passed');
  const missingSource = { ...packet, sources: { ...packet.sources } };
  delete (missingSource.sources as Record<string, unknown>).manager_context;
  assert.equal(parseReviewPacketResponse(missingSource, 'run-1'), null);
});

test('Run Detail and Review both surface Manager proof separately from Judge history', () => {
  const runPage = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');
  const reviewPage = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'review', '[runId]', 'page.tsx'), 'utf8');
  const card = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'stage-manager-proof.tsx'), 'utf8');
  const labels = readFileSync(join(process.cwd(), 'lib', 'run-manager-proof.ts'), 'utf8');
  assert.match(runPage, /<StageManagerProof proof=\{competencePacket\.managerProof\}/);
  assert.match(reviewPage, /<StageManagerProof proof=\{packet\.managerProof\}/);
  assert.match(card, /separately from the original run status and Judge verdict/);
  assert.match(card, /Earlier failed attempts and model judgments remain preserved as history/);
  assert.match(labels, /Manager needs your input/);
  assert.match(card, /Independent verification did not/);
  assert.match(card, /no Judge result or successful Manager proof is inferred/);
  assert.doesNotMatch(card, /decisionTrace|criterion_id|instruction|evidenceRepairReceipt/);
});
