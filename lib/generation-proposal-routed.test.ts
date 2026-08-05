// node --test lib/generation-proposal-routed.test.ts
//
// The routed read. Two things must hold at once and they pull in opposite
// directions: a v2 proposal must render as v2, and a v1 proposal must go on
// behaving EXACTLY as it did before this lane existed.
//
// The second is asserted the only way that means anything — by comparing the
// routed result against the v1 parser called directly, on real v1 wire output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutedProposalResponse } from './generation-proposal-routed.ts';
import { parseGenerationProposalResponse } from './generation-proposal.ts';
import { parseProfessionalV2ProposalResponse } from './generation-proposal-v2-envelope.ts';
import {
  V1_GET_FAST, V2_GET_AWAITING_APPROVAL, V2_GET_UNAVAILABLE,
} from './professional-v2.fixtures.ts';

type Doc = Record<string, unknown>;
const clone = <T>(v: T): Doc => structuredClone(v) as unknown as Doc;
const PROPOSAL_ID = 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43';

test('a real v1 read routes to v1 and is IDENTICAL to the direct v1 parse', () => {
  const routed = parseRoutedProposalResponse(clone(V1_GET_FAST), PROPOSAL_ID);
  assert.ok(routed);
  assert.equal(routed.contract, 'v1');
  const direct = parseGenerationProposalResponse(clone(V1_GET_FAST), PROPOSAL_ID);
  assert.ok(direct);
  // Byte-for-byte the same view model: the router adds a tag and changes nothing.
  assert.deepEqual(routed.vm, direct);
});

test('a real v2 read routes to v2 and is identical to the direct v2 parse', () => {
  for (const fixture of [V2_GET_UNAVAILABLE, V2_GET_AWAITING_APPROVAL]) {
    const routed = parseRoutedProposalResponse(clone(fixture), PROPOSAL_ID);
    assert.ok(routed);
    assert.equal(routed.contract, 'v2');
    assert.deepEqual(routed.vm, parseProfessionalV2ProposalResponse(clone(fixture), PROPOSAL_ID));
  }
});

test('an unavailable v2 read carries its plan and offers no authorization', () => {
  const routed = parseRoutedProposalResponse(clone(V2_GET_UNAVAILABLE), PROPOSAL_ID);
  assert.ok(routed && routed.contract === 'v2');
  assert.equal(routed.vm.lifecycle, 'unavailable');
  assert.equal(routed.vm.compiled.availability, false);
  assert.equal(routed.vm.authorization, null);
  assert.equal(routed.vm.incurredCredits, 0);
  assert.ok(routed.vm.compiled.taskCount > 0);
});

test('a proposal for a different id never renders under this one', () => {
  assert.equal(parseRoutedProposalResponse(clone(V2_GET_UNAVAILABLE), 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b44'), null);
  assert.equal(parseRoutedProposalResponse(clone(V1_GET_FAST), 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b44'), null);
});

test('a malformed or mixed-identity discriminator is a read we could not make', () => {
  for (const value of [null, '', '   ', 'professional-generation-control.v3']) {
    const body = clone(V2_GET_UNAVAILABLE);
    (body.proposal as Doc).control_contract_version = value as never;
    assert.equal(parseRoutedProposalResponse(body, PROPOSAL_ID), null, JSON.stringify(value));
  }
  // A v2 payload stripped of its discriminator must NOT fall through to v1.
  const stripped = clone(V2_GET_UNAVAILABLE);
  delete (stripped.proposal as Doc).control_contract_version;
  assert.equal(parseRoutedProposalResponse(stripped, PROPOSAL_ID), null);
});

test('an envelope whose availability contradicts its lifecycle is refused on both arms', () => {
  const v2 = clone(V2_GET_UNAVAILABLE);
  v2.lifecycle_state = 'awaiting_approval';
  v2.progress_state = 'awaiting_approval';
  assert.equal(parseRoutedProposalResponse(v2, PROPOSAL_ID), null);
  const v1 = clone(V1_GET_FAST);
  v1.availability = false;
  assert.equal(parseRoutedProposalResponse(v1, PROPOSAL_ID), null);
});

test('a v2 read cannot claim spend the events do not account for', () => {
  const body = clone(V2_GET_AWAITING_APPROVAL);
  (body.cost as Doc).total_credits = 12;
  assert.equal(parseRoutedProposalResponse(body, PROPOSAL_ID), null);
  const missing = clone(V2_GET_AWAITING_APPROVAL);
  missing.task_progress = null as never;
  assert.equal(parseRoutedProposalResponse(missing, PROPOSAL_ID), null);
  const foreignAuth = clone(V2_GET_AWAITING_APPROVAL);
  foreignAuth.authorization = { authorization_id: 'x', authorization_digest: 'a'.repeat(64), status: 'pending', max_tasks: 1, max_credits: 1, expires_at: '2026-08-04T18:00:00.000Z' } as never;
  assert.equal(parseRoutedProposalResponse(foreignAuth, PROPOSAL_ID), null);
});
