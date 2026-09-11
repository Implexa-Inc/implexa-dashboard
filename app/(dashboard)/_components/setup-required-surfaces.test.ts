// node --test "app/(dashboard)/_components/setup-required-surfaces.test.ts"
//
// BLOCKER 14 in a real DOM: every continuation surface that creates a run
// request turns a typed `setup_required` 409 into the modal — no error line,
// no swallowed catch, NO navigation — and Recheck retries the SAME action once.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';
import fixture from '../../../test-fixtures/generated/capability-admission.v1.json' with { type: 'json' };

const CARD = (fixture as { scenarios: Record<string, { verdict: { setupRequired: unknown } }> }).scenarios.required_cli_missing.verdict.setupRequired;
const TITLE = 'Setup required before this agent can run.';
function refusal() { return Object.assign(new Error(TITLE), { status: 409, body: { ok: false, setupRequired: CARD } }); }

/** A backend that refuses the first run-request with setup_required and accepts the next. */
function refuseOnce() {
  const state = { runRequests: [] as Array<Record<string, unknown>>, reviews: 0, others: [] as string[] };
  const backend = (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
    if (path === '/api/v2/me/run-requests') {
      state.runRequests.push(init.body || {});
      if (state.runRequests.length === 1) throw refusal();
      return { ok: true, request: { id: 'req-2' } };
    }
    if (/\/runs\/[^/]+\/review$/.test(path)) { state.reviews += 1; return { ok: true }; }
    // The Recheck pre-admission for a surface that knows its agent slug.
    if (path === '/api/v2/me/run-admission') return { ok: true, admitted: true, machine: { id: 'mac-mini-a' }, caTrustMode: 'bundled' };
    state.others.push(path);
    return { ok: true };
  };
  return { state, backend };
}
const settle = (r: { act: (fn: () => unknown) => Promise<void> }) => r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

test('Approve & finish (run-actions): refusal → modal, no navigation; Recheck retries the same continue once, then navigates', async () => {
  const { state, backend } = refuseOnce();
  const r = await render('run-actions.tsx', { runId: 'run-1', agentName: 'Compositor', reviewStatus: 'pending', holdKind: 'approval_before_action', hasShipStep: true, skillSlug: 'visual-evidence-remotion-compositor' },
    { backend, bridge: { executionMachineId: async () => 'mac-mini-a', recheckMachineCapabilities: async () => ({ ok: true }) } });
  try {
    await r.click(r.getByText('Continue the work'));
    await settle(r);
    assert.ok(r.queryByText(TITLE), 'the modal');
    assert.match(r.text(), /Higgsfield CLI — Not installed/);
    assert.equal(r.calls.push.length, 0, 'no navigation on a refusal');
    assert.equal(r.queryByText('Could not approve. Try again.'), null, 'not an error sentence');
    assert.equal(state.runRequests.length, 1);
    await r.click(r.getByText('Recheck'));
    await settle(r);
    assert.equal(state.runRequests.length, 2, 'the SAME continue is retried exactly once');
    assert.equal(state.runRequests[1].kind, 'continue');
    assert.equal(state.runRequests[1].executionMachineId, 'mac-mini-a', 'on the machine the card named');
    assert.deepEqual(r.calls.push, ['/workflows'], 'navigation happens only after the request exists');
    assert.equal(r.queryByText(TITLE), null);
  } finally { r.cleanup(); }
});

test('Finish this run: refusal → modal, stays on the page, Cancel leaves the button usable', async () => {
  const { state, backend } = refuseOnce();
  const r = await render('finish-run-button.tsx', { runId: 'run-1' }, { backend });
  try {
    await r.click(r.getByText('Finish this run'));
    await settle(r);
    assert.ok(r.queryByText(TITLE));
    assert.equal(r.calls.push.length, 0);
    assert.equal(r.queryByText('Could not queue it. Try again.'), null);
    await r.click(r.getByText('Cancel'));
    assert.equal(r.queryByText(TITLE), null);
    assert.ok(r.queryByText('Finish this run'), 'the button is idle again, not stuck on Queuing…');
    assert.equal(state.runRequests.length, 1);
  } finally { r.cleanup(); }
});

test('Fix now: refusal → modal; the claude:// hop and the /workflows redirect never happen behind a refused enqueue', async () => {
  const { state, backend } = refuseOnce();
  let opened = 0;
  const r = await render('fix-now-button.tsx', { slug: 'visual-evidence-remotion-compositor', name: 'Compositor' }, { backend, bridge: { openAgent: async () => { opened += 1; return { ok: true }; } } });
  try {
    await r.click(r.getByText('Fix now'));
    await settle(r);
    assert.ok(r.queryByText(TITLE));
    assert.equal(r.calls.push.length, 0, 'no redirect to Active Agents — nothing is running');
    assert.equal(opened, 0, 'Claude is not brought forward for a run that does not exist');
    assert.equal(state.runRequests.length, 1);
  } finally { r.cleanup(); }
});

