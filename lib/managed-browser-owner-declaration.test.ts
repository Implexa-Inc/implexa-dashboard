import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadOwnerView, readOwnerView, ownerDecision, ownerDecisionDigest, confirmOwnerDecision, type OwnerOperationContext } from './managed-browser-owner-declaration.ts';

const bytes = readFileSync(new URL('./test/fixtures/managed-browser-owner-view.v1.json', import.meta.url));
const fixture = JSON.parse(bytes.toString());
const sample = (name: string) => fixture.samples.find((row: any) => row.name === name);
const target = { accountId: '55200000-0000-4000-8000-000000000001', slug: 'video', versionId: sample('absent').output.workflowVersionId };
const session = () => ({ user: { id: target.accountId }, access_token: 'synthetic-owner-session-token-not-a-credential' });
const ctx = (overrides: Partial<OwnerOperationContext> = {}): OwnerOperationContext => ({ target,
  bridge: { managedBrowserNoSpendContext: async () => ({ ok: true, context: sample('absent').output }) },
  getSession: async () => session(), current: () => true, ...overrides });
const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);

test('Desktop actual producer fixture is byte-pinned and every output matches its producer digest', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'd6a4fd6f51b4433f4c148411c558feb8be2a8c6bf933b200a67fd0217159bf6f');
  assert.equal(fixture.source.desktopCommit, '5bbfcc5da009630f23d43cc87292b9529b736f5a');
  for (const row of fixture.samples) {
    assert.equal(createHash('sha256').update(canonical(row.output)).digest('hex'), row.outputDigest);
    assert.deepEqual(readOwnerView(row.output, target, row.name === 'revoke' ? 'revoke' : 'declare'), row.output);
  }
});

test('read-only mode sends exactly current owner/Agent identities, no declaration or owner JWT', async () => {
  const reads: unknown[] = [];
  const view = await loadOwnerView(ctx({ bridge: { managedBrowserNoSpendContext: async input => { reads.push(input); return { ok: true, context: sample('absent').output }; } } }), 'declare');
  assert.deepEqual(reads, [target]); assert.equal(view.state, 'absent');
});

test('revoke read uses its typed browser-free mode and retained producer identities', async () => {
  const reads: unknown[] = [];
  const view = await loadOwnerView(ctx({ bridge: { managedBrowserNoSpendContext: async input => { reads.push(input); return { ok: true, context: sample('revoke').output }; } } }), 'revoke');
  assert.deepEqual(reads, [{ ...target, operation: 'revoke' }]);
  assert.deepEqual(ownerDecision(view, 'revoke'), {
    contractVersion: 'managed-browser-no-spend-update.v1', grantId: view.grantId, workflowVersionId: view.workflowVersionId,
    machineId: view.machineId, profileId: view.profileId, bindingId: view.bindingId,
    expectedDeclarationDigest: view.expectedDeclarationDigest, operation: 'revoke', statement: null, expiresAt: null, evidenceRef: null,
  });
  assert.throws(() => ownerDecision(view, 'declare', { confirmed: true, expiresAt: '2099-01-01' }));
});

test('unavailable never becomes absent, and malformed/wrong-version/unbounded read responses refuse', async () => {
  await assert.rejects(loadOwnerView(ctx({ bridge: { managedBrowserNoSpendContext: async () => ({ ok: false }) } }), 'declare'));
  for (const value of [{ ...sample('absent').output, activationOptIns: {} }, { ...sample('absent').output, workflowVersionId: 'another-version' },
    { ...sample('absent').output, origins: ['http://unsafe.invalid'] }, { ...sample('declared').output, declaration: null }]) {
    assert.throws(() => readOwnerView(value, target, 'declare'));
  }
});

test('owner mismatch refuses before native read and superseded read cannot publish context', async () => {
  let calls = 0;
  const bridge = { managedBrowserNoSpendContext: async () => { calls++; return { ok: true, context: sample('absent').output }; } };
  await assert.rejects(loadOwnerView(ctx({ bridge, getSession: async () => ({ ...session(), user: { id: 'another-owner' } }) }), 'declare'));
  assert.equal(calls, 0);
  let current = true;
  await assert.rejects(loadOwnerView(ctx({ current: () => current, bridge: { managedBrowserNoSpendContext: async () => { current = false; return { ok: true, context: sample('absent').output }; } } }), 'declare'));
});

