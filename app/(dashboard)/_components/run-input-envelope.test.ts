import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const VERSION = '33333333-3333-4333-8333-333333333333';
const DIGEST = 'c'.repeat(64);
const INPUT_FOLDER = '/test/creative-preview/inputs';

for (const contractKind of ['empty', 'populated', 'absent'] as const) {
  test(`Run now sends the versioned envelope for a ${contractKind} input contract`, async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fields = contractKind === 'populated' ? [{
      key: 'brief', label: 'Brief', description: 'Creative brief', kind: 'text',
      cardinality: 'one', required: true, order: 1,
    }] : [];
    const r = await render('agent-actions.tsx', {
      slug: 'creative-preview', isActive: true, workflowVersionId: VERSION,
      inputContract: contractKind === 'absent' ? null : { version: 1, fields },
      // Even a stale digest alone must not manufacture a contract for a legacy agent.
      inputContractDigest: DIGEST,
    }, {
      bridge: { pickDirectory: async () => ({ ok: true, path: INPUT_FOLDER }) },
      backend: (path, init: unknown) => {
        if (path.startsWith('/api/v2/agent-training/agents/')) return { ok: true, home: {
          agent: { currentVersionId: VERSION },
          successorProjection: { contractVersion: 'agent-training-successor-projection.v1',
            activeVersionId: VERSION, eligiblePredecessor: null },
          managerTrainingRequirements: { contractVersion: 'manager-reference-training-readiness.v1',
            scope: 'workflow_version_quality_references', workflowVersionId: VERSION,
            classified: false, requiredPairs: [], fulfilledPairs: [], missingPairs: [],
            readiness: 'not_applicable', reason: null },
        } };
        if (path.includes('/setup')) return {
          schema: [{ key: 'format', question: 'Format', kind: 'text', optional: true }],
          answers: { format: '16:9' }, note: '', runInputDefaults: { brief: 'weather excerpt' },
        };
        if (path.includes('/run-precheck')) return { ok: true, duplicate: null, fingerprint: null };
        if (path === '/api/v2/me/run-admission') return { ok: true, admitted: true };
        if (path === '/api/v2/me/run-requests') {
          requests.push((init as { body: Record<string, unknown> }).body);
          return { ok: true, request: { id: 'new-request' } };
        }
        return { ok: true };
      },
    });
    try {
      await r.click(r.getByText('▶ Run now'));
      if (contractKind !== 'populated') await r.click(r.getByText('Attach folder'));
      await r.click(r.getByText('Save & run'));
      assert.equal(requests.length, 1, 'one request, after admission');
      const body = requests[0];
      const paths = r.calls.backend.map(c => c.path);
      assert.ok(paths.indexOf('/api/v2/me/run-admission') < paths.indexOf('/api/v2/me/run-requests'));
      if (contractKind === 'absent') {
        for (const key of ['workflowVersionId', 'inputContractDigest', 'inputBindings', 'inputSessionId']) {
          assert.equal(Object.hasOwn(body, key), false, `${key} must not invent a typed contract`);
        }
      } else {
        assert.equal(body.workflowVersionId, VERSION);
        assert.equal(body.inputContractDigest, DIGEST);
        assert.deepEqual(JSON.parse(JSON.stringify(body.inputBindings)),
          contractKind === 'empty' ? {} : { brief: 'weather excerpt' });
      }
      if (contractKind !== 'populated') {
        assert.match(String(body.note), /📎 Attached for this run/);
        assert.ok(String(body.note).includes(INPUT_FOLDER), 'untyped attachment remains in the per-run note');
        const saves = r.calls.backend.filter(c => c.path.endsWith('/setup')
          && (c.init as { method?: string }).method === 'POST');
        assert.equal(saves.length, 1);
        assert.equal(JSON.stringify(saves[0].init).includes(INPUT_FOLDER), false,
          'the attachment must not leak into standing setup');
      }
    } finally { r.cleanup(); }
  });
}
