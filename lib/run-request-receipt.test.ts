import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedRunRequestId } from './run-request-receipt.ts';

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
