import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWorkflowDetail } from './workflow-catalog.ts';
import { getAgentDetail } from './agent-detail.ts';

const contract = {
  workflow_id: 'agent-1', workflow_version_id: 'version-7',
  steps: [{ order: 1, label: 'Keep exact spaces.  <script>not executable</script>', inputs: { source: 'x' }, outputs: ['a.json'], execution_policy: { repairs: 1 } }],
  input_contract: { version: 1, fields: [] }, project_bundle_contract: { files: ['a.json'] },
};
const raw = { id: 'agent-1', workflow_version_id: 'version-7', steps: [{ order: 1, label: 'LOSSY DISPLAY' }], revision_contract: contract, run_input_version_source: 'live' };

test('existing authenticated detail read retains the exact versioned envelope, no second fetch', async () => {
  const calls: RequestInit[] = [];
  const result = await getAgentDetail('example', 'synthetic-token', { fetchImpl: (async (_url, init) => {
    calls.push(init!);
    return new Response(JSON.stringify({ ok: true, workflow: raw, lifecycle: { requests: [], runningRun: false } }));
  }) as typeof fetch });
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.deepEqual(result.detail.workflow.revision_contract, contract);
  assert.equal(result.detail.workflow.definition_version_source, 'live');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].headers, { authorization: 'Bearer synthetic-token' });
  assert.equal(calls[0].cache, 'no-store');
  assert.equal(calls[0].method ?? 'GET', 'GET');
});

test('missing, mismatched or malformed exact definitions never fall back to display steps', () => {
  for (const value of [null, {}, { ...contract, workflow_id: 'another' }, { ...contract, workflow_version_id: 'old' },
    { ...contract, steps: [] }, { ...contract, steps: [null] }, { ...contract, steps: [contract.steps[0], contract.steps[0]] }]) {
    assert.equal(mapWorkflowDetail({ ...raw, revision_contract: value }, 'example', 'generated').revision_contract, null);
  }
});

test('installed and unknown source stay distinct from live; original envelope is unchanged', () => {
  const before = JSON.stringify(raw);
  for (const source of ['installed', undefined, 'unexpected']) {
    const mapped = mapWorkflowDetail({ ...raw, run_input_version_source: source }, 'example', 'generated');
    assert.equal(mapped.definition_version_source, source === 'installed' ? 'installed' : null);
    assert.deepEqual(mapped.revision_contract, contract);
  }
  assert.equal(JSON.stringify(raw), before);
});
