import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canSubmitAgentRevision,
  confirmedAgentRevisionRequestId,
  confirmedRunRequestId,
} from './run-request-receipt.ts';

test('only a confirmed created request can drive optimistic Queued UI', () => {
  assert.equal(confirmedRunRequestId({ ok: true, request: { id: 'request-1' } }), 'request-1');
  for (const refusal of [
    null,
    {},
    { ok: false, error: 'workflowVersionId must equal the server-resolved version' },
    { ok: false, request: { id: 'stale-request-id' }, error: 'workflowVersionId must equal the server-resolved version' },
    { ok: true },
    { ok: true, request: null },
    { ok: true, request: { id: '' } },
    { ok: true, request: { id: '   ' } },
  ]) assert.equal(confirmedRunRequestId(refusal), null);
});

test('a permanent edit needs both an HTTP success and a durable request receipt', () => {
  const receipt = { ok: true, request: { id: 'request-1' } };
  assert.equal(confirmedAgentRevisionRequestId(true, receipt), 'request-1');
  assert.equal(confirmedAgentRevisionRequestId(false, receipt), null, 'a 502 body cannot be acknowledged');
  assert.equal(confirmedAgentRevisionRequestId(true, { ok: true }), null, 'a hollow 200 cannot be acknowledged');
});

test('a permanent edit cannot submit while lifecycle authority is unreadable', () => {
  assert.equal(canSubmitAgentRevision({ statusUnavailable: false, revisionPending: false, busy: false, note: 'add a step' }), true);
  assert.equal(canSubmitAgentRevision({ statusUnavailable: true, revisionPending: false, busy: false, note: 'add a step' }), false);
  assert.equal(canSubmitAgentRevision({ statusUnavailable: false, revisionPending: true, busy: false, note: 'add a step' }), false);
  assert.equal(canSubmitAgentRevision({ statusUnavailable: false, revisionPending: false, busy: true, note: 'add a step' }), false);
  assert.equal(canSubmitAgentRevision({ statusUnavailable: false, revisionPending: false, busy: false, note: '   ' }), false);
});
