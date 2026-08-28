import test from 'node:test';
import assert from 'node:assert/strict';
import { competenceEmptyCopy, competenceSupplyLabel, stageSkillStatus, type StageCompetenceProof } from './run-competence-proof.ts';

const skill = { skillId: 'skill-1', source: 'org', slug: 'remotion', stages: [4, 12], contentDigest: 'a'.repeat(64) };
const proof = (over: Partial<StageCompetenceProof> = {}): StageCompetenceProof => ({
  contextStatus: 'ready', attemptContextId: 'attempt-1', contextDigest: 'd'.repeat(64), workflowVersionId: null,
  bindings: [skill], supplyStatus: 'supplied', handlingStatus: 'not_recorded', receipts: [], ...over,
});

test('zero frozen learnings can never be presented as evidence that stage skills were absent', () => {
  assert.match(competenceEmptyCopy(proof({ contextStatus: 'unavailable', bindings: [], supplyStatus: 'unavailable', handlingStatus: 'unavailable',
    attemptContextId: null, contextDigest: null })), /does not mean skills were absent or unused/i);
});

test('supplied competence is not promoted to executed without a handling receipt', () => {
  const status = stageSkillStatus(skill, proof());
  assert.equal(status.label, 'Execution receipt not recorded');
  assert.match(status.detail, /execution is not claimed/i);
});

test('a frozen binding without a supply receipt does not claim supply', () => {
  const unconfirmed = proof({ supplyStatus: 'not_recorded' });
  assert.equal(competenceSupplyLabel(unconfirmed), 'supply receipt not recorded');
  assert.doesNotMatch(stageSkillStatus(skill, unconfirmed).detail, /supply is verified/i);
});

test('an applied receipt reports exact stages without claiming quality', () => {
  const status = stageSkillStatus(skill, proof({ receipts: [{
    receiptId: 'receipt-1', skillId: skill.skillId, source: skill.source, slug: skill.slug,
    contentDigest: skill.contentDigest, handling: 'applied', stages: [4, 12], reason: 'Constrained scene contract and build.',
    evidenceBinding: { kind: 'artifact', id: 'artifact-1', digest: 'b'.repeat(64) }, reportDigest: 'c'.repeat(64),
    causationClaim: 'not_claimed', createdAt: '2026-08-27T12:00:00Z',
  }], handlingStatus: 'ready' }));
  assert.equal(status.label, 'applied');
  assert.equal(status.tone, 'positive');
  assert.match(status.detail, /scene contract/);
});

test('an unreadable receipt source stays unavailable, not empty', () => {
  assert.equal(stageSkillStatus(skill, proof({ handlingStatus: 'unavailable' })).label, 'Execution receipt unavailable');
});
