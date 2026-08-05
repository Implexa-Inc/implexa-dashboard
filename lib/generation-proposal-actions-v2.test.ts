// node --test lib/generation-proposal-actions-v2.test.ts
//
// The proxy allowlist for the Professional v2 write path.
//
// This is the SERVER side of the JWT boundary: whatever the browser sends, this
// is what actually goes upstream under the user's token. So the bounds are
// re-enforced here rather than trusted from the editor, and the control-contract
// discriminator is written from a pinned constant rather than echoed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProposalAction } from './generation-proposal-actions.ts';
import { BOUNDS, CONTROL_V2 } from './professional-v2-contract.ts';

const RUN_ID = '7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77';
const base = (over: Record<string, unknown> = {}) => ({
  id: 'hook', prompt: 'a slow aerial push over a bay bridge at sunrise',
  startSeconds: 0, endSeconds: 3, ratio: '720:1280',
  variantsRequested: 2, judgeMode: 'ranked', maxRepairs: 1, ...over,
});
const call = (action: string, moments: unknown[]) =>
  resolveProposalAction(action, { agentSubject: 'daily-ig-reel', sourceRunId: RUN_ID, moments });

test('a valid timeline becomes an EXPLICIT v2 request on the right endpoint', () => {
  const preview = call('preview-professional-v2', [base()]);
  assert.notEqual(typeof preview, 'string');
  if (typeof preview === 'string') return;
  assert.equal(preview.path, '/api/v2/generation-proposals/preview');
  assert.equal(preview.method, 'POST');
  assert.equal(preview.body.controlContractVersion, CONTROL_V2);
  assert.equal(preview.body.qualityMode, 'professional');
  assert.equal(preview.body.capabilityKey, 'video.generate_broll');
  assert.deepEqual(preview.body.moments, [{
    id: 'hook', prompt: 'a slow aerial push over a bay bridge at sunrise',
    start_seconds: 0, end_seconds: 3, ratio: '720:1280',
    variants_requested: 2, judge_mode: 'ranked', max_repairs: 1,
  }]);
  // No provider, model, pricing version or credit figure travels: the backend
  // PINS the identity, and a client that named one would be choosing its own price.
  const serialized = JSON.stringify(preview.body);
  for (const forbidden of ['provider', 'model', 'pricing', 'credits', 'runway', 'gen4']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  const create = call('create-professional-v2', [base()]);
  assert.notEqual(typeof create, 'string');
  if (typeof create === 'string') return;
  assert.equal(create.path, '/api/v2/generation-proposals');
  assert.equal(create.body.controlContractVersion, CONTROL_V2);
});

test('the discriminator is written, never echoed from the browser', () => {
  const forged = resolveProposalAction('preview-professional-v2', {
    agentSubject: 'daily-ig-reel', sourceRunId: RUN_ID, moments: [base()],
    controlContractVersion: 'professional-generation-control.v9',
    qualityMode: 'production', capabilityKey: 'video.something_else',
  });
  assert.notEqual(typeof forged, 'string');
  if (typeof forged === 'string') return;
  assert.equal(forged.body.controlContractVersion, CONTROL_V2);
  assert.equal(forged.body.qualityMode, 'professional');
  assert.equal(forged.body.capabilityKey, 'video.generate_broll');
});

test('the Quick/v1 actions are untouched and still single-moment', () => {
  const preview = resolveProposalAction('preview', {
    agentSubject: 'daily-ig-reel', sourceRunId: RUN_ID, qualityMode: 'fast',
    moments: [{ id: 'hook', prompt: 'a camera moving over bay area bridge', startSeconds: 0, endSeconds: 3 }],
  });
  assert.notEqual(typeof preview, 'string');
  if (typeof preview === 'string') return;
  assert.equal(preview.path, '/api/v2/generation-proposals/preview');
  // A v1 request carries NO discriminator at all. Adding one would change how
  // the backend routes every existing Quick proposal.
  assert.equal('controlContractVersion' in preview.body, false);
  assert.deepEqual(preview.body.moments, [{
    id: 'hook', prompt: 'a camera moving over bay area bridge',
    start_seconds: 0, end_seconds: 3, ratio: '720:1280',
  }]);
  // And v1 still refuses more than one moment.
  assert.equal(typeof resolveProposalAction('preview', {
    agentSubject: 'daily-ig-reel', sourceRunId: RUN_ID, qualityMode: 'fast',
    moments: [
      { id: 'a', prompt: 'x', startSeconds: 0, endSeconds: 3 },
      { id: 'b', prompt: 'y', startSeconds: 3, endSeconds: 6 },
    ],
  }), 'string');
});

test('every bound is re-enforced on the server side of the boundary', () => {
  const refusals: Array<[string, unknown[]]> = [
    ['no moments', []],
    ['too many moments', Array.from({ length: BOUNDS.maxMoments + 1 }, (u, i) => base({
      id: `m${i}`, startSeconds: i * 3, endSeconds: i * 3 + 3, variantsRequested: 1, judgeMode: 'off', maxRepairs: 0,
    }))],
    ['blank prompt', [base({ prompt: '   ' })]],
    ['prompt too long', [base({ prompt: 'x'.repeat(BOUNDS.promptMaxChars + 1) })]],
    ['duration too short', [base({ endSeconds: 1 })]],
    ['duration too long', [base({ endSeconds: 11 })]],
    ['sub-millisecond timing', [base({ startSeconds: 0.00005 })]],
    ['bad ratio', [base({ ratio: '1280:720' })]],
    ['variants below range', [base({ variantsRequested: 0 })]],
    ['variants above range', [base({ variantsRequested: BOUNDS.maxVariantsPerMoment + 1 })]],
    ['non-integer variants', [base({ variantsRequested: 2.5 })]],
    ['unknown judge mode', [base({ judgeMode: 'graded' })]],
    ['repairs above range', [base({ maxRepairs: BOUNDS.maxRepairsPerMoment + 1 })]],
    ['repair with judge off', [base({ judgeMode: 'off', maxRepairs: 1 })]],
    ['bad moment id', [base({ id: 'Hook' })]],
    ['duplicate ids', [base({ id: 'a' }), base({ id: 'a', startSeconds: 3, endSeconds: 6 })]],
    ['overlap', [base({ id: 'a', startSeconds: 0, endSeconds: 4 }), base({ id: 'b', startSeconds: 3, endSeconds: 7 })]],
    ['out of order', [base({ id: 'a', startSeconds: 6, endSeconds: 9 }), base({ id: 'b', startSeconds: 0, endSeconds: 3 })]],
    ['task ceiling', Array.from({ length: 9 }, (u, i) => base({
      id: `m${i}`, startSeconds: i * 3, endSeconds: i * 3 + 3, variantsRequested: 4, maxRepairs: 1,
    }))],
  ];
  for (const [label, moments] of refusals) {
    assert.equal(typeof call('preview-professional-v2', moments), 'string', label);
    assert.equal(typeof call('create-professional-v2', moments), 'string', label);
  }
});

test('abutting moments and the exact task ceiling are ACCEPTED', () => {
  assert.notEqual(typeof call('preview-professional-v2', [
    base({ id: 'a', startSeconds: 0, endSeconds: 3 }), base({ id: 'b', startSeconds: 3, endSeconds: 6 }),
  ]), 'string');
  // 8 moments x (4 takes + 1 reserve) = exactly 40.
  assert.notEqual(typeof call('preview-professional-v2', Array.from({ length: 8 }, (u, i) => base({
    id: `m${i}`, startSeconds: i * 3, endSeconds: i * 3 + 3, variantsRequested: 4, maxRepairs: 1,
  }))), 'string');
});

test('identity is still required, and unknown actions are still refused', () => {
  assert.equal(typeof resolveProposalAction('preview-professional-v2', {
    agentSubject: 'Not A Slug', sourceRunId: RUN_ID, moments: [base()],
  }), 'string');
  assert.equal(typeof resolveProposalAction('preview-professional-v2', {
    agentSubject: 'daily-ig-reel', sourceRunId: 'nope', moments: [base()],
  }), 'string');
  assert.equal(resolveProposalAction('passthrough', {}), 'Unknown action.');
  assert.equal(resolveProposalAction('preview-professional-v3', {}), 'Unknown action.');
});

test('approve still forwards the version/digest pair verbatim with an idempotency key', () => {
  const approve = resolveProposalAction('approve', {
    proposalId: 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43',
    proposalVersion: 'generation-quality.v1',
    proposalDigest: 'a'.repeat(64),
    idempotencyKey: 'approve-6f2a1c34-9d55-4b7e-8a01-2c3d4e5f6071',
  });
  assert.notEqual(typeof approve, 'string');
  if (typeof approve === 'string') return;
  assert.equal(approve.idempotencyKey, 'approve-6f2a1c34-9d55-4b7e-8a01-2c3d4e5f6071');
  assert.deepEqual(approve.body, { proposalVersion: 'generation-quality.v1', proposalDigest: 'a'.repeat(64) });
});
