// node --test lib/setup-required.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
class BackendError extends Error { status: number; body: unknown; constructor(m: string, status: number, body: unknown) { super(m); this.status = status; this.body = body; } }
import { parseSetupRequired, setupRequiredFromBody, setupReasonCopy, machineCopy, blockingItems, machineSetupPath, appMachineSetupUrl, parseSetupScope, setupTargetFor } from './setup-required.ts';
import fixture from '../test-fixtures/generated/capability-admission.v1.json' with { type: 'json' };

const scenario = (name: string) => (fixture as { scenarios: Record<string, { verdict: { ok: boolean; setupRequired?: unknown } }> }).scenarios[name];

test('a 409 with the typed card parses; any other error, status or body does not', () => {
  const card = scenario('required_cli_missing').verdict.setupRequired;
  const parsed = parseSetupRequired(new BackendError('Setup required', 409, { ok: false, setupRequired: card }));
  assert.ok(parsed);
  assert.equal(parsed!.title, 'Setup required before this agent can run.');
  assert.equal(parsed!.items.find((i) => i.id === 'higgsfield_cli')!.stateLabel, 'Not installed');
  assert.equal(parseSetupRequired(new BackendError('x', 400, { setupRequired: card })), null, 'only 409');
  assert.equal(parseSetupRequired(new BackendError('x', 409, { needsCapability: {} })), null, 'the capability card is a different refusal');
  assert.equal(parseSetupRequired(new Error('network')), null);
  assert.equal(setupRequiredFromBody({ setupRequired: { code: 'nope', items: [] } }), null, 'the discriminator is exact');
  assert.equal(setupRequiredFromBody({ setupRequired: { code: 'setup_required' } }), null, 'items must be an array');
});

test('the modal copy names WHICH computer is checked and why, from the backend’s closed reason set', () => {
  const missing = parseSetupRequired(new BackendError('x', 409, { setupRequired: scenario('required_cli_missing').verdict.setupRequired }))!;
  assert.equal(machineCopy(missing), 'Mac mini (studio)');
  assert.match(setupReasonCopy(missing), /Set them up, then Recheck to continue the same run/);
  const offline = parseSetupRequired(new BackendError('x', 409, { setupRequired: scenario('machine_offline').verdict.setupRequired }))!;
  assert.equal(machineCopy(offline), 'Mac mini (studio) (offline)');
  assert.match(setupReasonCopy(offline), /has not reported to Implexa/);
  const foreign = parseSetupRequired(new BackendError('x', 409, { setupRequired: scenario('cli_on_mac_a_selected_mac_b').verdict.setupRequired }))!;
  assert.equal(machineCopy(foreign), 'MacBook Pro', 'the SELECTED machine, not the one that happens to be ready');
  assert.match(setupReasonCopy(foreign), /belongs to a different computer/);
  const stale = parseSetupRequired(new BackendError('x', 409, { setupRequired: scenario('stale_attestation').verdict.setupRequired }))!;
  assert.match(setupReasonCopy(stale), /expired/);
});

test('blocking items are REQUIRED and not ready; optional fallbacks never block; states render as their customer-safe labels', () => {
  for (const [name, id, label] of [
    ['required_cli_missing', 'higgsfield_cli', 'Not installed'],
    ['cli_not_executable', 'higgsfield_cli', 'Installed but not runnable'],
    ['cli_unsupported_version', 'higgsfield_cli', 'Unsupported version'],
    ['cli_unauthenticated', 'higgsfield_auth', 'Not connected'],
    ['kling_model_unavailable', 'higgsfield_model_access', 'Required model access not verified'],
    ['registry_tls_neither_mode', 'npm_registry_tls', 'Secure connection failed'],
    ['node_env_var_present_but_unsupported', 'managed_node_runtime', 'Unsupported version'],
  ] as const) {
    const card = parseSetupRequired(new BackendError('x', 409, { setupRequired: scenario(name).verdict.setupRequired }))!;
    const blocking = blockingItems(card);
    assert.deepEqual(blocking.map((i) => i.id), [id], name);
    assert.equal(blocking[0].stateLabel, label, name);
  }
  assert.equal(scenario('optional_cache_fallback').verdict.ok, true, 'an optional capability with a fallback never raises the card');
  const mixed = parseSetupRequired(new BackendError('x', 409, { setupRequired: scenario('required_cli_missing').verdict.setupRequired }))!;
  mixed.items = mixed.items.map((i) => (i.id === 'dependency_cache' ? { ...i, required: false, state: 'degraded', stateLabel: 'Available with limits' } : i));
  assert.deepEqual(blockingItems(mixed).map((i) => i.id), ['higgsfield_cli'], 'an optional item that is not ready is listed but never blocks');
  assert.equal(scenario('registry_tls_bundled_passes_system_fails').verdict.ok, true, 'bundled trust passing means no modal, even though system trust failed');
});

