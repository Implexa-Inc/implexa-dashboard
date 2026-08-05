// node --test lib/generation-control-contract.test.ts
//
// The discriminated router — the single decision that keeps a v2 plan out of the
// v1 parser and vice versa.
//
// The v1 documents here are REAL producer output at the pinned backend commit,
// not stubs. That matters: a stub v1 document is rejected by shape alone (no
// `stages`, no `density_policy`, no `tasks`), so a router that guessed the
// contract from payload shape would still have looked correct. Against a real v1
// proposal — which carries a professional_control graph, moment ids, task kinds
// and a repair reserve — shape-guessing has to be wrong on purpose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readControlContractVersion, routeProposalDocument } from './generation-control-contract.ts';
import { CONTROL_V1, CONTROL_V2 } from './professional-v2-contract.ts';
import {
  V1_PREVIEW_FAST, V1_PREVIEW_FAST_MULTI, V1_PREVIEW_PRODUCTION,
  V1_PREVIEW_PROFESSIONAL_AVAILABLE, V1_PREVIEW_PROFESSIONAL_UNAVAILABLE,
  V2_PREVIEW_AVAILABLE, V2_PREVIEW_JUDGE_OFF, V2_PREVIEW_MULTI, V2_PREVIEW_UNAVAILABLE,
} from './professional-v2.fixtures.ts';

const clone = <T>(v: T): Record<string, unknown> => structuredClone(v) as unknown as Record<string, unknown>;

const REAL_V1 = [
  ['fast', V1_PREVIEW_FAST],
  ['fast multi-moment', V1_PREVIEW_FAST_MULTI],
  ['professional available', V1_PREVIEW_PROFESSIONAL_AVAILABLE],
  ['professional unavailable', V1_PREVIEW_PROFESSIONAL_UNAVAILABLE],
  ['production', V1_PREVIEW_PRODUCTION],
] as const;

const REAL_V2 = [
  ['unavailable', V2_PREVIEW_UNAVAILABLE],
  ['available', V2_PREVIEW_AVAILABLE],
  ['judge off', V2_PREVIEW_JUDGE_OFF],
  ['multi-moment', V2_PREVIEW_MULTI],
] as const;

test('real v1 documents route to v1 — including the Professional one with a control graph', () => {
  for (const [label, fixture] of REAL_V1) {
    const doc = clone(fixture.proposal);
    assert.equal('control_contract_version' in doc, false, `${label} must not carry a discriminator`);
    assert.deepEqual(readControlContractVersion(doc), { kind: 'v1' }, label);
    assert.equal(routeProposalDocument(doc).contract, 'v1', label);
  }
  // The v1 Professional document carries a `professional_control` graph, per-task
  // kinds and a repair reserve. None of that makes it v2.
  const professional = clone(V1_PREVIEW_PROFESSIONAL_AVAILABLE.proposal);
  assert.ok(professional.professional_control);
  assert.equal(routeProposalDocument(professional).contract, 'v1');
});

test('real v2 documents route to v2, on the discriminator alone', () => {
  for (const [label, fixture] of REAL_V2) {
    const doc = clone(fixture.proposal);
    assert.equal(doc.control_contract_version, CONTROL_V2, label);
    assert.deepEqual(readControlContractVersion(doc), { kind: 'v2' }, label);
    assert.equal(routeProposalDocument(doc).contract, 'v2', label);
  }
});

test('v2 is NEVER inferred from shape', () => {
  // Take a real v2 document and delete only the discriminator. Everything that
  // makes it look like v2 — the graph, judge modes, variant counts, the cost
  // decomposition — is still there.
  const doc = clone(V2_PREVIEW_MULTI.proposal);
  delete doc.control_contract_version;
  assert.deepEqual(readControlContractVersion(doc), { kind: 'v1' });
  // And because it still carries v2-only envelope fields, routing refuses it as
  // MIXED IDENTITY rather than handing a v2 payload to the v1 parser.
  const route = routeProposalDocument(doc);
  assert.equal(route.contract, 'malformed');
  assert.match(route.contract === 'malformed' ? route.reason : '', /v1_document_carries_v2_fields/);
});

test('null, blank and trimmed discriminators are NOT absence', () => {
  // A producer that SENT the field and sent something meaningless is not a
  // producer that never mentioned it. Treating these as v1 silently renders a
  // Professional v2 plan through the Quick parser.
  for (const value of [null, '', '   ', ' professional-generation-control.v2', 'professional-generation-control.v2 ',
    'PROFESSIONAL-GENERATION-CONTROL.V2', 'v2', 'professional-generation-control.v3', 2, true, {}, []]) {
    const doc = clone(V2_PREVIEW_AVAILABLE.proposal);
    doc.control_contract_version = value as never;
    assert.deepEqual(
      readControlContractVersion(doc), { kind: 'malformed', reason: 'unknown_control_contract_version' },
      JSON.stringify(value),
    );
    assert.equal(routeProposalDocument(doc).contract, 'malformed', JSON.stringify(value));
  }
});

test('the explicit v1 literal routes to v1', () => {
  const doc = clone(V1_PREVIEW_FAST.proposal);
  doc.control_contract_version = CONTROL_V1;
  assert.deepEqual(readControlContractVersion(doc), { kind: 'v1' });
  assert.equal(routeProposalDocument(doc).contract, 'v1');
});

test('a v2 document carrying v1 fields is mixed identity and is refused', () => {
  for (const field of ['tasks', 'stages', 'density_policy', 'per_task_credits', 'review_requirements', 'pins']) {
    const doc = clone(V2_PREVIEW_AVAILABLE.proposal);
    doc[field] = [] as never;
    const route = routeProposalDocument(doc);
    assert.equal(route.contract, 'malformed', field);
    assert.match(route.contract === 'malformed' ? route.reason : '', /v2_document_carries_v1_fields/);
  }
});

test('a v1 document carrying v2 fields is mixed identity and is refused', () => {
  for (const field of ['execution_mode', 'initial_credits', 'repair_reserve_credits']) {
    const doc = clone(V1_PREVIEW_FAST.proposal);
    doc[field] = 1 as never;
    assert.equal(routeProposalDocument(doc).contract, 'malformed', field);
  }
});

test('non-objects are refused rather than defaulted to v1', () => {
  for (const value of [null, undefined, 'proposal', 7, [], true]) {
    assert.equal(readControlContractVersion(value).kind, 'malformed', JSON.stringify(value));
    assert.equal(routeProposalDocument(value).contract, 'malformed', JSON.stringify(value));
  }
});
