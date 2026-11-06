import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepareOwnerTrial, submitOwnerTrial, trialDecisionDigest } from './managed-browser-owner-trial.ts';

const bytes = (name: string) => readFileSync(new URL(`./test/fixtures/${name}`, import.meta.url));
const backendBytes = bytes('managed-browser-owner-trial-producers.v1.json');
const nativeBytes = bytes('managed-browser-trial-runtime-owner-view-composed.v1.json');
const producer = JSON.parse(backendBytes.toString()), native = JSON.parse(nativeBytes.toString());
const earlierNative = JSON.parse(bytes('managed-browser-trial-runtime-owner-view.v1.json').toString());
const q = producer.trialRequest, preview = producer.trialContext;
const target = { accountId: q.user_id, slug: q.workflow_slug, versionId: q.workflow_version_id };
const body = () => ({ source: 'dashboard', kind: 'run', workflowSlug: target.slug,
  workflowVersionId: target.versionId, inputContractDigest: q.input_contract_digest, inputBindings: structuredClone(q.input_bindings) });
const now = Date.parse(q.created_at) - 1000;
const session = () => ({ user: { id: target.accountId }, access_token: 'synthetic-session-not-a-credential' });
function context(overrides: Record<string, any> = {}) {
  const calls: any[] = [];
  const ctx = { target, current: () => true, getSession: async () => session(),
    bridge: { managedBrowserTrialRuntime: async () => native.output },
    callBackend: async (path: string, options: any) => { calls.push({ path, options });
      return path.endsWith('trial-context') ? preview : { ok: true, request: q }; }, ...overrides };
  return { ctx, calls };
}
function clock(t: any) { t.mock.method(Date, 'now', () => now); t.mock.method(crypto, 'randomUUID', () => q.id); }

test('both integration fixtures are unchanged actual producer output with matching identities', async () => {
  assert.equal(createHash('sha256').update(backendBytes).digest('hex'), '6b4895a27d088bac261b4d3aa0c09172940609d712bd832755974deeefdea6d0');
  assert.equal(createHash('sha256').update(nativeBytes).digest('hex'), '13971bdbe314819356732f06190db7937302ce9eb307470725aa7c1781d19936');
  assert.equal(native.provenance.contextFixtureSha256, createHash('sha256').update(backendBytes).digest('hex'));
  for (const key of ['machineId', 'profileId', 'bindingId', 'runtimeIdentityDigest']) assert.equal(native.output[key], preview.decision[key]);
  assert.equal(await trialDecisionDigest(preview.decision), preview.decisionDigest);
});

test('the real native DTO and owner preview compose, with no request birth before owner confirmation', async t => {
  clock(t); const { ctx, calls } = context();
  const prepared = await prepareOwnerTrial(ctx, body(), preview.decision.expiresAt);
  assert.equal(calls.length, 1); assert.match(calls[0].path, /trial-context$/);
  assert.deepEqual(prepared.decision, preview.decision); assert.equal(prepared.decisionDigest, preview.decisionDigest);
  assert.equal(Object.isFrozen(prepared.decision), true);
  assert.doesNotMatch(JSON.stringify(prepared), /synthetic-session-not-a-credential/);
  await submitOwnerTrial(ctx, prepared);
  assert.equal(calls.length, 2); assert.equal(calls[1].path, '/api/v2/me/run-requests');
  assert.deepEqual(calls[1].options.body.managedBrowserTrial, { decision: preview.decision, decisionDigest: preview.decisionDigest });
  assert.deepEqual(calls[1].options.body.inputBindings, q.input_bindings);
  assert.equal(calls[1].options.body.requiredMachineId, native.output.machineId);
});

test('old native binding and changed version, catalog, input or runtime evidence cannot be confirmed', async t => {
  clock(t);
  const old = context({ bridge: { managedBrowserTrialRuntime: async () => earlierNative.output } });
  await assert.rejects(prepareOwnerTrial(old.ctx, body(), preview.decision.expiresAt), /context changed/);
  for (const key of ['requestId', 'workflowVersionId', 'expectedCatalogDigest', 'inputBindingsDigest', 'runtimeIdentityDigest']) {
    const changed = { ...preview, decision: { ...preview.decision, [key]: 'changed' } };
    const f = context({ callBackend: async () => changed });
    await assert.rejects(prepareOwnerTrial(f.ctx, body(), preview.decision.expiresAt), /context changed/);
  }
});

