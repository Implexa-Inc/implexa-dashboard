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

test('Blocked and Needs setup never render Use agent or Ready, and only Needs setup is actionable', async () => {
  for (const state of ['Blocked', 'Needs setup']) {
    const rendered = await render('agent-resume.tsx', { agent: agent(state) });
    try {
      assert.match(rendered.text(), new RegExp(state));
      if (state === 'Needs setup') assert.match(rendered.text(), /Finish setup/);
      else assert.equal(rendered.queryByText('Finish setup'), null);
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
  const rendered = await render('agent-resume.tsx', { agent: agent('Available', { ownership: 'Owned', primaryAction: 'Use agent', acquisition: null }) });
  try {
    assert.equal(rendered.queryByText('Use agent'), null);
    await rendered.click(rendered.getByText('Finish setup'));
    assert.match(rendered.calls.backend[0].path, /\/acquire$/);
  } finally { rendered.cleanup(); }
});

test('an uncertain retry reuses the first mutation key and a synchronous double click cannot issue twice', async () => {
  let attempts = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const rendered = await render('agent-resume.tsx', { agent: agent('Available') }, {
    backend: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('response was lost');
      await pending;
      return { ok: true };
    },
  });
  try {
    const use = rendered.getByText('Use agent');
    await rendered.click(use);
    assert.equal(rendered.calls.backend.length, 1);
    const firstKey = (rendered.calls.backend[0].init as { body: { idempotencyKey: string } }).body.idempotencyKey;

    await rendered.act(() => {
      use.dispatchEvent(new rendered.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      use.dispatchEvent(new rendered.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    assert.equal(rendered.calls.backend.length, 2, 'the in-flight ref must close the pre-render double-click race');
    const retryKey = (rendered.calls.backend[1].init as { body: { idempotencyKey: string } }).body.idempotencyKey;
    assert.equal(retryKey, firstKey, 'an uncertain exact replay must retain the first writer key');
    release();
    await rendered.act(async () => { await pending; });
  } finally { rendered.cleanup(); }
});

test('changing setup inputs creates a different operation key while an exact retry stays bound', async () => {
  const withOptionalInput = agent('Needs setup', {
    requiredInputs: { version: 1, fields: [{ key: 'topic', label: 'Topic', description: 'Subject', kind: 'text', required: false }] },
  });
  const rendered = await render('agent-resume.tsx', { agent: withOptionalInput });
  try {
    const finish = rendered.getByText('Finish setup');
    await rendered.click(finish);
    await rendered.click(finish);
    const first = (rendered.calls.backend[0].init as { body: { idempotencyKey: string } }).body.idempotencyKey;
    const exactReplay = (rendered.calls.backend[1].init as { body: { idempotencyKey: string } }).body.idempotencyKey;
    assert.equal(exactReplay, first);

    const input = rendered.document.querySelector('#agent-input-topic') as HTMLInputElement;
    await rendered.act(() => {
      const setter = Object.getOwnPropertyDescriptor(rendered.window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'renewal analysis');
      input.dispatchEvent(new rendered.window.Event('input', { bubbles: true }));
      input.dispatchEvent(new rendered.window.Event('change', { bubbles: true }));
    });
    await rendered.click(finish);
    const changed = (rendered.calls.backend[2].init as { body: { idempotencyKey: string; inputBindings: Record<string, string> } }).body;
    assert.equal(changed.inputBindings.topic, 'renewal analysis');
    assert.notEqual(changed.idempotencyKey, first, 'a different durable payload must not replay the old claim');
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

test('Uninstalled acquisition offers reacquisition without contradictory management actions', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent('Available', { acquisition: { id: 'a', pinnedVersionId: 'v', activeVersionId: 'v', lifecycle: 'uninstalled' } }) });
  try {
    assert.ok(rendered.queryByText('Use agent'));
    assert.equal(rendered.queryByText('Disable'), null);
    assert.equal(rendered.queryByText('Enable'), null);
    assert.equal(rendered.queryByText('Remove agent'), null);
  } finally { rendered.cleanup(); }
});

test('free audition discloses buyer-owned provider cost, requires acknowledgment, and opens its exact request', async () => {
  const ready = generated.ready;
  const rendered = await render('agent-resume.tsx', { agent: ready }, {
    backend: async () => ({ ok: true, audition: { requestId: '77777777-7777-4777-8777-777777777777' } }),
  });
  try {
    assert.match(rendered.text(), /1 of 2 free auditions remaining/);
    assert.match(rendered.text(), /provider may charge you for usage/);
    const run = rendered.getByText('Run free audition') as HTMLButtonElement;
    assert.equal(run.disabled, true);
    const acknowledgment = rendered.document.querySelector('input[type="checkbox"]')!;
    await rendered.click(acknowledgment);
    assert.equal(run.disabled, false);
    await rendered.click(run);
    assert.match(rendered.calls.backend[0].path, /\/audition$/);
    assert.equal((rendered.calls.backend[0].init as { body: { providerCostAcknowledged: boolean } }).body.providerCostAcknowledged, true);
    assert.deepEqual(rendered.calls.push, ['/work']);
  } finally { rendered.cleanup(); }
});

test('exhausted audition is visibly unavailable and cannot call the backend', async () => {
  const ready = agent('Ready', {
    audition: { allowance: 1, remaining: 0, providerCostMode: 'buyer_owned', disclosure: 'Buyer-owned provider usage.', eligible: false },
    acquisition: { id: 'installation-1', pinnedVersionId: generated.available.version.id, activeVersionId: generated.available.version.id, lifecycle: 'installed' },
  });
  const rendered = await render('agent-resume.tsx', { agent: ready });
  try {
    const unavailable = rendered.getByText('No free auditions remaining') as HTMLButtonElement;
    assert.equal(unavailable.disabled, true);
    await rendered.click(unavailable);
    assert.equal(rendered.calls.backend.length, 0);
  } finally { rendered.cleanup(); }
});

test('Blocked resume never offers setup, use, or update even when stale update metadata is present', async () => {
  const update = { fromVersion: '1.0.0', toVersion: '2.0.0', authorityDiff: { addedCapabilities: ['github:write'], removedCapabilities: [], addedPermissions: ['source_control_write'], removedPermissions: [], changesAuthority: true, broadensAuthority: true } };
  const rendered = await render('agent-resume.tsx', { agent: agent('Blocked', { update }) });
  try {
    assert.equal(rendered.queryByText('Finish setup'), null);
    assert.equal(rendered.queryByText('Use agent'), null);
    assert.equal(rendered.queryByText('Accept update'), null);
    assert.match(rendered.text(), /cross-vault credential binding/i);
  } finally { rendered.cleanup(); }
});

test('trust channels are complete and malformed hollow evidence is rendered as unknown, never positive', async () => {
  const rendered = await render('agent-resume.tsx', { agent: agent('Available', {
    trust: {
      deterministicVerification: { status: 'evidence_available' },
      judgeReview: { status: 'evidence_available', count: 0 },
      humanAcceptance: { status: 'failed', count: 99 },
    },
  }) });
  try {
    for (const label of ['Deterministic verification', 'Judge review', 'Human acceptance', 'Certification']) assert.ok(rendered.queryByText(label));
    assert.doesNotMatch(rendered.text(), /undefined exact-version/i);
    assert.doesNotMatch(rendered.text(), /99 exact-version/i);
    assert.equal(rendered.queryAllByText(/exact-version evidence record/).length, 0);
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
