import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';
import generated from '../../../test-fixtures/generated/agent-marketplace-slice1.json' with { type: 'json' };

function agent(state: string, extra: Record<string, unknown> = {}) {
  const producer = state === 'Blocked' ? generated.blocked : state === 'Needs setup' ? generated.needsSetup : generated.available;
  return {
    ...producer,
    ownership: state === 'Available' ? 'Available' : 'Hired',
    readiness: { state, reason: state === 'Blocked' ? 'Structured execution remains disabled until cross-vault credential binding is reviewed.' : state === 'Needs setup' ? 'Required integrations have not been verified.' : null },
    primaryAction: state === 'Available' || state === 'Ready' ? 'Use agent' : 'Finish setup',
    ...extra,
  };
}

test('Available resume renders flat evidence and Use agent acquires the exact version', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent('Available') });
  try {
    assert.match(rendered.text(), /Available/); assert.ok(rendered.queryByText('Deterministic verification')); assert.ok(rendered.queryByText('1 exact-version evidence record'));
    assert.doesNotMatch(rendered.text(), /Ready/);
    const button = rendered.getByText('Use agent'); assert.equal(button.tagName, 'BUTTON');
    await rendered.click(button);
    assert.equal(rendered.calls.backend[0].path, `/api/v2/agents/discovery/${generated.available.id}/acquire`);
    assert.equal((rendered.calls.backend[0].init as { body: { versionId: string } }).body.versionId, generated.available.version.id);
  } finally { rendered.cleanup(); }
});

test('Blocked and Needs setup never render Use agent or Ready', async () => {
  for (const state of ['Blocked', 'Needs setup']) {
    const rendered = await render('agent-resume.tsx', { agent: agent(state) });
    try {
      assert.match(rendered.text(), new RegExp(state)); assert.match(rendered.text(), /Finish setup/);
      assert.equal(rendered.queryByText('Use agent'), null); assert.doesNotMatch(rendered.text(), /\bReady\b/);
      assert.ok(rendered.document.querySelector('[role="status"]'));
    } finally { rendered.cleanup(); }
  }
});

test('authority-broadening update is keyboard-focusable and disabled until checked', async () => {
  const update = { fromVersion: '1.0.0', toVersion: '2.0.0', authorityDiff: { addedCapabilities: ['github:write'], removedCapabilities: [], addedPermissions: ['source_control_write'], removedPermissions: [], changesAuthority: true, broadensAuthority: true } };
  const rendered = await render('agent-resume.tsx', { agent: agent('Update available', { update, acquisition: { id: 'a', pinnedVersionId: 'old', activeVersionId: 'old', lifecycle: 'installed' } }) });
  try {
    assert.match(rendered.text(), /Added capabilities: github:write/); assert.match(rendered.text(), /Added permissions: source_control_write/);
    const accept = rendered.getByText('Accept update') as HTMLButtonElement;
    assert.equal(accept.disabled, true); assert.equal(accept.tabIndex, 0);
    const checkbox = rendered.document.querySelector('input[type="checkbox"]')!;
    await rendered.click(checkbox); assert.equal(accept.disabled, false);
  } finally { rendered.cleanup(); }
});

test('Owned agent without an acquisition offers setup and acquires before it can run', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent('Available', { ownership: 'Owned', primaryAction: 'Finish setup', acquisition: null }) });
  try {
    assert.equal(rendered.queryByText('Use agent'), null);
    await rendered.click(rendered.getByText('Finish setup'));
    assert.match(rendered.calls.backend[0].path, /\/acquire$/);
  } finally { rendered.cleanup(); }
});

test('Disabled resume has no contradictory Use action and management removal is confirmed', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent('Disabled', { acquisition: { id: 'a', pinnedVersionId: 'v', activeVersionId: 'v', lifecycle: 'disabled' } }) });
  try {
    assert.equal(rendered.queryByText('Use agent'), null); assert.ok(rendered.queryByText('Enable'));
    const remove = rendered.getByText('Remove agent') as HTMLButtonElement; assert.equal(remove.disabled, true);
    assert.match(rendered.text(), /Prior runs, receipts, reviews, learning evidence, and version provenance stay intact/);
  } finally { rendered.cleanup(); }
});

test('mutation errors remain visible and empty requirement states are explicit', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent('Available') }, { backend: () => { throw new Error('Acquisition unavailable'); } });
  try {
    assert.match(rendered.text(), /No per-run inputs declared/); assert.match(rendered.text(), /Connect source control/);
    await rendered.click(rendered.getByText('Use agent'));
    assert.ok(rendered.document.querySelector('[role="alert"]')); assert.match(rendered.text(), /The agent could not be updated/);
  } finally { rendered.cleanup(); }
});
