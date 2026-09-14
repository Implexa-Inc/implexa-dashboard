import test from 'node:test';
import assert from 'node:assert/strict';
import { managerTrainingRunPreflight } from './manager-training-run-preflight.ts';

const TARGET = '33333333-3333-4333-8333-333333333333';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const PAIR = { stage: 'planning', property: 'layout_variety', relation: 'accepted' };

function home(readiness: 'reference_training_ready' | 'coach_reference_training_required' = 'coach_reference_training_required') {
  return {
    ok: true,
    home: {
      agent: { currentVersionId: TARGET },
      successorProjection: {
        contractVersion: 'agent-training-successor-projection.v1', activeVersionId: TARGET,
        eligiblePredecessor: { sessionId: '11111111-1111-4111-8111-111111111111', baseVersionId: SOURCE, acceptedLocalRecordCount: 1 },
      },
      managerTrainingRequirements: {
        contractVersion: 'manager-reference-training-readiness.v1', scope: 'workflow_version_quality_references',
        workflowVersionId: TARGET, classified: true, requiredPairs: [PAIR],
        fulfilledPairs: readiness === 'reference_training_ready' ? [PAIR] : [],
        missingPairs: readiness === 'reference_training_ready' ? [] : [PAIR], readiness,
        reason: readiness === 'reference_training_ready' ? null : 'manager_required_reference_training_missing',
      },
    },
  };
}

test('accepts only exact active-version readiness and exposes explicit predecessor recovery', () => {
  assert.deepEqual(managerTrainingRunPreflight(home('reference_training_ready'), TARGET).state, 'ready');
  assert.deepEqual(managerTrainingRunPreflight(home(), TARGET), {
    state: 'training_required', requirements: home().home.managerTrainingRequirements, hasEligiblePredecessor: true,
  });
});

test('fails closed on stale, malformed, or widened training projections', () => {
  const candidates = [
    null,
    { ...home(), extra: true }, // root widening is harmless; nested authority is what is exact
    { ...home(), home: { ...home().home, successorProjection: { ...home().home.successorProjection, activeVersionId: SOURCE } } },
    { ...home(), home: { ...home().home, managerTrainingRequirements: { ...home().home.managerTrainingRequirements, workflowVersionId: SOURCE } } },
    { ...home(), home: { ...home().home, managerTrainingRequirements: { ...home().home.managerTrainingRequirements, extra: true } } },
  ];
  assert.equal(managerTrainingRunPreflight(candidates[0], TARGET).state, 'unavailable');
  assert.equal(managerTrainingRunPreflight(candidates[1], TARGET).state, 'training_required');
  for (const candidate of candidates.slice(2)) {
    assert.equal(managerTrainingRunPreflight(candidate, TARGET).state, 'unavailable');
  }
});
