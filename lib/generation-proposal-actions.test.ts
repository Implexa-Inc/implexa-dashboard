// node --test lib/generation-proposal-actions.test.ts
//
// The proposal write-path allowlist: exactly four actions, each mapping to exactly
// one upstream call carrying exactly the fields the backend contracted for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProposalAction } from './generation-proposal-actions.ts';

const PROPOSAL_ID = '4c1d16a8-9f7e-4b7a-8a55-2e9d0f6b3c21';
const DIGEST = 'a'.repeat(64);
const RUN_ID = '52f93684-6cd5-49b1-b183-671e9fcfb4a5';
const MOMENT = [{ id: 'moment-1', prompt: 'Aerial route map at sunrise', startSeconds: 4, endSeconds: 9 }];

test('preview/create map one bounded browser moment into the compiler contract', () => {
  for (const action of ['preview', 'create']) {
    const target = resolveProposalAction(action, {
      agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID,
      qualityMode: 'fast', moments: MOMENT,
      injected: 'never-forwarded', sourceRequestId: 'never-forwarded',
    });
    assert.ok(typeof target !== 'string');
    assert.equal(target.path, action === 'preview'
      ? '/api/v2/generation-proposals/preview' : '/api/v2/generation-proposals');
    assert.deepEqual(target.body, {
      capabilityKey: 'video.generate_broll', qualityMode: 'fast',
      agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID,
      moments: [{ id: 'moment-1', prompt: 'Aerial route map at sunrise', start_seconds: 4, end_seconds: 9, ratio: '720:1280' }],
    });
  }
});

test('preview/create refuse unbounded, malformed, or foreign-shaped inputs', () => {
  const good = { agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID, qualityMode: 'fast', moments: MOMENT };
  assert.equal(typeof resolveProposalAction('preview', { ...good, moments: [] }), 'string');
  assert.equal(typeof resolveProposalAction('preview', { ...good, moments: [...MOMENT, ...MOMENT] }), 'string');
  assert.equal(typeof resolveProposalAction('preview', { ...good, sourceRunId: 'nope' }), 'string');
  assert.equal(typeof resolveProposalAction('preview', { ...good, agentSubject: '../other' }), 'string');
  assert.equal(typeof resolveProposalAction('preview', { ...good, qualityMode: 'ultra' }), 'string');
  assert.equal(typeof resolveProposalAction('preview', { ...good, moments: [{ ...MOMENT[0], endSeconds: 20 }] }), 'string');
  assert.equal(typeof resolveProposalAction('preview', { ...good, moments: [{ ...MOMENT[0], prompt: '' }] }), 'string');
});

test('approve maps to one upstream call with the identity verbatim and the key as a header', () => {
  const target = resolveProposalAction('approve', {
    proposalId: PROPOSAL_ID,
    proposalVersion: 'generation-quality.v1',
    proposalDigest: DIGEST,
    idempotencyKey: 'approve-abc-123',
  });
  assert.ok(typeof target !== 'string');
  assert.equal(target.path, `/api/v2/generation-proposals/${PROPOSAL_ID}/approve`);
  assert.equal(target.method, 'POST');
  assert.deepEqual(target.body, { proposalVersion: 'generation-quality.v1', proposalDigest: DIGEST });
  assert.equal(target.idempotencyKey, 'approve-abc-123');
});

test('approve refuses a missing or malformed identity — no defaults are supplied', () => {
  assert.equal(typeof resolveProposalAction('approve', { proposalId: 'not-a-uuid', proposalVersion: 'v', proposalDigest: DIGEST, idempotencyKey: 'approve-abc-123' }), 'string');
  assert.equal(typeof resolveProposalAction('approve', { proposalId: PROPOSAL_ID, proposalDigest: DIGEST, idempotencyKey: 'approve-abc-123' }), 'string');
  assert.equal(typeof resolveProposalAction('approve', { proposalId: PROPOSAL_ID, proposalVersion: 'v', proposalDigest: 'short', idempotencyKey: 'approve-abc-123' }), 'string');
  assert.equal(typeof resolveProposalAction('approve', { proposalId: PROPOSAL_ID, proposalVersion: 'v', proposalDigest: DIGEST, idempotencyKey: 'x' }), 'string');
});

test('cancel maps to its one upstream call and needs only the id', () => {
  const target = resolveProposalAction('cancel', { proposalId: PROPOSAL_ID });
  assert.ok(typeof target !== 'string');
  assert.equal(target.path, `/api/v2/generation-proposals/${PROPOSAL_ID}/cancel`);
  assert.deepEqual(target.body, {});
});

test('unknown actions are refused — there is no passthrough', () => {
  assert.equal(typeof resolveProposalAction('delete', { proposalId: PROPOSAL_ID }), 'string');
  assert.equal(typeof resolveProposalAction('', {}), 'string');
});

test('extra client fields are never forwarded upstream', () => {
  const target = resolveProposalAction('approve', {
    proposalId: PROPOSAL_ID, proposalVersion: 'v1', proposalDigest: DIGEST,
    idempotencyKey: 'approve-abc-123',
    injected: 'nope', authorization_internal: 'nope',
  });
  assert.ok(typeof target !== 'string');
  assert.deepEqual(Object.keys(target.body).sort(), ['proposalDigest', 'proposalVersion']);
});
