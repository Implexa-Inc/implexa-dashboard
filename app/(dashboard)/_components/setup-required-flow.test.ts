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
async function boundedSignal(signal: Promise<void>, label: string) {
  await Promise.race([
    signal,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} was not reached`)), 500)),
  ]);
}
import fixture from '../../../test-fixtures/generated/capability-admission.v1.json' with { type: 'json' };

const CARD = (fixture as { scenarios: Record<string, { verdict: { setupRequired: unknown } }> }).scenarios.required_cli_missing.verdict.setupRequired;
const OFFLINE_CARD = (fixture as { scenarios: Record<string, { verdict: { setupRequired: unknown } }> }).scenarios.machine_offline.verdict.setupRequired;
const props = { slug: 'visual-evidence-remotion-compositor', name: 'Visual Evidence & Remotion Compositor', isActive: true, workflowVersionId: '33333333-3333-4333-8333-333333333333' };

function probeOnlyCard() {
  const card = JSON.parse(JSON.stringify(CARD)) as { items: Array<Record<string, unknown>> } & Record<string, unknown>;
  card.items = card.items.map((item) => item.id === 'higgsfield_cli'
    ? { ...item, state: 'ready', stateLabel: 'Ready', reason: 'ready' }
    : item.id === 'higgsfield_auth'
      ? { ...item, state: 'probe_failed', stateLabel: 'Could not be checked', reason: 'probe_failed' }
      : item);
  return card;
}

function readyTrainingHome() {
  return { ok: true, home: {
    agent: { currentVersionId: props.workflowVersionId },
    successorProjection: { contractVersion: 'agent-training-successor-projection.v1', activeVersionId: props.workflowVersionId, eligiblePredecessor: null },
    managerTrainingRequirements: { contractVersion: 'manager-reference-training-readiness.v1', scope: 'workflow_version_quality_references',
      workflowVersionId: props.workflowVersionId, classified: false, requiredPairs: [], fulfilledPairs: [], missingPairs: [], readiness: 'not_applicable', reason: null },
  } };
}

function backendFor(state: { admitAfter: number; admissionCalls: number; runRequests: Array<Record<string, unknown>>; rechecks: number }) {
  return (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
    if (path.startsWith('/api/v2/agent-training/agents/')) return readyTrainingHome();
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

test('a probe-only request-birth race rechecks this exact Desktop once and replays the immutable submission once', async () => {
  const state = { admitAfter: 0, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const base = backendFor(state);
  let births = 0;
  let created = 0;
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/v2/me/run-requests') {
        births += 1;
        state.runRequests.push(init.body || {});
        if (births === 1) throw refusal({ ok: false, setupRequired: probeOnlyCard() });
        created += 1;
        return { ok: true, request: { id: 'req-recovered' } };
      }
      return base(path, init);
    },
    bridge: {
      executionMachineId: async () => 'mac-mini-a',
      recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true, machineId: 'mac-mini-a' }; },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('▶ Run now'));
    await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.equal(state.rechecks, 1, 'one fresh Desktop attestation');
    assert.equal(births, 2, 'one original birth and one replay');
    assert.equal(created, 1, 'only the replay created a request');
    assert.strictEqual(state.runRequests[1], state.runRequests[0], 'the exact frozen body object is replayed');
    assert.equal(state.runRequests[0].executionMachineId, 'mac-mini-a');
    assert.equal(r.queryByText('Setup required before this agent can run.'), null, 'a repaired race is hands-off');
  } finally { r.cleanup(); }
});

test('an exact-local offline pre-admission is refreshed once and creates exactly one request', async () => {
  const state = { admitAfter: 0, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const base = backendFor(state);
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/v2/me/run-admission') {
        state.admissionCalls += 1;
        if (state.admissionCalls === 1) throw refusal({ ok: false, setupRequired: OFFLINE_CARD });
        return { ok: true, admitted: true, machine: { id: 'mac-mini-a' }, caTrustMode: 'bundled' };
      }
      if (path === '/api/v2/me/run-requests') {
        state.runRequests.push(init.body || {});
        return { ok: true, request: { id: 'req-offline-recovered' } };
      }
      return base(path, init);
    },
    bridge: {
      executionMachineId: async () => 'mac-mini-a',
      recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true, machineId: 'mac-mini-a' }; },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('▶ Run now'));
    assert.equal(state.rechecks, 1, 'one exact-local presence/readiness refresh');
    assert.equal(state.admissionCalls, 2, 'backend alone re-decides readiness after refresh');
    assert.equal(state.runRequests.length, 1, 'one durable request birth');
    assert.equal(state.runRequests[0].executionMachineId, 'mac-mini-a');
    assert.equal(r.queryByText('Setup required before this agent can run.'), null);
  } finally { r.cleanup(); }
});

test('an exact-local offline request-birth refusal re-admits then replays the exact frozen body', async () => {
  const state = { admissions: [] as Array<Record<string, unknown>>, births: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string, init: { body?: Record<string, unknown> }) => {
      if (path.startsWith('/api/v2/agent-training/agents/')) return readyTrainingHome();
      if (path.startsWith('/api/v2/agents/') && path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
      if (path.includes('/run-precheck')) return { ok: true, fingerprint: 'birth-fingerprint', duplicate: null };
      if (path === '/api/v2/me/run-admission') {
        state.admissions.push(init.body || {});
        return { ok: true, admitted: true, machine: { id: 'mac-mini-a' } };
      }
      if (path === '/api/v2/me/run-requests') {
        state.births.push(init.body || {});
        if (state.births.length === 1) throw refusal({ ok: false, setupRequired: OFFLINE_CARD });
        return { ok: true, request: { id: 'req-birth-recovered' } };
      }
      return { ok: true };
    },
    bridge: {
      executionMachineId: async () => 'mac-mini-a',
      recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true, machineId: 'mac-mini-a' }; },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('▶ Run now'));
    assert.equal(state.admissions.length, 2, 'initial admission and one post-refresh re-admission');
    assert.deepEqual(state.admissions[1], state.admissions[0], 're-admission keeps slug, version, and machine identical');
    assert.equal(state.rechecks, 1);
    assert.equal(state.births.length, 2, 'one typed no-birth refusal and one replay');
    assert.strictEqual(state.births[1], state.births[0], 'the exact frozen object is replayed');
    assert.equal(state.births[0].inputFingerprint, 'birth-fingerprint');
  } finally { r.cleanup(); }
});

test('offline request-birth recovery fails closed after its single replay', async (t) => {
  const cases = [
    { name: 'second typed refusal', second: 'offline' },
    { name: 'second birth network error', second: 'network' },
    { name: 'second birth backend error', second: 'server' },
    { name: 'second birth ambiguous success', second: 'ambiguous' },
  ] as const;
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const state = { births: 0, rechecks: 0 };
    const r = await render('agent-actions.tsx', props, {
      backend: (path: string) => {
        if (path.startsWith('/api/v2/agent-training/agents/')) return readyTrainingHome();
        if (path.startsWith('/api/v2/agents/') && path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
        if (path.includes('/run-precheck')) return { ok: true, fingerprint: null, duplicate: null };
        if (path === '/api/v2/me/run-admission') return { ok: true, admitted: true, machine: { id: 'mac-mini-a' } };
        if (path === '/api/v2/me/run-requests') {
          state.births += 1;
          if (state.births === 1 || scenario.second === 'offline') throw refusal({ ok: false, setupRequired: OFFLINE_CARD });
          if (scenario.second === 'network') throw new Error('network unavailable');
          if (scenario.second === 'server') throw Object.assign(new Error('server unavailable'), { status: 503, body: { ok: false } });
          return { ok: false };
        }
        return { ok: true };
      },
      bridge: {
        executionMachineId: async () => 'mac-mini-a',
        recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true, machineId: 'mac-mini-a' }; },
      },
    });
    try {
      await r.click(r.getByText('▶ Run now'));
      await r.click(r.getByText('▶ Run now'));
      await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      assert.equal(state.rechecks, 1);
      assert.equal(state.births, 2, 'one refused birth and one replay only');
      assert.ok(r.queryByText('Setup required before this agent can run.'), 'the original typed offline refusal remains visible');
    } finally { r.cleanup(); }
  });
});

test('offline automatic recovery is visible and same-tick duplicate submits share one flight', async () => {
  const state = { admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  let releaseRefresh!: () => void;
  let markRefreshStarted!: () => void;
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string, init: { body?: Record<string, unknown> }) => {
      if (path.startsWith('/api/v2/agent-training/agents/')) return readyTrainingHome();
      if (path.startsWith('/api/v2/agents/') && path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
      if (path.includes('/run-precheck')) return { ok: true, fingerprint: 'frozen-fingerprint', duplicate: null };
      if (path === '/api/v2/me/run-admission') {
        state.admissionCalls += 1;
        if (state.admissionCalls === 1) throw refusal({ ok: false, setupRequired: OFFLINE_CARD });
        return { ok: true, admitted: true, machine: { id: 'mac-mini-a' } };
      }
      if (path === '/api/v2/me/run-requests') {
        state.runRequests.push(init.body || {});
        return { ok: true, request: { id: 'req-one-flight' } };
      }
      return { ok: true };
    },
    bridge: {
      executionMachineId: async () => 'mac-mini-a',
      recheckMachineCapabilities: async () => {
        state.rechecks += 1;
        markRefreshStarted();
        await refreshGate;
        return { ok: true, machineId: 'mac-mini-a' };
      },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    const submit = r.getByText('▶ Run now');
    await r.act(() => {
      submit.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      submit.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await boundedSignal(refreshStarted, 'offline refresh');
    assert.match(r.text(), /Rechecking this Mac/);
    releaseRefresh();
    await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.equal(state.rechecks, 1);
    assert.equal(state.admissionCalls, 2);
    assert.equal(state.runRequests.length, 1);
  } finally { r.cleanup(); }
});

test('offline recovery fails closed for remote/missing bridges, failed or foreign refresh, and ambiguous re-admission', async (t) => {
  const cases = [
    { name: 'no local bridge identity', ids: [] as string[], refresh: null, second: 'pass', admissions: 1, rechecks: 0 },
    { name: 'missing admission-refresh bridge method', ids: ['mac-mini-a'], refresh: null, second: 'pass', admissions: 1, rechecks: 0 },
    { name: 'second bridge identity read throws', ids: ['mac-mini-a'], refresh: 'identity-throws', second: 'pass', admissions: 1, rechecks: 0 },
    { name: 'bridge changed to another machine', ids: ['mac-mini-a', 'mac-studio-b'], refresh: 'pass', second: 'pass', admissions: 1, rechecks: 0 },
    { name: 'refresh failed', ids: ['mac-mini-a'], refresh: 'fail', second: 'pass', admissions: 1, rechecks: 1 },
    { name: 'refresh omitted its machine identity', ids: ['mac-mini-a'], refresh: 'identity-omitted', second: 'pass', admissions: 1, rechecks: 1 },
    { name: 'refresh response named another machine', ids: ['mac-mini-a'], refresh: 'foreign', second: 'pass', admissions: 1, rechecks: 1 },
    { name: 'second typed refusal', ids: ['mac-mini-a'], refresh: 'pass', second: 'offline', admissions: 2, rechecks: 1 },
    { name: 'second admission network error', ids: ['mac-mini-a'], refresh: 'pass', second: 'network', admissions: 2, rechecks: 1 },
    { name: 'second admission backend error', ids: ['mac-mini-a'], refresh: 'pass', second: 'server', admissions: 2, rechecks: 1 },
    { name: 'second admission ambiguous success', ids: ['mac-mini-a'], refresh: 'pass', second: 'ambiguous', admissions: 2, rechecks: 1 },
    { name: 'second admission names another machine', ids: ['mac-mini-a'], refresh: 'pass', second: 'foreign', admissions: 2, rechecks: 1 },
  ] as const;
  for (const scenario of cases) await t.test(scenario.name, async () => {
    let identityReads = 0;
    const state = { admissionCalls: 0, births: 0, rechecks: 0 };
    const bridge = scenario.ids.length ? {
      executionMachineId: async () => {
        if (scenario.refresh === 'identity-throws' && identityReads > 0) throw new Error('bridge unavailable');
        return scenario.ids[Math.min(identityReads++, scenario.ids.length - 1)];
      },
      ...(scenario.refresh ? { recheckMachineCapabilities: async () => {
        state.rechecks += 1;
        if (scenario.refresh === 'fail') return { ok: false };
        if (scenario.refresh === 'identity-omitted') return { ok: true };
        if (scenario.refresh === 'foreign') return { ok: true, machineId: 'mac-studio-b' };
        return { ok: true, machineId: 'mac-mini-a' };
      } } : {}),
    } : {};
    const r = await render('agent-actions.tsx', props, {
      backend: (path: string) => {
        if (path.startsWith('/api/v2/agent-training/agents/')) return readyTrainingHome();
        if (path.startsWith('/api/v2/agents/') && path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
        if (path.includes('/run-precheck')) return { ok: true, fingerprint: null, duplicate: null };
        if (path === '/api/v2/me/run-admission') {
          state.admissionCalls += 1;
          if (state.admissionCalls === 1) throw refusal({ ok: false, setupRequired: OFFLINE_CARD });
          if (scenario.second === 'offline') throw refusal({ ok: false, setupRequired: OFFLINE_CARD });
          if (scenario.second === 'network') throw new Error('network unavailable');
          if (scenario.second === 'server') throw Object.assign(new Error('server unavailable'), { status: 503, body: { ok: false } });
          if (scenario.second === 'ambiguous') return { ok: false };
          if (scenario.second === 'foreign') return { ok: true, admitted: true, machine: { id: 'mac-studio-b' } };
          return { ok: true, admitted: true, machine: { id: 'mac-mini-a' } };
        }
        if (path === '/api/v2/me/run-requests') { state.births += 1; return { ok: true, request: { id: 'forbidden' } }; }
        return { ok: true };
      },
      bridge,
    });
    try {
      await r.click(r.getByText('▶ Run now'));
      await r.click(r.getByText('▶ Run now'));
      await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      assert.equal(state.admissionCalls, scenario.admissions);
      assert.equal(state.rechecks, scenario.rechecks);
      assert.equal(state.births, 0, 'no request can exist after failed/ambiguous freshness recovery');
      assert.ok(r.queryByText('Setup required before this agent can run.'), 'the typed offline decision remains visible');
    } finally { r.cleanup(); }
  });
});

test('one shared refresh budget prevents a second automatic recovery at request birth', async () => {
  const state = { admissions: 0, births: 0, rechecks: 0 };
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string) => {
      if (path.startsWith('/api/v2/agent-training/agents/')) return readyTrainingHome();
      if (path.startsWith('/api/v2/agents/') && path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
      if (path.includes('/run-precheck')) return { ok: true, fingerprint: null, duplicate: null };
      if (path === '/api/v2/me/run-admission') {
        state.admissions += 1;
        if (state.admissions === 1) throw refusal({ ok: false, setupRequired: OFFLINE_CARD });
        return { ok: true, admitted: true, machine: { id: 'mac-mini-a' } };
      }
      if (path === '/api/v2/me/run-requests') {
        state.births += 1;
        throw refusal({ ok: false, setupRequired: probeOnlyCard() });
      }
      return { ok: true };
    },
    bridge: {
      executionMachineId: async () => 'mac-mini-a',
      recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true, machineId: 'mac-mini-a' }; },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('▶ Run now'));
    assert.equal(state.admissions, 2);
    assert.equal(state.rechecks, 1, 'pre-admission consumed the one automatic refresh');
    assert.equal(state.births, 1, 'the typed no-birth refusal is not replayed after the budget is spent');
    assert.ok(r.queryByText('Setup required before this agent can run.'));
  } finally { r.cleanup(); }
});

test('input evidence mutated while offline refresh is in flight cannot alter the submitted immutable intent', async () => {
  const firstArtifact = '11111111-1111-4111-8111-111111111111';
  const secondArtifact = '22222222-2222-4222-8222-222222222222';
  const typedProps = {
    ...props,
    inputContractDigest: 'c'.repeat(64),
    inputContract: {
      version: 'workflow-input-contract.v1',
      fields: [{ key: 'project_bundle', label: 'Project bundle', kind: 'file', cardinality: 'one', required: true, order: 1,
        accept: { extensions: ['.zip'], mediaTypes: ['application/zip'] } }],
    },
  };
  const pickerResult = {
    ok: true,
    artifactId: firstArtifact,
    sha256: 'a'.repeat(64),
    displayName: 'Project-v1.zip',
    mediaType: 'application/zip',
    origin: 'file',
    inputSessionId: '',
  };
  let admissionCalls = 0;
  let submitted: Record<string, unknown> | null = null;
  let releaseRefresh!: () => void;
  let markRefreshStarted!: () => void;
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
  const r = await render('agent-actions.tsx', typedProps, {
    backend: (path: string, init: { body?: Record<string, unknown> }) => {
      if (path.startsWith('/api/v2/agent-training/agents/')) return readyTrainingHome();
      if (path.startsWith('/api/v2/agents/') && path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
      if (path.includes('/run-precheck')) return { ok: true, fingerprint: 'original-fingerprint', duplicate: null };
      if (path === '/api/v2/me/run-admission') {
        admissionCalls += 1;
        if (admissionCalls === 1) throw refusal({ ok: false, setupRequired: OFFLINE_CARD });
        return { ok: true, admitted: true, machine: { id: 'mac-mini-a' } };
      }
      if (path === '/api/v2/me/run-requests') {
        submitted = init.body || {};
        return { ok: true, request: { id: 'req-frozen-input' } };
      }
      return { ok: true };
    },
    bridge: {
      executionMachineId: async () => 'mac-mini-a',
      pickRunInput: async (options: Record<string, unknown>) => {
        pickerResult.inputSessionId = String(options.inputSessionId || '');
        return pickerResult;
      },
      recheckMachineCapabilities: async () => {
        markRefreshStarted();
        await refreshGate;
        return { ok: true, machineId: 'mac-mini-a' };
      },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('Choose file'));
    assert.match(r.text(), /Project-v1\.zip/);
    const submit = r.getByText('▶ Run now');
    await r.act(() => { submit.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    await boundedSignal(refreshStarted, 'offline refresh');
    // Adversarial mutation of the bridge-owned object after selection. The
    // component copied the exact verified identity into this Run before the
    // asynchronous refresh, so later object changes cannot alter it.
    pickerResult.artifactId = secondArtifact;
    pickerResult.sha256 = 'b'.repeat(64);
    pickerResult.displayName = 'Project-v2.zip';
    releaseRefresh();
    await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.ok(submitted);
    const bindings = submitted!.inputBindings as Record<string, { artifactId: string; sha256: string }>;
    assert.equal(bindings.project_bundle.artifactId, firstArtifact, 'the in-flight Run keeps the original bound input');
    assert.equal(bindings.project_bundle.sha256, 'a'.repeat(64));
    assert.equal(submitted!.inputFingerprint, 'original-fingerprint');
    assert.equal(submitted!.executionMachineId, 'mac-mini-a');
  } finally { r.cleanup(); }
});

test('mixed or permanent setup blockers never trigger automatic recheck or request replay', async () => {
  const state = { admitAfter: 0, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const mixed = probeOnlyCard();
  mixed.items = mixed.items.map((item) => item.id === 'ffmpeg'
    ? { ...item, state: 'missing', stateLabel: 'Not installed', reason: 'missing' }
    : item);
  const base = backendFor(state);
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/v2/me/run-requests') {
        state.runRequests.push(init.body || {});
        throw refusal({ ok: false, setupRequired: mixed });
      }
      return base(path, init);
    },
    bridge: {
      executionMachineId: async () => 'mac-mini-a',
      recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true }; },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('▶ Run now'));
    assert.equal(state.rechecks, 0);
    assert.equal(state.runRequests.length, 1);
    assert.ok(r.queryByText('Setup required before this agent can run.'));
  } finally { r.cleanup(); }
});

test('probe-only recovery fails closed for the wrong Desktop, a failed recheck, a second refusal, network errors, and ambiguous success', async (t) => {
  const cases = [
    { name: 'wrong Desktop', bridgeMachine: 'mac-studio-b', recheckOk: true, first: 'probe', expectedBirths: 1, expectedRechecks: 0 },
    { name: 'failed recheck', bridgeMachine: 'mac-mini-a', recheckOk: false, first: 'probe', expectedBirths: 1, expectedRechecks: 1 },
    { name: 'second refusal', bridgeMachine: 'mac-mini-a', recheckOk: true, first: 'probe-twice', expectedBirths: 2, expectedRechecks: 1 },
    { name: 'network error', bridgeMachine: 'mac-mini-a', recheckOk: true, first: 'network', expectedBirths: 1, expectedRechecks: 0 },
    { name: 'backend 5xx', bridgeMachine: 'mac-mini-a', recheckOk: true, first: 'server', expectedBirths: 1, expectedRechecks: 0 },
    { name: 'ambiguous 2xx', bridgeMachine: 'mac-mini-a', recheckOk: true, first: 'ambiguous', expectedBirths: 1, expectedRechecks: 0 },
  ] as const;
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const state = { admitAfter: 0, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
    const base = backendFor(state);
    const r = await render('agent-actions.tsx', props, {
      backend: (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/v2/me/run-requests') {
          state.runRequests.push(init.body || {});
          if (scenario.first === 'network') throw new Error('network unavailable');
          if (scenario.first === 'server') throw Object.assign(new Error('server unavailable'), { status: 503, body: { ok: false } });
          if (scenario.first === 'ambiguous') return { ok: false };
          throw refusal({ ok: false, setupRequired: probeOnlyCard() });
        }
        return base(path, init);
      },
      bridge: {
        executionMachineId: async () => scenario.bridgeMachine,
        recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: scenario.recheckOk, machineId: scenario.bridgeMachine }; },
      },
    });
    try {
      await r.click(r.getByText('▶ Run now'));
      await r.click(r.getByText('▶ Run now'));
      await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      assert.equal(state.runRequests.length, scenario.expectedBirths, 'bounded birth attempts');
      assert.equal(state.rechecks, scenario.expectedRechecks, 'bounded Desktop rechecks');
      if (scenario.first.startsWith('probe')) assert.ok(r.queryByText('Setup required before this agent can run.'), 'second/permanent refusal remains explicit');
    } finally { r.cleanup(); }
  });
});

test('two same-tick Run submissions share one queue flight and cannot duplicate its recovery', async () => {
  const state = { admitAfter: 0, admissionCalls: 0, runRequests: [] as Array<Record<string, unknown>>, rechecks: 0 };
  const base = backendFor(state);
  let births = 0;
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string, init: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/v2/me/run-requests') {
        births += 1;
        state.runRequests.push(init.body || {});
        if (births === 1) throw refusal({ ok: false, setupRequired: probeOnlyCard() });
        return { ok: true, request: { id: 'req-one' } };
      }
      return base(path, init);
    },
    bridge: {
      executionMachineId: async () => 'mac-mini-a',
      recheckMachineCapabilities: async () => { state.rechecks += 1; return { ok: true, machineId: 'mac-mini-a' }; },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    const submit = r.getByText('▶ Run now');
    await r.act(() => {
      submit.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      submit.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.equal(state.rechecks, 1);
    assert.equal(births, 2, 'one refused birth plus one replay, not two queue chains');
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