test('account changes during a read refuse even without an auth event', async () => {
  let account = target.accountId;
  await assert.rejects(loadOwnerView(ctx({ getSession: async () => ({ ...session(), user: { id: account } }),
    bridge: { managedBrowserNoSpendContext: async () => { account = 'other'; return { ok: true, context: sample('absent').output }; } } }), 'declare'));
});

test('declaration requires explicit owner statement, chosen valid expiry, bounded reference and nonmismatched context', () => {
  const now = Date.parse(sample('absent').testClock), view = sample('absent').output;
  const valid = { confirmed: true, expiresAt: new Date(now + 3600000).toISOString() };
  for (const opts of [{ ...valid, confirmed: false }, { ...valid, expiresAt: '' }, { ...valid, expiresAt: new Date(now).toISOString() },
    { ...valid, expiresAt: new Date(now + 31 * 86400000).toISOString() }, { ...valid, evidenceRef: 'x'.repeat(1025) }])
    assert.throws(() => ownerDecision(view, 'declare', opts, now));
  assert.throws(() => ownerDecision({ ...view, state: 'mismatch' }, 'declare', valid, now));
  const decision = ownerDecision(view, 'declare', valid, now);
  assert.equal(Object.keys(decision).length, 11); assert.equal(decision.evidenceRef, null);
  assert.equal(decision.expiresAt, valid.expiresAt); assert.equal(Object.isFrozen(decision), true);
});

test('confirmed decision digest is canonical and the fresh JWT is forwarded once with exact five keys', async () => {
  const row = sample('absent'), now = Date.parse(row.testClock);
  const decision = ownerDecision(row.output, 'declare', { confirmed: true, expiresAt: new Date(now + 1000).toISOString(), evidenceRef: 'Evidence 💡' }, now);
  assert.equal(await ownerDecisionDigest(decision), createHash('sha256').update(canonical(decision)).digest('hex'));
  const calls: any[] = []; let sessions = 0;
  await confirmOwnerDecision(ctx({ getSession: async () => { sessions++; return session(); }, bridge: {
    confirmManagedBrowserNoSpend: async input => { calls.push(input); return { ok: true }; },
  } }), decision);
  assert.equal(calls.length, 1); assert.equal(sessions, 2);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['slug', 'versionId', 'decision', 'decisionDigest', 'ownerSessionToken'].sort());
  assert.equal(calls[0].decision, decision); assert.equal(calls[0].ownerSessionToken, session().access_token);
});

test('missing login, changed account or cancellation before dispatch never sends a mutation', async () => {
  let writes = 0;
  const bridge = { confirmManagedBrowserNoSpend: async () => { writes++; return { ok: true }; } };
  const decision = ownerDecision(sample('revoke').output, 'revoke');
  for (const value of [ctx({ bridge, getSession: async () => null }), ctx({ bridge, current: () => false }),
    ctx({ bridge, getSession: async () => ({ ...session(), user: { id: 'other' } }) })]) await assert.rejects(confirmOwnerDecision(value, decision));
  assert.equal(writes, 0);
});

test('lost acknowledgement/refusal is never retried; owner switch after dispatch never reports success', async () => {
  const decision = ownerDecision(sample('revoke').output, 'revoke');
  for (const outcome of ['throw', 'refuse', 'account-change']) {
    let writes = 0, account = target.accountId;
    await assert.rejects(confirmOwnerDecision(ctx({ getSession: async () => ({ ...session(), user: { id: account } }), bridge: {
      confirmManagedBrowserNoSpend: async () => { writes++; if (outcome === 'throw') throw Error('lost');
        if (outcome === 'account-change') account = 'other'; return { ok: outcome !== 'refuse' }; },
    } }), decision));
    assert.equal(writes, 1);
  }
});