test('missing login, account changes and cancellation refuse before any mutation', async t => {
  clock(t);
  for (const override of [{ getSession: async () => null }, { getSession: async () => ({ ...session(), user: { id: 'other' } }) }, { current: () => false }]) {
    const f = context(override); await assert.rejects(prepareOwnerTrial(f.ctx, body(), preview.decision.expiresAt)); assert.equal(f.calls.length, 0);
  }
  let account = target.accountId;
  const f = context({ getSession: async () => ({ ...session(), user: { id: account } }),
    bridge: { managedBrowserTrialRuntime: async () => { account = 'other'; return native.output; } } });
  await assert.rejects(prepareOwnerTrial(f.ctx, body(), preview.decision.expiresAt)); assert.equal(f.calls.length, 0);
});

test('invalid expiry, deferred input, training, wrong machine and changed confirmed input never dispatch', async t => {
  clock(t);
  for (const invalid of [{ ...body(), deferredInputManifest: {} }, { ...body(), trainingTest: {} },
    { ...body(), workflowVersionId: 'other' }, { ...body(), executionMachineId: 'other' }]) {
    const f = context(); await assert.rejects(prepareOwnerTrial(f.ctx, invalid, preview.decision.expiresAt)); assert.equal(f.calls.length, 0);
  }
  for (const expiry of ['', new Date(now).toISOString(), new Date(now + 86400001).toISOString()]) {
    const f = context(); await assert.rejects(prepareOwnerTrial(f.ctx, body(), expiry)); assert.equal(f.calls.length, 0);
  }
  const f = context(), prepared = await prepareOwnerTrial(f.ctx, body(), preview.decision.expiresAt);
  prepared.requestBody.inputBindings.source.sha256 = 'changed';
  await assert.rejects(submitOwnerTrial(f.ctx, prepared)); assert.equal(f.calls.length, 1);
});

test('lost reply, refusal and account switch after dispatch do not retry or report success', async t => {
  clock(t);
  for (const outcome of ['lost', 'refused', 'switched']) {
    let count = 0, account = target.accountId;
    const f = context({ getSession: async () => ({ ...session(), user: { id: account } }), callBackend: async (path: string) => {
      if (path.endsWith('trial-context')) return preview;
      count++; if (outcome === 'lost') throw Error('lost reply');
      if (outcome === 'switched') account = 'other';
      return outcome === 'refused' ? { ok: false } : { ok: true, request: q };
    } });
    const prepared = await prepareOwnerTrial(f.ctx, body(), preview.decision.expiresAt);
    await assert.rejects(submitOwnerTrial(f.ctx, prepared), error => (error as Error).message.includes(q.id)); assert.equal(count, 1);
  }
});

test('expiry before confirmation refuses locally and known no-request refusals retain their typed identity', async t => {
  clock(t); const f = context(), prepared = await prepareOwnerTrial(f.ctx, body(), preview.decision.expiresAt);
  t.mock.method(Date, 'now', () => Date.parse(preview.decision.expiresAt));
  await assert.rejects(submitOwnerTrial(f.ctx, prepared), /expired/); assert.equal(f.calls.length, 1);
  t.mock.method(Date, 'now', () => now);
  for (const refusal of [{ status: 409, body: { setupRequired: { code: 'setup_required' } } },
    { status: 409, body: { needsCapability: { code: 'needs_capability' } } },
    { status: 400, body: { reason: 'managed_browser_trial_invalid' } }]) {
    const known = context({ callBackend: async (path: string) => { if (path.endsWith('trial-context')) return preview; throw refusal; } });
    const ready = await prepareOwnerTrial(known.ctx, body(), preview.decision.expiresAt);
    await assert.rejects(submitOwnerTrial(known.ctx, ready), error => error === refusal);
  }
  for (const ambiguous of [{ status: 500, body: { error: 'enqueue failed' } },
    { status: 400, body: { reason: 'managed_browser_trial_issue_unavailable', requestId: q.id } }]) {
    const unknown = context({ callBackend: async (path: string) => { if (path.endsWith('trial-context')) return preview; throw ambiguous; } });
    const ready = await prepareOwnerTrial(unknown.ctx, body(), preview.decision.expiresAt);
    await assert.rejects(submitOwnerTrial(unknown.ctx, ready), error => (error as Error).message.includes(q.id));
  }
});
