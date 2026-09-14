import test from 'node:test';
import assert from 'node:assert/strict';
import { callBackend } from './api.ts';

test('callBackend maps only the explicit idempotency option to the standard header', async () => {
  const original = globalThis.fetch;
  let captured: RequestInit | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    await callBackend('/test', { jwt: 'jwt', method: 'POST', body: { exact: true }, idempotencyKey: 'stable-operation-1' });
    assert.deepEqual(captured?.headers, {
      'Content-Type': 'application/json', Authorization: 'Bearer jwt', 'Idempotency-Key': 'stable-operation-1',
    });
  } finally { globalThis.fetch = original; }
});
