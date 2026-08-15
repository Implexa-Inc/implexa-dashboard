// node --test lib/outcome-production-load.test.ts
//
// The server-side production read is three-valued and fail-closed: `ok` only
// for a fully contracted answer, `not_found` only for the backend's own 404,
// and `unavailable` for everything else — INCLUDING a 200 whose body drifted.
// An unreadable answer must never surface as an empty or all-clear monitor.

import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };
import { loadOutcomeProduction } from './outcome-production-load.ts';

const ID = fixture.productions.running.id;

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    const { status, body } = handler(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test('a contracted running production loads without touching the receipt', async () => {
  const seen: string[] = [];
  const restore = stubFetch((url) => {
    seen.push(url);
    return { status: 200, body: fixture.responses.statusRunning };
  });
  try {
    const load = await loadOutcomeProduction(ID, 'jwt');
    assert.equal(load.status, 'ok');
    assert.ok(load.status === 'ok' && load.production.children.length === 2);
    assert.equal(load.status === 'ok' && load.receipt, null, 'no receipt exists before settlement');
    assert.equal(seen.length, 1, 'an unsettled production performs exactly one read');
  } finally { restore(); }
});

test('a completed production loads its receipt from the receipt endpoint', async () => {
  const restore = stubFetch((url) => (
    url.endsWith('/receipt')
      ? { status: 200, body: fixture.responses.receiptSuccess }
      : { status: 200, body: fixture.responses.statusCompleted }
  ));
  try {
    const load = await loadOutcomeProduction(ID, 'jwt');
    assert.equal(load.status, 'ok');
    assert.ok(load.status === 'ok' && load.receipt && load.receipt.outcome.type === 'success');
  } finally { restore(); }
});

test('the backend’s 404 is not_found; other failures are unavailable', async () => {
  let restore = stubFetch(() => ({ status: 404, body: { ok: false, error: 'missing' } }));
  try {
    assert.equal((await loadOutcomeProduction(ID, 'jwt')).status, 'not_found');
  } finally { restore(); }

  restore = stubFetch(() => ({ status: 503, body: { ok: false, error: 'down' } }));
  try {
    assert.equal((await loadOutcomeProduction(ID, 'jwt')).status, 'unavailable');
  } finally { restore(); }
});

test('a 200 with a drifted body is UNAVAILABLE, never an empty monitor', async () => {
  let restore = stubFetch(() => ({ status: 200, body: { ok: true, production: { id: ID } } }));
  try {
    const load = await loadOutcomeProduction(ID, 'jwt');
    assert.equal(load.status, 'unavailable');
  } finally { restore(); }

  // The production reads clean but the receipt drifts: the page must fail
  // closed rather than show a settled production with no accountable result.
  restore = stubFetch((url) => (
    url.endsWith('/receipt')
      ? { status: 200, body: { ok: true, receipt: { productionId: ID } } }
      : { status: 200, body: fixture.responses.statusCompleted }
  ));
  try {
    assert.equal((await loadOutcomeProduction(ID, 'jwt')).status, 'unavailable');
  } finally { restore(); }
});
