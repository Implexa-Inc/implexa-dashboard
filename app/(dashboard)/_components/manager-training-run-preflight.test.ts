import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const VERSION = '33333333-3333-4333-8333-333333333333';
const PREVIOUS = '22222222-2222-4222-8222-222222222222';
const PAIR = { stage: 'planning', property: 'layout_variety', relation: 'accepted' };
const props = {
  slug: 'visual-compositor', name: 'Visual compositor', isActive: true, workflowVersionId: VERSION,
  inputContractDigest: 'a'.repeat(64),
  inputContract: {
    contractVersion: 1, workflowVersionId: VERSION,
    fields: [{ key: 'source_video', label: 'Source video', kind: 'file', cardinality: 'one', required: true }],
  },
};

function trainingHome(readiness: 'reference_training_ready' | 'coach_reference_training_required') {
  return {
    ok: true,
    home: {
      agent: { currentVersionId: VERSION },
      successorProjection: {
        contractVersion: 'agent-training-successor-projection.v1', activeVersionId: VERSION,
        eligiblePredecessor: { sessionId: '11111111-1111-4111-8111-111111111111', baseVersionId: PREVIOUS, acceptedLocalRecordCount: 4 },
      },
      managerTrainingRequirements: {
        contractVersion: 'manager-reference-training-readiness.v1', scope: 'workflow_version_quality_references',
        workflowVersionId: VERSION, classified: true, requiredPairs: [PAIR],
        fulfilledPairs: readiness === 'reference_training_ready' ? [PAIR] : [],
        missingPairs: readiness === 'reference_training_ready' ? [] : [PAIR], readiness,
        reason: readiness === 'reference_training_ready' ? null : 'manager_required_reference_training_missing',
      },
    },
  };
}

test('training refusal appears before setup, saved verification, or any local picker', async () => {
  let picks = 0; let savedBinds = 0;
  const backendPaths: string[] = [];
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string) => {
      backendPaths.push(path);
      if (path.startsWith('/api/v2/agent-training/agents/')) return trainingHome('coach_reference_training_required');
      if (path.includes('/setup')) throw new Error('setup must not load behind the training gate');
      return { ok: true };
    },
    bridge: {
      pickRunInput: async () => { picks += 1; return { ok: false, canceled: true }; },
      bindSavedRunInput: async () => { savedBinds += 1; return { ok: false, error: 'must_not_run' }; },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    assert.match(r.text(), /Reference training needed before this run/);
    assert.match(r.text(), /No run inputs were selected, verified, or prepared/);
    assert.match(r.text(), /Plan the treatment · layout variety · accepted/);
    const link = r.getByText('Open successor training') as HTMLAnchorElement;
    assert.equal(link.getAttribute('href'), '/training/visual-compositor');
    assert.equal(backendPaths.some((path) => path.includes('/setup')), false);
    assert.equal(picks, 0);
    assert.equal(savedBinds, 0);
  } finally { r.cleanup(); }
});

test('exact ready projection permits the ordinary Run form', async () => {
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string) => {
      if (path.startsWith('/api/v2/agent-training/agents/')) return trainingHome('reference_training_ready');
      if (path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
      return { ok: true };
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    assert.equal(r.queryByText('Reference training needed before this run'), null);
    assert.ok(r.queryByText('Run inputs'));
  } finally { r.cleanup(); }
});

test('unverifiable readiness fails closed before the Run form', async () => {
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string) => path.startsWith('/api/v2/agent-training/agents/') ? { ok: true } : { ok: true },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    assert.match(r.text(), /Training readiness unavailable/);
    assert.match(r.text(), /No run inputs were selected, verified, or prepared/);
    assert.equal(r.queryByText('Run inputs'), null);
  } finally { r.cleanup(); }
});

test('retrying an unavailable check preserves the chosen watch path', async () => {
  let checks = 0;
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string) => {
      if (path.startsWith('/api/v2/agent-training/agents/')) {
        checks += 1;
        return checks === 1 ? { ok: true } : trainingHome('reference_training_ready');
      }
      if (path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
      return { ok: true };
    },
  });
  try {
    await r.click(r.getByText('Open in a session to watch'));
    await r.click(r.getByText('Check again'));
    assert.equal(checks, 2);
    assert.ok(r.queryByText('Open in Claude →'));
  } finally { r.cleanup(); }
});
