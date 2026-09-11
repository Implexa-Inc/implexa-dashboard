// node --test "app/(dashboard)/_components/setup-required-flow.test.ts"
//
// THE FLOW, end to end in a real DOM: Run click → POST /me/run-admission →
// 409 setupRequired → the modal, IMMEDIATELY, naming the computer and each
// item's state → no request was created → Recheck → admitted → the SAME Run
// proceeds EXACTLY ONCE (one POST /me/run-requests). And: Cancel queues nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

// The shape callBackend's BackendError carries. A plain object with the same
// fields is what the component sees across the harness bundle boundary.
function refusal(body: Record<string, unknown>) { return Object.assign(new Error('Setup required before this agent can run.'), { status: 409, body }); }
import fixture from '../../../test-fixtures/generated/capability-admission.v1.json' with { type: 'json' };

const CARD = (fixture as { scenarios: Record<string, { verdict: { setupRequired: unknown } }> }).scenarios.required_cli_missing.verdict.setupRequired;
const props = { slug: 'visual-evidence-remotion-compositor', name: 'Visual Evidence & Remotion Compositor', isActive: true, workflowVersionId: '33333333-3333-4333-8333-333333333333' };

function backendFor(state: { admitAfter: number; admissionCalls: number; runRequests: Array<Record<string, unknown>>; rechecks: number }) {
  return (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
    if (path.startsWith('/api/v2/agents/') && path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
    if (path.includes('/run-precheck')) return { ok: true, fingerprint: null, duplicate: null };
    if (path === '/api/v2/me/run-admission') {
      state.admissionCalls += 1;
      if (state.admissionCalls <= state.admitAfter) throw refusal({ ok: false, setupRequired: CARD });
      return { ok: true, admitted: true, machine: { id: 'mac-mini-a' }, caTrustMode: 'bundled' };
    }
    if (path === '/api/v2/me/run-requests') {
      state.runRequests.push(init.body || {});
      return { ok: true, request: { id: 'req-1' } };
    }
    return { ok: true };
  };
}

test('required CLI missing: the modal is shown at the click, names the computer, and NO request is created', async () => {
  const state = { admitAfter: 99, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const r = await render('agent-actions.tsx', props, { backend: backendFor(state), bridge: { executionMachineId: async () => 'mac-mini-a' } });
  try {
    await r.click(r.getByText('▶ Run now'));                 // opens the pre-run form
    await r.click(r.getByText('▶ Run now'));                 // submits it
    assert.ok(r.queryByText('Setup required before this agent can run.'), 'the modal title');
    assert.match(r.text(), /Checking: Mac mini \(studio\)/, 'which computer is being checked');
    assert.match(r.text(), /Higgsfield CLI — Not installed/);
    assert.match(r.text(), /Open setup in Implexa/);
    assert.ok(r.queryByText('Recheck'));
    assert.ok(r.queryByText('Cancel'));
    assert.equal(state.admissionCalls, 1);
    assert.equal(state.runRequests.length, 0, 'no run request may exist behind a setup refusal');
    await r.click(r.getByText('Cancel'));
    assert.equal(r.queryByText('Setup required before this agent can run.'), null);
    assert.equal(state.runRequests.length, 0, 'Cancel queues nothing');
  } finally { r.cleanup(); }
});

test('setup then Recheck: the Desktop is asked to re-probe, the backend re-decides, and the ORIGINAL Run proceeds exactly once', async () => {
  const state = { admitAfter: 1, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const r = await render('agent-actions.tsx', props, {
    backend: backendFor(state),
    bridge: { executionMachineId: async () => 'mac-mini-a', recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true }; } },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('▶ Run now'));
    assert.ok(r.queryByText('Setup required before this agent can run.'));
    await r.click(r.getByText('Recheck'));
    await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.equal(state.rechecks, 1, 'Recheck asks the Desktop to re-probe THIS Mac');
    assert.equal(state.admissionCalls, 2, 'the backend decided again — the browser never decided');
    assert.equal(state.runRequests.length, 1, 'exactly one queued run');
    assert.equal(state.runRequests[0].workflowSlug, 'visual-evidence-remotion-compositor');
    assert.equal(state.runRequests[0].executionMachineId, 'mac-mini-a', 'the request names the same machine the admission was proven on');
    assert.equal(state.runRequests[0].kind, 'run');
    assert.equal(r.queryByText('Setup required before this agent can run.'), null, 'the modal closes on admission');
  } finally { r.cleanup(); }
});

test('a setup refusal raised by the request itself (backend re-check at birth) opens the same modal', async () => {
  const state = { admitAfter: 0, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const backend = backendFor(state);
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/v2/me/run-requests') throw refusal({ ok: false, setupRequired: CARD });
      return backend(path, init);
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('▶ Run now'));
    assert.ok(r.queryByText('Setup required before this agent can run.'));
    assert.match(r.text(), /Higgsfield CLI — Not installed/);
  } finally { r.cleanup(); }
});

