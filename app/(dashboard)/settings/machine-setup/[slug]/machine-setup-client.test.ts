// node --test "app/(dashboard)/settings/machine-setup/[slug]/machine-setup-client.test.ts"
//
// BLOCKERS 15 / 16 / 17 in a real DOM: every backend setup action is routed
// to an explicit control; the backend's instructions render verbatim; the page
// is pinned to the SELECTED machine (segment), not the bridge's; a failed
// refresh clears any "Ready to run".

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../../../lib/test/render.ts';
import fixture from '../../../../../test-fixtures/generated/capability-admission.v1.json' with { type: 'json' };

type Card = { machine: { id: string; label: string; online: boolean }; items: Array<Record<string, unknown>> };
const CARD = (fixture as { scenarios: Record<string, { verdict: { setupRequired: Card } }> }).scenarios.required_cli_missing.verdict.setupRequired;
const CONTRACT = (fixture as { contract: { value: { requirements: Array<Record<string, unknown>> } } }).contract.value;
const view = { requirements: CONTRACT.requirements.map((req) => ({
  id: req.id, capability_key: req.id, kind: req.kind, required: req.required, label: req.label, fallback: req.fallback || null,
  setup: req.setup as { title: string; instructions: string[]; actions: string[] },
})) };
const COMPONENT = '../settings/machine-setup/[slug]/machine-setup-client.tsx';
const settle = (r: { act: (fn: () => unknown) => Promise<void> }) => r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
// The Recheck BUTTON (notes on the page also mention "Recheck").
const recheckButton = (r: { document: Document }) => Array.from(r.document.querySelectorAll('button')).find((b) => b.textContent === 'Recheck' || b.textContent === 'Rechecking…')!;

function backendFor(state: { reads: string[]; fail?: boolean; admitted?: boolean }) {
  return (path: string) => {
    if (path.startsWith('/api/v2/me/machine-capabilities')) {
      state.reads.push(path);
      if (state.fail) throw new Error('backend unreachable');
      return { ok: true, classified: true, requirements: view, admitted: state.admitted === true, machine: CARD.machine, items: CARD.items, setupRequired: state.admitted ? null : CARD };
    }
    return { ok: true };
  };
}

test('the page reads THE selected machine (segment) — never the bridge’s — and renders every action + the backend instructions', async () => {
  const state = { reads: [] as string[] };
  const calls: Array<[string, unknown]> = [];
  const r = await render(COMPONENT, { slug: 'visual-evidence-remotion-compositor', machineId: 'mac-mini-a' }, {
    backend: backendFor(state),
    bridge: {
      executionMachineId: async () => 'mac-studio-b',
      recheckMachineCapabilities: async () => { calls.push(['recheck', null]); return { ok: true }; },
      installTool: async (key: string) => { calls.push(['installTool', key]); return { ok: false, installUrl: 'https://github.com/higgsfield-ai/cli#readme', message: 'Install it yourself, then Recheck.' }; },
      requestInstallMediaRuntime: async () => { calls.push(['runtime', null]); return { ok: true }; },
      revealPath: async (p: string) => { calls.push(['reveal', p]); return { ok: true }; },
    },
  });
  try {
    await settle(r);
    assert.match(state.reads[0], /machineId=mac-mini-a$/, 'the segment pins the read to the selected machine');
    assert.match(r.text(), /Checking: Mac mini \(studio\)/);
    assert.match(r.text(), /Higgsfield CLI — Not installed/);
    assert.match(r.text(), /Install the Higgsfield CLI so it is on the PATH Implexa gives agents/, 'backend instructions verbatim');
    const actions = Array.from(r.document.querySelectorAll('[data-action]')).map((el) => el.getAttribute('data-action'));
    assert.ok(actions.includes('install_cli'), `install_cli offered: ${actions}`);
    // Only NOT-ready items offer actions; everything else in this scenario is ready.
    assert.deepEqual([...new Set(actions)], ['install_cli']);
    let opened: string | null = null;
    (r.window as unknown as { open: (u: string) => void }).open = (u: string) => { opened = u; };
    await r.click(r.document.querySelector('[data-action="install_cli"]')!);
    await settle(r);
    assert.deepEqual(calls, [['installTool', 'higgsfield']], 'install_cli goes through the Desktop tool registry');
    assert.equal(opened, 'https://github.com/higgsfield-ai/cli#readme', 'no unattended installer → the vendor instructions open; nothing is scripted');
    assert.match(r.text(), /Install it yourself, then Recheck\./);
    await r.click(recheckButton(r));
    await settle(r);
    assert.equal(calls.filter(([k]) => k === 'recheck').length, 0, 'a bridge on ANOTHER computer cannot re-probe the selected one');
    assert.match(r.text(), /checking a different computer than the one Implexa is running on/);
    assert.match(state.reads[1], /machineId=mac-mini-a$/, 'the refresh still reads the selected machine');
  } finally { r.cleanup(); }
});

