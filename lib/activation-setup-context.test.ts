import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapActivationChecklist, parseAgentSetupContext } from './activation-core.ts';

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