test('Approve & finish (run-claude-actions): refusal → modal; NO fallback to open-Claude, NO review write', async () => {
  const { state, backend } = refuseOnce();
  const r = await render('run-claude-actions.tsx', { runId: 'run-1', agentName: 'Compositor', pending: true }, { backend });
  try {
    const before = r.window.location.href;
    await r.click(r.getByText('Approve & finish'));
    await settle(r);
    assert.ok(r.queryByText(TITLE));
    assert.equal(state.reviews, 0, 'the open-Claude fallback (which approves the run) must not fire on a setup refusal');
    assert.equal(r.window.location.href, before);
    assert.equal(r.queryByText(/Approved\. Finishing hands-off/), null);
  } finally { r.cleanup(); }
});

test('Change how this agent works (revise): refusal → modal, the typed text is kept', async () => {
  const { state, backend } = refuseOnce();
  const r = await render('agent-feedback.tsx', { slug: 'visual-evidence-remotion-compositor' }, { backend });
  try {
    await r.click(r.getByText('Change how this agent works →'));
    const textarea = r.document.querySelector('textarea') as HTMLTextAreaElement;
    await r.act(() => {
      const setter = Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'ask which file is the raw video');
      textarea.dispatchEvent(new r.window.Event('input', { bubbles: true }));
    });
    await r.click(r.getByText('Update the agent'));
    await settle(r);
    assert.ok(r.queryByText(TITLE));
    assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement).value, 'ask which file is the raw video', 'the note survives the refusal');
    assert.equal(state.runRequests.length, 1);
  } finally { r.cleanup(); }
});

const VERSION = '33333333-3333-4333-8333-333333333333';

test('GAP 5 — setup remediation from a continuation with NO slug: "Open setup" goes to the agent + frozen version + machine the backend named, never /this-agent', async () => {
  const { state, backend } = refuseOnce();
  const r = await render('finish-run-button.tsx', { runId: 'run-1' }, {
    backend, bridge: { executionMachineId: async () => 'mac-mini-a', recheckMachineCapabilities: async () => ({ ok: true }) },
  });
  try {
    await r.click(r.getByText('Finish this run'));
    await settle(r);
    assert.ok(r.queryByText(TITLE));
    await r.click(r.getByText('Open setup in Implexa'));
    await settle(r);
    assert.deepEqual(r.calls.push, [`/settings/machine-setup/visual-evidence-remotion-compositor/machine/mac-mini-a/version/${VERSION}`]);
    assert.equal(r.calls.push.some((p) => p.includes('this-agent')), false);
    assert.equal(state.runRequests.length, 1, 'opening setup queues nothing');
  } finally { r.cleanup(); }
});

test('GAP 5 — a continuation whose card names no agent routes from the slug + frozen version its page passed; with neither, it explains instead of navigating', async () => {
  const anonymous = { ...(CARD as Record<string, unknown>), agent: null };
  const refuse = (path: string) => {
    if (path === '/api/v2/me/run-requests') throw Object.assign(new Error(TITLE), { status: 409, body: { ok: false, setupRequired: anonymous } });
    return { ok: true };
  };
  const named = await render('run-continue-box.tsx', { runId: 'run-1', agentName: 'Compositor', slug: 'visual-evidence-remotion-compositor', workflowVersionId: '44444444-4444-4444-8444-444444444444' },
    { backend: refuse, bridge: { executionMachineId: async () => 'mac-mini-a' } });
  try {
    const textarea = named.document.querySelector('textarea') as HTMLTextAreaElement;
    await named.act(() => {
      const setter = Object.getOwnPropertyDescriptor(named.window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'make the hook punchier');
      textarea.dispatchEvent(new named.window.Event('input', { bubbles: true }));
    });
    await named.click(named.getByText('Continue & re-run'));
    await settle(named);
    await named.click(named.getByText('Open setup in Implexa'));
    await settle(named);
    assert.deepEqual(named.calls.push, ['/settings/machine-setup/visual-evidence-remotion-compositor/machine/mac-mini-a/version/44444444-4444-4444-8444-444444444444']);
  } finally { named.cleanup(); }
  const bare = await render('finish-run-button.tsx', { runId: 'run-1' }, { backend: refuse, bridge: { executionMachineId: async () => 'mac-mini-a' } });
  try {
    await bare.click(bare.getByText('Finish this run'));
    await settle(bare);
    await bare.click(bare.getByText('Open setup in Implexa'));
    await settle(bare);
    assert.deepEqual(bare.calls.push, [], 'no agent is known → no navigation at all');
    assert.match(bare.text(), /could not tell which agent this setup is for/);
  } finally { bare.cleanup(); }
});

