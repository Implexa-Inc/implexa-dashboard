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
