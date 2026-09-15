import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';
const version = '33333333-3333-4333-8333-333333333333';
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const props = { slug: 'bundle-consumer', name: 'Bundle consumer', isActive: true, workflowVersionId: version,
  inputContractDigest: 'c'.repeat(64), inputContract: { version: 1, fields: [{ key: 'project_bundle', label: 'Project bundle', description: 'Planner export', kind: 'file', cardinality: 'one', required: true, order: 1, accept: { extensions: ['.zip'], mediaTypes: ['application/zip'] } }] } };
const refused = { ok: false, reason: 'project_bundle_contract_incompatible', error: '/Users/private/never-display.json', remediation: {
  contractVersion: 'project-bundle-remediation.v1', code: 'planner_contract_correction_required', action: 'correct_planner_bundle_and_reinspect',
  issues: [{ index: 0, code: 'timeline_slot_too_short', actualFrames: 150, requiredMinFrames: 152, path: '/Users/private/media.mp4' }],
} };
function backend(requests: any[], corrected: () => boolean, asError = false) {
  return (path: string, init: any) => {
    if (path.startsWith('/api/v2/agent-training/')) return { ok: true, home: {
      agent: { currentVersionId: version }, successorProjection: { contractVersion: 'agent-training-successor-projection.v1', activeVersionId: version, eligiblePredecessor: null },
      managerTrainingRequirements: { contractVersion: 'manager-reference-training-readiness.v1', scope: 'workflow_version_quality_references', workflowVersionId: version, classified: false, requiredPairs: [], fulfilledPairs: [], missingPairs: [], readiness: 'not_applicable', reason: null },
    } };
    if (path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
    if (path.includes('/run-precheck')) return { ok: true, fingerprint: null, duplicate: null };
    if (path.includes('/run-admission')) return { ok: true, admitted: true };
    if (path === '/api/v2/me/run-requests') {
      requests.push(init.body);
      if (corrected()) return { ok: true, request: { id: 'new-request' } };
      if (asError) throw Object.assign(new Error('refused'), { status: 400, body: refused });
      return refused;
    }
    return { ok: true };
  };
}
for (const asError of [false, true]) test(`bundle refusal preserves inputs, avoids Setup, and rechecks exactly once (${asError ? 'HTTP refusal' : '2xx refusal'})`, async () => {
  const requests: any[] = []; let corrected = false, rechecks = 0, session = '';
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const r = await render('agent-actions.tsx', props, { backend: backend(requests, () => corrected, asError), bridge: {
    executionMachineId: async () => 'test-machine',
    pickRunInput: async (opts: any) => { session = opts.inputSessionId; return { ok: true, artifactId: first, sha256: 'a'.repeat(64), inputSessionId: session, displayName: 'bundle.zip', mediaType: 'application/zip' }; },
    pickDeferredRunInput: async () => { throw new Error('bundle inspection must precede request/preparation'); },
    reinspectProjectBundle: async (opts: any) => { rechecks++; assert.equal(opts.artifactId, first); await pending; corrected = true;
      return { ok: true, artifactId: second, sha256: 'b'.repeat(64), inputSessionId: session, displayName: 'bundle.zip', mediaType: 'application/zip' }; },
  } });
  try {
    await r.click(r.getByText('▶ Run now')); await r.click(r.getByText('Choose file')); await r.click(r.getByText('▶ Run now'));
    assert.ok(r.queryByText('Project bundle needs an updated Planner export'));
    assert.ok(r.queryByText('Range 1: 150 frames; at least 152 frames required.'));
    assert.equal(r.queryByText('Setup required before this agent can run.'), null);
    assert.doesNotMatch(r.text(), /\/Users\/private/); assert.equal(requests.length, 1);
    const button = r.getByText('Recheck and run');
    await r.act(() => { button.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true })); button.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true })); });
    assert.equal(rechecks, 1); assert.equal(requests.length, 1);
    await r.act(() => release());
    assert.equal(requests.length, 2, 'one refused request attempt plus one corrected submission');
    assert.equal(requests[0].inputBindings.project_bundle.artifactId, first);
    assert.equal(requests[1].inputBindings.project_bundle.artifactId, second);
    assert.equal(requests[1].inputSessionId, session);
  } finally { r.cleanup(); }
});

test('closing remediation returns to the same selected export without queueing', async () => {
  const requests: any[] = [];
  const r = await render('agent-actions.tsx', props, { backend: backend(requests, () => false), bridge: {
    pickRunInput: async (opts: any) => ({ ok: true, artifactId: first, sha256: 'a'.repeat(64), inputSessionId: opts.inputSessionId, displayName: 'retained-bundle.zip', mediaType: 'application/zip' }),
  } });
  try {
    await r.click(r.getByText('▶ Run now')); await r.click(r.getByText('Choose file')); await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('Choose updated export'));
    assert.ok(r.queryByText('retained-bundle.zip')); assert.equal(requests.length, 1);
  } finally { r.cleanup(); }
});