test('GAP 5 — a continuation Recheck retries its OWN request (the run’s frozen version), not a Run pre-admission of the agent’s current version', async () => {
  const { state, backend } = refuseOnce();
  const r = await render('finish-run-button.tsx', { runId: 'run-1', slug: 'visual-evidence-remotion-compositor', workflowVersionId: VERSION },
    { backend, bridge: { executionMachineId: async () => 'mac-mini-a', recheckMachineCapabilities: async () => ({ ok: true }) } });
  try {
    await r.click(r.getByText('Finish this run'));
    await settle(r);
    await r.click(r.getByText('Recheck'));
    await settle(r);
    assert.equal(r.calls.backend.some((c) => c.path === '/api/v2/me/run-admission'), false, 'no current-version pre-admission for a continuation');
    assert.equal(state.runRequests.length, 2, 'the same continue, retried once');
    assert.equal(state.runRequests[1].executionMachineId, 'mac-mini-a');
    assert.deepEqual(r.calls.push, ['/workflows'], 'navigation only after the request exists');
  } finally { r.cleanup(); }
});

test('GAP 5 — Approve & finish on a TRANSIENT backend failure (5xx, network) fails closed: no Claude hand-off, no approval write, an honest message, the button stays usable', async () => {
  for (const failure of [
    Object.assign(new Error('Internal Server Error'), { status: 503, body: { ok: false, reason: 'capability_admission_unavailable' } }),
    new TypeError('Failed to fetch'),
  ]) {
    const calls = { runRequests: 0, reviews: 0 };
    const backend = (path: string) => {
      if (path === '/api/v2/me/run-requests') { calls.runRequests += 1; throw failure; }
      if (/\/runs\/[^/]+\/review$/.test(path)) { calls.reviews += 1; return { ok: true }; }
      return { ok: true };
    };
    const r = await render('run-claude-actions.tsx', { runId: 'run-1', agentName: 'Compositor', pending: true }, { backend });
    try {
      const before = r.window.location.href;
      await r.click(r.getByText('Approve & finish'));
      await settle(r);
      assert.equal(calls.reviews, 0, `${failure.message}: the run is NOT marked approved`);
      assert.equal(r.window.location.href, before, `${failure.message}: Claude is not opened`);
      assert.ok(r.document.querySelector('[role="alert"]'), `${failure.message}: the failure is shown`);
      assert.equal(r.queryByText(/Approved\. Finishing hands-off/), null);
      const button = r.getByText('Approve & finish') as HTMLButtonElement;
      assert.equal(button.disabled, false, 'the user can try again');
      await r.click(button);
      await settle(r);
      assert.equal(calls.runRequests, 2, 'a retry queues through the hands-off path again');
      assert.equal(calls.reviews, 0);
    } finally { r.cleanup(); }
  }
});

test('Continue preserved work (managed continuation, main #229): refusal → modal, no navigation, no error line; Recheck retries the same continuation once', async () => {
  const { state, backend } = refuseOnce();
  const r = await render('preserved-work-continuation.tsx', { runId: 'run-1', slug: 'visual-evidence-remotion-compositor', workflowVersionId: VERSION },
    { backend, bridge: { executionMachineId: async () => 'mac-mini-a', recheckMachineCapabilities: async () => ({ ok: true }) } });
  try {
    await r.click(r.getByText('Continue preserved work'));
    await settle(r);
    assert.ok(r.queryByText(TITLE), 'the modal');
    assert.equal(r.document.querySelector('p[role="alert"]'), null, 'not an error sentence');
    assert.equal(r.calls.push.length, 0, 'no navigation on a refusal');
    assert.ok(r.queryByText('Continue preserved work'), 'the button is idle again');
    await r.click(r.getByText('Recheck'));
    await settle(r);
    assert.equal(state.runRequests.length, 2);
    assert.equal(state.runRequests[1].kind, 'continue');
    assert.match(String(state.runRequests[1].note), /Desktop-validated preserved work/, 'the same continuation, same intent');
    assert.equal(state.runRequests[1].executionMachineId, 'mac-mini-a');
    assert.deepEqual(r.calls.push, ['/workflows']);
  } finally { r.cleanup(); }
});
