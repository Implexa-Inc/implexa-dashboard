// Guard tests for the read-side half of the stuck "Updating…" badge fix.
//   node --test lib/revise-pending.test.ts   (Node 22.6+ strips the types natively)
//
// The founder bug: a Codex failover session landed the new version (v3) but
// never resolved the kind='revise' run_request, so it sat 'consumed' and the
// old "any open revise request" predicate pinned the badge forever. The truth
// signal is the VERSION LANDING: a version newer than the ask means the revise
// finished, whatever the request row says. These tests pin both directions —
// self-healing on a landed version AND never hiding a genuinely in-flight one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRevisePending, newestVersionAt } from './revise-pending.ts';

const ASK = '2026-07-16T10:00:00Z';
const BEFORE_ASK = '2026-07-16T09:00:00Z';
const AFTER_ASK = '2026-07-16T10:25:00Z';
const revise = (created_at: string | null, status = 'consumed') => ({ kind: 'revise', status, created_at });

test('the founder bug shape self-heals: version landed AFTER the ask → not pending, whatever the request status says', () => {
  assert.equal(isRevisePending([revise(ASK, 'consumed')], AFTER_ASK), false);
  assert.equal(isRevisePending([revise(ASK, 'pending')], AFTER_ASK), false);
});

test('a genuinely in-flight revise still shows: request newer than the latest landed version', () => {
  assert.equal(isRevisePending([revise(ASK)], BEFORE_ASK), true);
});

test('no version history in scope keeps the legacy trigger semantics (never hide on missing data)', () => {
  assert.equal(isRevisePending([revise(ASK)], null), true);
  assert.equal(isRevisePending([revise(ASK)], 'not-a-date'), true);
});

test('an unparsable request timestamp stays conservative (badge shows)', () => {
  assert.equal(isRevisePending([revise(null)], AFTER_ASK), true);
});

test('no open revise requests → never pending, version or not', () => {
  assert.equal(isRevisePending([], AFTER_ASK), false);
  assert.equal(isRevisePending(null, null), false);
  assert.equal(isRevisePending([{ kind: 'run', status: 'pending', created_at: ASK }], null), false);
});

test('terminal revise requests always release Updating and Run, even without version history', () => {
  for (const status of ['done', 'cancelled', 'failed']) {
    assert.equal(isRevisePending([revise(ASK, status)], null), false, status);
  }
});

test('mixed queue: one landed + one newer ask → still pending (the second edit is in flight)', () => {
  const landed = revise(BEFORE_ASK);
  const inFlight = revise(AFTER_ASK);
  assert.equal(isRevisePending([landed, inFlight], ASK), true);
});

test('newestVersionAt is order-independent and null-safe', () => {
  assert.equal(newestVersionAt([{ at: BEFORE_ASK }, { at: AFTER_ASK }, { at: ASK }]), AFTER_ASK);
  assert.equal(newestVersionAt([{ at: AFTER_ASK }, { at: BEFORE_ASK }]), AFTER_ASK);
  assert.equal(newestVersionAt([]), null);
  assert.equal(newestVersionAt(null), null);
  assert.equal(newestVersionAt([{ at: '' }, { at: 'garbage' }]), null);
});
