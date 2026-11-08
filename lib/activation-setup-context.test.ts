import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapActivationChecklist, parseAgentSetupContext, managedToolConnection, optionalBrowserTrialAvailable } from './activation-core.ts';
import type { AgentMacAccess, AgentSetupTarget } from './activation';

const context = { accountId: '11111111-1111-4111-8111-111111111111', versionId: 'installed-v1',
  requiredRouteClass: 'computer_use', requiredGroups: ['browser'], missingRequiredGroups: ['browser'],
  needsBrowser: true, needsComputerUse: true };

test('activation preserves version/account identity without inventing readiness', () => {
  const mapped = mapActivationChecklist({ ok: true, slug: 'video', setupContext: { ...context, ready: true } }, 'video');
  assert.deepEqual(mapped?.setupContext, context);
  assert.equal(Object.hasOwn(mapped!.setupContext!, 'ready'), false);
  assert.equal(mapActivationChecklist({ ok: true }, 'video')?.setupContext, null);
});

test('missing or inconsistent setup identity remains unavailable', () => {
  for (const value of [null, {}, { ...context, accountId: '' }, { ...context, versionId: '' },
    { ...context, requiredRouteClass: 'native' }, { ...context, needsComputerUse: false },
    { ...context, missingRequiredGroups: ['shell'] }, { ...context, requiredGroups: 'browser' }]) {
    assert.equal(parseAgentSetupContext(value), null);
  }
});

test('optional tool badges require a current owner/version native read, not server or legacy reachability alone', () => {
  const target = { accountId: context.accountId, slug: 'video', versionId: context.versionId,
    requiredRouteClass: 'computer_use' } as AgentSetupTarget;
  const report = { ok: true, slug: 'video', context, toolConnections: {
    available: true, machineId: 'this-mac', versionId: target.versionId,
    services: [{ key: 'veed', required: false, domain: 'veed.io', status: 'reachable' }],
  } } as AgentMacAccess;
  assert.equal(managedToolConnection(report, target, 'veed.io')?.status, 'reachable');
  for (const invalid of [null, { ok: true }, { ...report, slug: 'other' },
    { ...report, context: { ...context, accountId: 'other-owner' } },
    { ...report, context: { ...context, versionId: 'newer-version' } },
    { ...report, toolConnections: { ...report.toolConnections, available: false } },
    { ...report, toolConnections: { ...report.toolConnections, versionId: 'old-version' } }]) {
    assert.equal(managedToolConnection(invalid as AgentMacAccess, target, 'veed.io'), null);
  }
  assert.equal(managedToolConnection(report, target, 'other.example'), null);
  assert.equal(managedToolConnection(report, null, 'veed.io'), null);
});

test('an optional browser trial is offered only from the exact ready headless target and native reachable observation', () => {
  const target = { accountId: context.accountId, slug: 'video', versionId: context.versionId,
    requiredRouteClass: 'headless' } as AgentSetupTarget;
  const report = { ok: true, permissionsReady: true, routeResolved: true, slug: 'video',
    context: { ...context, requiredRouteClass: 'headless', needsBrowser: false, needsComputerUse: false },
    toolConnections: { available: true, machineId: 'this-mac', versionId: target.versionId,
      services: [{ key: 'veed', required: false, domain: 'veed.io', status: 'reachable' }] } } as AgentMacAccess;
  assert.equal(optionalBrowserTrialAvailable(report, target), true);
  for (const invalid of [null, { ...report, ok: false }, { ...report, permissionsReady: false },
    { ...report, routeResolved: false }, { ...report, context: { ...report.context, accountId: 'other-owner' } },
    { ...report, context: { ...report.context, needsComputerUse: true } },
    { ...report, context: { ...report.context, needsBrowser: true } },
    { ...report, toolConnections: { ...report.toolConnections, machineId: '' } },
    { ...report, toolConnections: { ...report.toolConnections, available: false } },
    { ...report, toolConnections: { ...report.toolConnections, versionId: 'other-version' } },
    ...['unknown', 'unreachable'].map(status => ({ ...report, toolConnections: { ...report.toolConnections,
      services: [{ ...report.toolConnections!.services[0], status }] } }))]) {
    assert.equal(optionalBrowserTrialAvailable(invalid as AgentMacAccess, target), false);
  }
  assert.equal(optionalBrowserTrialAvailable(report, { ...target, versionId: 'other-version' }), false);
  assert.equal(optionalBrowserTrialAvailable(report, { ...target, requiredRouteClass: 'computer_use' }), false);
  assert.equal(optionalBrowserTrialAvailable(report, null), false);
});
