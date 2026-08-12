// node --test lib/live-feed-server.test.ts
//
// The state-aware landing rule needs "is anything in flight?" on the SERVER.
// getLiveFeed is the one server caller of this endpoint, and it must inherit the
// discipline above: every failure — including a 200 whose body is not the
// documented envelope — is `unavailable`, never an empty feed. An empty feed is
// what the landing rule reads as "nothing is running, send them to Agents".

import { test } from 'node:test';
import assert from 'node:assert/strict';
// live-feed-server.ts writes its runtime imports extensionless, like every
// source file here, so it is loaded through the register hook.
import '../test/support/tsx-register.mjs';

const { getLiveFeed } = await import('@/lib/live-feed-server.ts');

const TOKEN = async () => 'jwt-token';
const respond = (body: unknown, ok = true) => (async () => ({
  ok, json: async () => body,
})) as unknown as typeof fetch;

test('getLiveFeed returns the items on a well-formed response', async () => {
  const feed = await getLiveFeed({ getToken: TOKEN, fetchImpl: respond({ items: [{ status: 'running' }] }) });
  assert.deepEqual(feed, { status: 'ready', items: [{ status: 'running' }] });
});

test('getLiveFeed reports an EMPTY feed as ready — the honest zero', async () => {
  assert.deepEqual(await getLiveFeed({ getToken: TOKEN, fetchImpl: respond({ items: [] }) }), { status: 'ready', items: [] });
});

test('a malformed 200 is unavailable, NOT an empty feed', async () => {
  for (const body of [null, {}, { items: null }, { items: { a: 1 } }, 'OK']) {
    const feed = await getLiveFeed({ getToken: TOKEN, fetchImpl: respond(body) });
    assert.equal(feed.status, 'unavailable', `body ${JSON.stringify(body)} must not read as empty`);
  }
});

test('a non-2xx, a missing session and a thrown fetch are each unavailable', async () => {
  assert.deepEqual(
    await getLiveFeed({ getToken: TOKEN, fetchImpl: respond({ items: [] }, false) }),
    { status: 'unavailable', reason: 'http_error' },
  );
  assert.deepEqual(
    await getLiveFeed({ getToken: async () => null }),
    { status: 'unavailable', reason: 'no_session' },
  );
  const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.deepEqual(await getLiveFeed({ getToken: TOKEN, fetchImpl: boom }), { status: 'unavailable', reason: 'network' });
});

test('a timeout is reported as a timeout, not as a generic network error', async () => {
  const slow = (async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }) as unknown as typeof fetch;
  assert.deepEqual(await getLiveFeed({ getToken: TOKEN, fetchImpl: slow }), { status: 'unavailable', reason: 'timeout' });
});
