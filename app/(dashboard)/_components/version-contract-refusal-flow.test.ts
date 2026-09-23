// node --test "app/(dashboard)/_components/version-contract-refusal-flow.test.ts"
//
// THE PRODUCTION CASE (Planner v26, 2026-09-22): the owner clicked Run, the
// pre-run admission check refused because the AGENT VERSION had no machine
// contract, and the card showed only "Request failed (409)". That refusal is
// about the version, not this computer, so Setup cannot fix it. These drive the
// real Run click in a real DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const REASON = 'deterministic_project_machine_capability_required';
const VERSION = '33333333-3333-4333-8333-333333333333';
const props = { slug: 'visual-treatment-planner-runway-remotion', name: 'Visual Treatment Planner', isActive: true, workflowVersionId: VERSION };

// Exactly what callBackend throws: its message is `body.error`, or
// "Request failed (409)" when the body carries no sentence.
function backendError(body: Record<string, unknown>) {
  return Object.assign(new Error(typeof body.error === 'string' ? body.error : 'Request failed (409)'), { status: 409, body });
}

function readyTrainingHome() {
  return { ok: true, home: {
    agent: { currentVersionId: VERSION },
    successorProjection: { contractVersion: 'agent-training-successor-projection.v1', activeVersionId: VERSION, eligiblePredecessor: null },
    managerTrainingRequirements: { contractVersion: 'manager-reference-training-readiness.v1', scope: 'workflow_version_quality_references',
      workflowVersionId: VERSION, classified: false, requiredPairs: [], fulfilledPairs: [], missingPairs: [], readiness: 'not_applicable', reason: null },
  } };
}

function backendFor(state: { refusals: Array<Record<string, unknown>>; admissionCalls: number; runRequests: Array<Record<string, unknown>> }) {
  return (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
    if (path.startsWith('/api/v2/agent-training/agents/')) return readyTrainingHome();
    if (path.startsWith('/api/v2/agents/') && path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
    if (path.includes('/run-precheck')) return { ok: true, fingerprint: null, duplicate: null };
    if (path === '/api/v2/me/run-admission') {
      state.admissionCalls += 1;
      const refusal = state.refusals.shift();
      if (refusal) throw backendError(refusal);
      return { ok: true, admitted: true, machine: { id: 'mac-mini-a' }, caTrustMode: 'bundled' };
    }
    if (path === '/api/v2/me/run-requests') {
      state.runRequests.push(init.body || {});
      return { ok: true, request: { id: 'req-1' } };
    }
    return { ok: true };
  };
}

async function clickRun(r: Awaited<ReturnType<typeof render>>) {
  await r.click(r.getByText('▶ Run now'));   // opens the pre-run form
  await r.click(r.getByText('▶ Run now'));   // submits it
}

test('a version published without its machine contract: a precise modal, never "Request failed (409)", nothing queued', async () => {
  const state = { admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, refusals: [{
    ok: false, reason: REASON, cause: 'machine_capability_contract_missing', retrySafe: false, workflowVersionId: VERSION,
    error: 'This version of the agent was published without its machine requirements, so Implexa cannot check this computer for it. Revise the agent to publish a complete version. Nothing was queued.',
  }] };
  const r = await render('agent-actions.tsx', props, { backend: backendFor(state), bridge: { executionMachineId: async () => 'mac-mini-a' } });
  try {
    await clickRun(r);
    assert.ok(r.queryByText('This agent version is incomplete'), 'the modal title names the VERSION');
    assert.match(r.text(), /published without its machine requirements/);
    assert.match(r.text(), /Setup on this computer cannot fix this\. Use Edit Agent/);
    assert.doesNotMatch(r.text(), /Request failed \(409\)/);
    // Setup cannot fix a version defect, so no Setup action is offered, and a
    // retry cannot help, so there is none either.
    assert.equal(r.queryByText('Recheck'), null);
    assert.equal(r.queryByText('Open setup in Implexa'), null);
    assert.equal(r.queryByText('Try again'), null);
    assert.equal(state.runRequests.length, 0, 'no run request may exist behind the refusal');
    await r.click(r.getByText('Close'));
    assert.equal(r.queryByText('This agent version is incomplete'), null);
    assert.equal(state.runRequests.length, 0, 'Close queues nothing');
  } finally { r.cleanup(); }
});

test('an older backend that sends only the reason still gets a precise sentence, not the status code', async () => {
  // The literal production body: { ok:false, reason } and nothing else.
  const state = { admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, refusals: [{ ok: false, reason: REASON }] };
  const r = await render('agent-actions.tsx', props, { backend: backendFor(state), bridge: { executionMachineId: async () => 'mac-mini-a' } });
  try {
    await clickRun(r);
    assert.ok(r.queryByText('This agent version is incomplete'));
    assert.match(r.text(), /cannot be checked against any computer\. Revise the agent/);
    assert.doesNotMatch(r.text(), /Request failed \(409\)/);
    assert.equal(state.runRequests.length, 0);
  } finally { r.cleanup(); }
});

test('an unreadable read is the one case worth retrying: Try again re-asks, and the Run proceeds exactly once', async () => {
  const state = { admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, refusals: [{
    ok: false, reason: REASON, cause: 'machine_capability_authority_unreadable', retrySafe: true, workflowVersionId: VERSION,
    error: 'Implexa could not read this agent version’s requirements. Try again; nothing was queued.',
  }] };
  const r = await render('agent-actions.tsx', props, { backend: backendFor(state), bridge: { executionMachineId: async () => 'mac-mini-a' } });
  try {
    await clickRun(r);
    assert.ok(r.queryByText('Couldn’t read this agent version'));
    assert.equal(r.queryByText('This agent version is incomplete'), null);
    await r.click(r.getByText('Try again'));
    await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.equal(state.admissionCalls, 2, 'the backend decided again');
    assert.equal(state.runRequests.length, 1, 'exactly one queued run');
    assert.equal(r.queryByText('Couldn’t read this agent version'), null, 'the modal closes');
  } finally { r.cleanup(); }
});
