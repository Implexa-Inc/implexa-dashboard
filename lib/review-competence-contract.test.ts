import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStageCompetenceProof } from './review.ts';

const digest = (letter: string) => letter.repeat(64);
const binding = {
  skillId: 'remotion-best-practices', source: 'org', slug: 'remotion-best-practices',
  contentDigest: digest('a'), stages: [4, 12, 14, 15],
};
const receipt = {
  receiptId: 'receipt-1', ...binding, handling: 'applied', reason: 'Used for scene contract and render.',
  evidenceBinding: { kind: 'artifact', id: 'project-1' }, reportDigest: digest('b'),
  causationClaim: 'not_claimed', createdAt: '2026-08-27T12:00:00Z',
};

test('owner competence proof keeps frozen bindings separate from executor receipts', () => {
  const parsed = parseStageCompetenceProof({
    contextStatus: 'ready', attemptContextId: 'attempt-1', contextDigest: digest('c'), workflowVersionId: null,
    bindings: [binding], supplyStatus: 'supplied', handlingStatus: 'ready', receipts: [receipt],
  });
  assert.ok(parsed);
  assert.equal(parsed.bindings.length, 1);
  assert.equal(parsed.receipts[0].handling, 'applied');
});

test('malformed competence proof cannot create an execution claim', () => {
  assert.equal(parseStageCompetenceProof({
    contextStatus: 'ready', bindings: [binding], supplyStatus: 'supplied', handlingStatus: 'ready',
    attemptContextId: 'attempt-1', contextDigest: digest('c'), workflowVersionId: null,
    receipts: [{ ...receipt, reportDigest: '' }],
  }), null);
});

test('stage-scoped reuse matches exact bindings and refuses duplicates or cross-stage receipts', () => {
  const bindings = [8, 9, 11].map((stage) => ({ ...binding, stages: [stage] }));
  const receipts = bindings.map((b, index) => ({ ...receipt, ...b, receiptId: `receipt-${index}` }));
  const proof = { contextStatus: 'ready', attemptContextId: 'attempt-1', contextDigest: digest('c'),
    workflowVersionId: null, bindings, supplyStatus: 'supplied', handlingStatus: 'ready', receipts };
  assert.ok(parseStageCompetenceProof(proof));
  assert.equal(parseStageCompetenceProof({ ...proof, bindings: [...bindings, bindings[0]] }), null);
  assert.equal(parseStageCompetenceProof({ ...proof, receipts: [...receipts, receipts[0]] }), null);
  assert.equal(parseStageCompetenceProof({ ...proof, receipts: [receipts[0], { ...receipts[1], receiptId: receipts[0].receiptId }, receipts[2]] }), null);
  for (const change of [{ stages: [10] }, { source: 'other' }, { slug: 'other' }, { contentDigest: digest('d') }]) {
    assert.equal(parseStageCompetenceProof({ ...proof, receipts: [receipts[0], { ...receipts[1], ...change }, receipts[2]] }), null);
  }
});

test('unavailable context and handling carry explicit reasons and no rows', () => {
  assert.ok(parseStageCompetenceProof({
    contextStatus: 'unavailable', unavailableReason: 'context_read_failed', attemptContextId: null, contextDigest: null,
    workflowVersionId: null, bindings: [], supplyStatus: 'unavailable', supplyUnavailableReason: 'context_read_failed',
    handlingStatus: 'unavailable', handlingUnavailableReason: 'context_read_failed', receipts: [],
  }));
});