test('every backend action kind is routed to an explicit control (runtime, media tools, sign-in, free disk)', async () => {
  const state = { reads: [] as string[] };
  const calls: string[] = [];
  const notReady = { ...CARD, items: CARD.items.map((item) => ({ ...item, state: item.id === 'dependency_cache' ? 'ready' : 'missing', stateLabel: 'Not installed' })) };
  const r = await render(COMPONENT, { slug: 'visual-evidence-remotion-compositor', machineId: 'mac-mini-a' }, {
    backend: (path: string) => path.startsWith('/api/v2/me/machine-capabilities')
      ? { ok: true, classified: true, requirements: view, admitted: false, machine: CARD.machine, items: notReady.items, setupRequired: notReady }
      : { ok: true },
    bridge: {
      executionMachineId: async () => 'mac-mini-a',
      recheckMachineCapabilities: async () => { calls.push('recheck'); return { ok: true }; },
      installTool: async (key: string) => { calls.push(`install:${key}`); return { ok: true, installed: true }; },
      requestInstallMediaRuntime: async () => { calls.push('runtime'); return { ok: true }; },
      revealPath: async () => { calls.push('reveal'); return { ok: true }; },
    },
  });
  try {
    await settle(r);
    const actions = new Set(Array.from(r.document.querySelectorAll('[data-action]')).map((el) => el.getAttribute('data-action')));
    assert.deepEqual([...actions].sort(), ['free_disk', 'install_cli', 'install_media_tools', 'install_runtime', 'sign_in_cli']);
    await r.click(r.document.querySelector('[data-action="install_runtime"]')!); await settle(r);
    await r.click(r.document.querySelector('[data-action="install_media_tools"]')!); await settle(r);
    await r.click(r.document.querySelector('[data-action="sign_in_cli"]')!); await settle(r);
    assert.match(r.text(), /Sign in with the vendor’s CLI in a terminal on this computer \(Implexa never captures the credential\)/);
    await r.click(r.document.querySelector('[data-action="free_disk"]')!); await settle(r);
    assert.deepEqual(calls, ['runtime', 'install:ffmpeg', 'reveal']);
    await r.click(recheckButton(r)); await settle(r);
    assert.equal(calls[calls.length - 1], 'recheck', 'same machine → the bridge re-probes');
  } finally { r.cleanup(); }
});

test('BLOCKER 17: a refresh that fails clears any Ready state — never a stale "Ready to run"', async () => {
  const state = { reads: [] as string[], fail: false, admitted: true };
  const r = await render(COMPONENT, { slug: 'visual-evidence-remotion-compositor', machineId: 'mac-mini-a' }, {
    backend: backendFor(state), bridge: { executionMachineId: async () => 'mac-mini-a', recheckMachineCapabilities: async () => ({ ok: true }) },
  });
  try {
    await settle(r);
    assert.ok(r.document.querySelector('[data-testid="machine-setup-ready"]'), 'admitted → Ready to run');
    state.fail = true;
    await r.click(recheckButton(r));
    await settle(r);
    assert.equal(r.document.querySelector('[data-testid="machine-setup-ready"]'), null, 'Ready is gone');
    assert.ok(r.document.querySelector('[data-testid="machine-setup-stale"]'), 'the page says the status could not be refreshed');
    assert.match(r.text(), /Not verified/, 'item states are not shown as current either');
    state.fail = false;
    await r.click(recheckButton(r));
    await settle(r);
    assert.ok(r.document.querySelector('[data-testid="machine-setup-ready"]'), 'a successful refresh restores it');
  } finally { r.cleanup(); }
});

test('GAP 5: opened from a continuation, the page reads the run’s FROZEN version for the selected machine', async () => {
  const state = { reads: [] as string[] };
  const r = await render(COMPONENT, { slug: 'visual-evidence-remotion-compositor', machineId: 'mac-mini-a', workflowVersionId: '33333333-3333-4333-8333-333333333333' }, {
    backend: backendFor(state), bridge: { executionMachineId: async () => 'mac-mini-a', recheckMachineCapabilities: async () => ({ ok: true }) },
  });
  try {
    await settle(r);
    assert.equal(state.reads[0], '/api/v2/me/machine-capabilities?slug=visual-evidence-remotion-compositor&machineId=mac-mini-a&workflowVersionId=33333333-3333-4333-8333-333333333333');
    await r.click(recheckButton(r));
    await settle(r);
    assert.match(state.reads[1], /&workflowVersionId=33333333-3333-4333-8333-333333333333$/, 'Recheck keeps the frozen version');
  } finally { r.cleanup(); }
});
