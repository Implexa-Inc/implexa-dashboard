// node --test lib/outcome-production-load.test.ts
//
// The server-side production read is three-valued and fail-closed: `ok` only
// for a fully contracted answer, `not_found` only for the backend's own 404,
// and `unavailable` for everything else — INCLUDING a 200 whose body drifted.
// An unreadable answer must never surface as an empty or all-clear monitor.

import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };
import { listOutcomeProductions, loadOutcomeProduction } from './outcome-production-load.ts';

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
    assert.equal(load.status === 'ok' && load.receiptStatus, 'ready');
  } finally { restore(); }
});

test('EVERY settled production loads its receipt — stopped and failed included', async () => {
  // A stopped or failed production is exactly when the user most needs the
  // account of what was spent and what came back. Reading the receipt only for
  // 'completed' left those two states with no Work item at all.
  const cases = [
    [fixture.productions.cancelled, fixture.receipts.cancelled, 'failure'],
    [fixture.productions.failed, fixture.receipts.failed, 'failure'],
  ] as const;
  for (const [production, receipt, outcomeType] of cases) {
    const restore = stubFetch((url) => (
      url.endsWith('/receipt')
        ? { status: 200, body: { ok: true, receipt } }
        : { status: 200, body: { ok: true, production } }
    ));
    try {
      const load = await loadOutcomeProduction(ID, 'jwt');
      assert.ok(load.status === 'ok' && load.receipt, production.state);
      assert.equal(load.status === 'ok' && load.receipt!.outcome.type, outcomeType);
    } finally { restore(); }
  }
});

test('an unreadable receipt does NOT hide the production that read cleanly', async () => {
  // A 404 here means both "not written yet" and "this backend has no receipt
  // route", and we cannot tell which — so it is reported as unread, never as
  // a promise that one is on its way.
  for (const status of [404, 503]) {
    const restore = stubFetch((url) => (
      url.endsWith('/receipt')
        ? { status, body: { ok: false, error: 'nope' } }
        : { status: 200, body: fixture.responses.statusCompleted }
    ));
    try {
      const load = await loadOutcomeProduction(ID, 'jwt');
      assert.equal(load.status, 'ok', `the settled production still renders (${status})`);
      assert.equal(load.status === 'ok' && load.receiptStatus, 'unavailable');
      assert.equal(load.status === 'ok' && load.receipt, null);
    } finally { restore(); }
  }
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

  // The production reads clean but the receipt drifts. The receipt is reported
  // as its own gap; blanking a page that can already answer "what happened"
  // would be a bigger lie than admitting the accounting is unread.
  restore = stubFetch((url) => (
    url.endsWith('/receipt')
      ? { status: 200, body: { ok: true, receipt: { productionId: ID } } }
      : { status: 200, body: fixture.responses.statusCompleted }
  ));
  try {
    const load = await loadOutcomeProduction(ID, 'jwt');
    assert.equal(load.status, 'ok');
    assert.equal(load.status === 'ok' && load.receiptStatus, 'unavailable');
    assert.equal(load.status === 'ok' && load.receipt, null, 'a drifted receipt is never partially rendered');
  } finally { restore(); }
});

test('the productions list is three-valued: readable, or explicitly unavailable', async () => {
  let restore = stubFetch(() => ({ status: 200, body: fixture.responses.list }));
  try {
    const load = await listOutcomeProductions('jwt');
    assert.equal(load.status, 'ready');
    assert.equal(load.status === 'ready' && load.productions.length, fixture.responses.list.productions.length);
  } finally { restore(); }

  // An unreadable list must never render as "you have no productions".
  restore = stubFetch(() => ({ status: 200, body: { ok: true, productions: [{ id: 'x' }] } }));
  try {
    assert.equal((await listOutcomeProductions('jwt')).status, 'unavailable');
  } finally { restore(); }

  restore = stubFetch(() => ({ status: 503, body: { ok: false, error: 'down' } }));
  try {
    assert.equal((await listOutcomeProductions('jwt')).status, 'unavailable');
  } finally { restore(); }
});

test('a deployment without the list route is ABSENT, not a fault to warn about', async () => {
  // /work is a shared surface. A backend that has never offered this
  // capability must not put a standing amber warning on it for every user.
  const restore = stubFetch(() => ({ status: 404, body: { ok: false, error: 'not_found' } }));
  try {
    assert.equal((await listOutcomeProductions('jwt')).status, 'absent');
  } finally { restore(); }
});