const VERSION = '33333333-3333-4333-8333-333333333333';

test('"Open setup in Implexa" routes by named path segments only — the app’s deep-link router drops query strings', () => {
  assert.equal(machineSetupPath('visual-evidence-remotion-compositor'), '/settings/machine-setup/visual-evidence-remotion-compositor');
  assert.equal(appMachineSetupUrl('a b'), 'implexa://settings/machine-setup/a%20b');
  assert.equal(machineSetupPath('slug', { machineId: 'mac-mini-a' }), '/settings/machine-setup/slug/machine/mac-mini-a');
  assert.equal(machineSetupPath('slug', { machineId: 'mac-mini-a', workflowVersionId: VERSION }), `/settings/machine-setup/slug/machine/mac-mini-a/version/${VERSION}`);
  assert.equal(appMachineSetupUrl('slug', { workflowVersionId: VERSION }), `implexa://settings/machine-setup/slug/version/${VERSION}`);
  assert.equal(machineSetupPath('slug', { machineId: 'mac mini/../a', workflowVersionId: 'v1' }), '/settings/machine-setup/slug', 'malformed scope is dropped, never encoded into a path');
});

test('the setup route parses exactly machine/<id> and version/<uuid>; anything else is a 404, never a guess', () => {
  assert.deepEqual(parseSetupScope(undefined), { machineId: null, workflowVersionId: null });
  assert.deepEqual(parseSetupScope(['machine', 'mac-mini-a']), { machineId: 'mac-mini-a', workflowVersionId: null });
  assert.deepEqual(parseSetupScope(['version', VERSION, 'machine', 'mac%3Amini']), { machineId: 'mac:mini', workflowVersionId: VERSION });
  for (const bad of [['mac-mini-a'], ['machine'], ['machine', 'a b'], ['version', 'not-a-uuid'], ['host', 'x'], ['machine', 'a', 'machine', 'b'], ['machine', 'a', 'version', VERSION, 'x', 'y']]) {
    assert.equal(parseSetupScope(bad), null, JSON.stringify(bad));
  }
});

test('GAP 5: setup is routed to the REAL agent and frozen version — the surface’s own, else the one the backend named on the card; never a guessed slug', () => {
  const card = parseSetupRequired(new BackendError('x', 409, { setupRequired: scenario('required_cli_missing').verdict.setupRequired }))!;
  assert.deepEqual(card.agent, { slug: 'visual-evidence-remotion-compositor', workflow_version_id: VERSION }, 'the backend names the agent + frozen version on every card');
  const fromCard = setupTargetFor(card, {});
  assert.equal(fromCard!.path, `/settings/machine-setup/visual-evidence-remotion-compositor/machine/mac-mini-a/version/${VERSION}`, 'a continuation with no slug of its own');
  const own = setupTargetFor({ ...card, agent: null }, { slug: 'my-agent', workflowVersionId: '44444444-4444-4444-8444-444444444444' });
  assert.equal(own!.path, '/settings/machine-setup/my-agent/machine/mac-mini-a/version/44444444-4444-4444-8444-444444444444');
  assert.equal(setupTargetFor({ ...card, agent: null }, {}), null, 'nothing names the agent → no target, never /this-agent');
  assert.equal(setupTargetFor({ ...card, agent: { slug: '../etc', workflow_version_id: null } }, {}), null);
  const hostile = setupRequiredFromBody({ setupRequired: { ...(scenario('required_cli_missing').verdict.setupRequired as object), agent: { slug: '../../x', workflow_version_id: 'zzz' } } })!;
  assert.equal(hostile.agent, null, 'a malformed identity is dropped at parse time');
});