test('BLOCKER 13: two Recheck clicks in the same tick start exactly ONE admission and continue the Run exactly ONCE', async () => {
  const state = { admitAfter: 0, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  let release: () => void = () => {};
  const gateOpen = new Promise<void>((resolve) => { release = resolve; });
  const base = backendFor(state);
  const r = await render('agent-actions.tsx', props, {
    backend: async (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/v2/me/run-admission') {
        state.admissionCalls += 1;
        if (state.admissionCalls === 1) throw refusal({ ok: false, setupRequired: CARD });
        await gateOpen; // the Recheck admission stays in flight while the second click lands
        return { ok: true, admitted: true, machine: { id: 'mac-mini-a' }, caTrustMode: 'bundled' };
      }
      return base(path, init);
    },
    bridge: { executionMachineId: async () => 'mac-mini-a', recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true }; } },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('▶ Run now'));
    assert.ok(r.queryByText('Setup required before this agent can run.'));
    const recheck = r.getByText('Recheck');
    // Two clicks dispatched synchronously — before React re-renders the
    // disabled button and before any await inside the first handler resolves.
    await r.act(() => {
      recheck.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      recheck.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    release();
    await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.equal(state.rechecks, 1, 'one Desktop re-probe');
    assert.equal(state.admissionCalls, 2, 'the click admission + ONE recheck admission');
    assert.equal(state.runRequests.length, 1, 'the Run continues exactly once');
    assert.equal(state.runRequests[0].executionMachineId, 'mac-mini-a');
  } finally { r.cleanup(); }
});

test('BLOCKER 16: Recheck asks about THE machine the card names — a bridge on another computer is not re-probed, and the request pins that machine', async () => {
  const state = { admitAfter: 1, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const admissions: Array<Record<string, unknown>> = [];
  const base = backendFor(state);
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/v2/me/run-admission') admissions.push(init.body || {});
      return base(path, init);
    },
    // The page runs inside Implexa on a DIFFERENT Mac than the one selected.
    bridge: { executionMachineId: async () => 'mac-studio-b', recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true }; } },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('▶ Run now'));
    assert.match(r.text(), /Checking: Mac mini \(studio\)/);
    await r.click(r.getByText('Recheck'));
    await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.equal(state.rechecks, 0, 'a bridge on another computer cannot re-probe the selected one');
    assert.equal(admissions[1].executionMachineId, 'mac-mini-a', 'the recheck admission names the card’s machine, not the bridge’s');
    assert.equal(state.runRequests[0].executionMachineId, 'mac-mini-a', 'the admitted Run pins the SAME machine');
  } finally { r.cleanup(); }
});

test('BLOCKER 17: focus enters the Setup-required dialog, Tab stays inside it, and Cancel returns focus to the Run control', async () => {
  const state = { admitAfter: 99, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const r = await render('agent-actions.tsx', props, { backend: backendFor(state), bridge: { executionMachineId: async () => 'mac-mini-a' } });
  try {
    await r.click(r.getByText('▶ Run now'));
    const submit = r.getByText('▶ Run now') as HTMLElement;
    submit.focus();
    await r.click(submit);
    const dialog = r.document.querySelector('[role="dialog"]') as HTMLElement;
    assert.ok(dialog, 'the dialog is open');
    assert.ok(dialog.contains(r.document.activeElement), `focus moved into the dialog (active: ${r.document.activeElement?.textContent})`);
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
    const last = focusables[focusables.length - 1];
    last.focus();
    await r.act(() => { r.window.dispatchEvent(new r.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    assert.equal(r.document.activeElement, focusables[0], 'Tab from the last control wraps to the first');
    await r.act(() => { r.window.dispatchEvent(new r.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); });
    assert.equal(r.document.activeElement, last, 'Shift+Tab from the first control wraps to the last');
    await r.click(r.getByText('Cancel'));
    assert.equal(r.document.querySelector('[role="dialog"]'), null);
    assert.ok(r.document.activeElement === submit || r.document.activeElement?.textContent?.includes('Run now'), 'focus returns to the control that opened the dialog');
  } finally { r.cleanup(); }
});
