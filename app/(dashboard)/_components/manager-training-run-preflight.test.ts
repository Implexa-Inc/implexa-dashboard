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

function adoptionPreview() {
  return {
    contractVersion: 'manager-training-successor-adoption-preview.v1', targetWorkflowVersionId: VERSION,
    sourceWorkflowVersionId: PREVIOUS, eligibleRecordCount: 5, alreadyAdoptedRecordCount: 2,
    newlyAdoptableRecordCount: 3, eligibleRouteCount: 4, readiness: 'adoption_available', reason: null,
  };
}

function trainingHome(readiness: 'reference_training_ready' | 'coach_reference_training_required', adoption = false) {
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
      ...(adoption ? { successorAdoption: adoptionPreview() } : {}),
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

test('installed customer readiness opens normal inputs or holds without exposing trainer actions', async () => {
  for (const readiness of ['reference_training_ready', 'coach_reference_training_required'] as const) {
    const paths: string[] = [];
    const r = await render('agent-actions.tsx', props, { backend: (path: string) => {
      paths.push(path);
      if (path.startsWith('/api/v2/agent-training/agents/')) return {
        ok: true, contractVersion: 'installed-agent-training-preflight.v1',
        agentFamilyId: '11111111-1111-4111-8111-111111111111', workflowVersionId: VERSION,
        managerTrainingRequirements: trainingHome(readiness).home.managerTrainingRequirements,
      };
      if (path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
      throw Error('No other pre-run operation expected');
    } });
    try {
      await r.click(r.getByText('▶ Run now'));
      assert.ok(paths.includes(`/api/v2/agent-training/agents/visual-compositor?scope=run&versionId=${VERSION}`));
      if (readiness === 'reference_training_ready') assert.ok(r.queryByText('Run inputs'));
      else {
        assert.match(r.text(), /Ask the trainer for help/);
        assert.equal(r.queryByText('Open successor training'), null);
        assert.equal(r.queryByText('Open training for this version'), null);
        assert.equal(paths.some(path => path.includes('/setup')), false);
      }
      assert.equal(paths.some(path => path.includes('adopt-successor') || path.includes('/sessions')), false);
    } finally { r.cleanup(); }
  }
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

test('compatible adoption is explicit, count-disclosed, idempotent, and rechecks readiness before inputs', async () => {
  let homeReads = 0;
  const posts: Array<{ body?: Record<string, unknown>; idempotencyKey?: string }> = [];
  const receiptIds = Array.from({ length: 5 }, (_, index) => `${String(index + 1).repeat(8)}-${String(index + 1).repeat(4)}-4${String(index + 1).repeat(3)}-8${String(index + 1).repeat(3)}-${String(index + 1).repeat(12)}`);
  const r = await render('agent-actions.tsx', props, {
    backend: (path: string, init: { body?: Record<string, unknown>; idempotencyKey?: string }) => {
      if (path.endsWith('/adopt-successor')) {
        posts.push(init);
        return {
          ok: true, contractVersion: 'manager-training-successor-adoption.v1', created: true,
          agentSlug: 'visual-compositor', targetWorkflowVersionId: VERSION, sourceWorkflowVersionId: PREVIOUS,
          adoptedRecordCount: 5, adoptionReceiptIds: receiptIds, eligibleRouteCount: 4,
          adoptionSetDigest: 'd'.repeat(64),
          managerTrainingRequirements: trainingHome('reference_training_ready').home.managerTrainingRequirements,
        };
      }
      if (path.startsWith('/api/v2/agent-training/agents/')) {
        homeReads += 1;
        return homeReads === 1 ? trainingHome('coach_reference_training_required', true) : trainingHome('reference_training_ready');
      }
      if (path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
      return { ok: true };
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    assert.match(r.text(), /carry 3 accepted decisions spanning 4 compatible reference routes/i);
    const action = r.getByText('Carry 3 accepted decisions') as HTMLButtonElement;
    assert.ok(action.disabled, 'no adoption without explicit consent');
    await r.click(r.getByText('I want to carry these exact accepted decisions'));
    assert.equal(action.disabled, false);
    await r.click(action);
    assert.equal(posts.length, 1);
    assert.deepEqual(Object.keys(posts[0].body || {}), ['expectedActiveVersionId']);
    assert.equal(posts[0].body?.expectedActiveVersionId, VERSION);
    assert.match(posts[0].idempotencyKey || '', /^[0-9a-f-]{36}$/);
    assert.equal(homeReads, 2, 'receipt success is followed by a fresh active-version readiness read');
    assert.ok(r.queryByText('Run inputs'));
  } finally { r.cleanup(); }
});

function optionalTrainingHome(adopted = false) {
  const value = trainingHome('reference_training_ready', true);
  Object.assign(value.home.managerTrainingRequirements, {
    readiness: 'not_applicable', reason: null, requiredPairs: [], fulfilledPairs: [], missingPairs: [],
  });
  if (adopted) Object.assign(value.home.successorAdoption!, {
    alreadyAdoptedRecordCount: 5, newlyAdoptableRecordCount: 0, readiness: 'already_adopted',
  });
  return value;
}

function ancestorTrainingHome() {
  const value = optionalTrainingHome();
  return { ...value, home: { ...value.home, successorAdoption: {
    ...value.home.successorAdoption,
    contractVersion: 'manager-training-successor-adoption-preview.v2',
    ancestorRecovery: { planDigest: 'e'.repeat(64),
      versionIds: [PREVIOUS, '44444444-4444-4444-8444-444444444444', VERSION] },
  } } };
}

test('ancestor carryover confirms the exact plan in the existing action before opening run inputs', async () => {
  let adopted = false, reads = 0, setups = 0;
  const posts: Array<{ body?: Record<string, unknown>; idempotencyKey?: string }> = [];
  const ids = Array.from({ length: 5 }, (_, i) => `${String(i+1).repeat(8)}-${String(i+1).repeat(4)}-4${String(i+1).repeat(3)}-8${String(i+1).repeat(3)}-${String(i+1).repeat(12)}`);
  const r = await render('agent-actions.tsx', props, { backend: (path: string, init: { body?: Record<string, unknown>; idempotencyKey?: string }) => {
    if (path.endsWith('/adopt-successor')) {
      posts.push(init); adopted = true;
      return { ok: true, contractVersion: 'manager-training-successor-adoption.v2', created: true,
        agentSlug: 'visual-compositor', targetWorkflowVersionId: VERSION, sourceWorkflowVersionId: PREVIOUS,
        adoptedRecordCount: 5, adoptionReceiptIds: ids, eligibleRouteCount: 4, adoptionSetDigest: 'd'.repeat(64),
        expectedAdoptionDigest: 'e'.repeat(64), managerTrainingRequirements: optionalTrainingHome(true).home.managerTrainingRequirements };
    }
    if (path.startsWith('/api/v2/agent-training/agents/')) { reads++; return adopted ? optionalTrainingHome(true) : ancestorTrainingHome(); }
    if (path.includes('/setup')) { setups++; return { schema: [], answers: {}, note: '', runInputDefaults: {} }; }
    throw Error(`Unexpected operation: ${path}`);
  } });
  try {
    await r.click(r.getByText('▶ Run now'));
    assert.match(r.text(), /Bring your saved training forward/);
    assert.match(r.text(), /Earlier versions and runs stay unchanged/);
    assert.doesNotMatch(r.text(), /between these consecutive versions/);
    const carry = r.getByText('Carry 3 accepted decisions') as HTMLButtonElement;
    assert.ok(carry.disabled);
    assert.equal(posts.length, 0); assert.equal(setups, 0);
    await r.click(r.getByText('I want to carry these exact accepted decisions'));
    await r.click(carry);
    assert.equal(posts.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(posts[0].body)), { expectedActiveVersionId: VERSION, expectedAdoptionDigest: 'e'.repeat(64) });
    assert.match(posts[0].idempotencyKey || '', /^[0-9a-f-]{36}$/);
    assert.equal(reads, 2); assert.equal(setups, 1);
    assert.ok(r.queryByText('Run inputs'));
  } finally { r.cleanup(); }
});

test('an unconfirmed ancestor-plan receipt cannot open inputs or silently retry the carryover', async () => {
  let posts = 0, setups = 0;
  const ids = Array.from({ length: 5 }, (_, i) => `${String(i+1).repeat(8)}-${String(i+1).repeat(4)}-4${String(i+1).repeat(3)}-8${String(i+1).repeat(3)}-${String(i+1).repeat(12)}`);
  const r = await render('agent-actions.tsx', props, { backend: (path: string) => {
    if (path.endsWith('/adopt-successor')) {
      posts++;
      return { ok: true, contractVersion: 'manager-training-successor-adoption.v2', created: true,
        agentSlug: 'visual-compositor', targetWorkflowVersionId: VERSION, sourceWorkflowVersionId: PREVIOUS,
        adoptedRecordCount: 5, adoptionReceiptIds: ids, eligibleRouteCount: 4, adoptionSetDigest: 'd'.repeat(64),
        expectedAdoptionDigest: 'f'.repeat(64), managerTrainingRequirements: optionalTrainingHome(true).home.managerTrainingRequirements };
    }
    if (path.startsWith('/api/v2/agent-training/agents/')) return ancestorTrainingHome();
    if (path.includes('/setup')) { setups++; throw Error('No setup after an unconfirmed receipt'); }
    throw Error(`Unexpected operation: ${path}`);
  } });
  try {
    await r.click(r.getByText('▶ Run now'));
    await r.click(r.getByText('I want to carry these exact accepted decisions'));
    await r.click(r.getByText('Carry 3 accepted decisions'));
    assert.equal(posts, 1); assert.equal(setups, 0);
    assert.match(r.text(), /could not verify the training adoption receipt/);
    assert.equal(r.queryByText('Run inputs'), null);
  } finally { r.cleanup(); }
});

test('optional carryover uses the same acknowledged adoption action and opens inputs only after a fresh read', async () => {
  let adopted = false; let posts = 0; let reads = 0;
  const ids = Array.from({ length: 5 }, (_, i) => `${String(i+1).repeat(8)}-${String(i+1).repeat(4)}-4${String(i+1).repeat(3)}-8${String(i+1).repeat(3)}-${String(i+1).repeat(12)}`);
  const r = await render('agent-actions.tsx', props, { backend: (path: string) => {
    if (path.endsWith('/adopt-successor')) {
      posts++; adopted = true;
      return { ok: true, contractVersion: 'manager-training-successor-adoption.v1', created: true,
        agentSlug: 'visual-compositor', targetWorkflowVersionId: VERSION, sourceWorkflowVersionId: PREVIOUS,
        adoptedRecordCount: 5, adoptionReceiptIds: ids, eligibleRouteCount: 4, adoptionSetDigest: 'd'.repeat(64),
        managerTrainingRequirements: optionalTrainingHome(true).home.managerTrainingRequirements };
    }
    if (path.startsWith('/api/v2/agent-training/agents/')) { reads++; return optionalTrainingHome(adopted); }
    if (path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
    return { ok: true };
  } });
  try {
    await r.click(r.getByText('▶ Run now'));
    assert.match(r.text(), /Carry your accepted training forward/);
    assert.doesNotMatch(r.text(), /missing 0 required/);
    assert.ok(r.queryByText('Continue without carrying'));
    const carry = r.getByText('Carry 3 accepted decisions') as HTMLButtonElement;
    assert.ok(carry.disabled);
    await r.click(r.getByText('I want to carry these exact accepted decisions'));
    await r.click(carry);
    assert.equal(posts, 1); assert.equal(reads, 2);
    assert.ok(r.queryByText('Run inputs'));
  } finally { r.cleanup(); }
});

test('skipping optional carryover rechecks authority and never bypasses new mandatory training', async () => {
  for (const mandatory of [false, true]) {
    let reads = 0; let posts = 0; let setups = 0;
    const r = await render('agent-actions.tsx', props, { backend: (path: string) => {
      if (path.endsWith('/adopt-successor')) { posts++; throw Error('must not adopt on skip'); }
      if (path.startsWith('/api/v2/agent-training/agents/')) {
        reads++; return reads === 1 || !mandatory ? optionalTrainingHome() : trainingHome('coach_reference_training_required');
      }
      if (path.includes('/setup')) { setups++; return { schema: [], answers: {}, note: '', runInputDefaults: {} }; }
      return { ok: true };
    } });
    try {
      await r.click(r.getByText('▶ Run now'));
      await r.click(r.getByText('Continue without carrying'));
      assert.equal(reads, 2); assert.equal(posts, 0);
      if (mandatory) {
        assert.match(r.text(), /Reference training needed before this run/);
        assert.equal(r.queryByText('Continue without carrying'), null);
        assert.equal(setups, 0);
      } else { assert.ok(r.queryByText('Run inputs')); assert.equal(setups, 1); }
    } finally { r.cleanup(); }
  }
});
