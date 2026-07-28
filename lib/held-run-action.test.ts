import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveHeldRunPrimaryAction, hasRemainingRunWork } from './held-run-action.ts';

test('approval before paid generation continues when the structured checklist has remaining work', () => {
  const steps = [
    { index: 3, label: 'Hold for approval before paid generation', status: 'done' as const },
    { index: 4, label: 'Dependency and account preflight', status: 'pending' as const },
    { index: 5, label: 'Generate Runway b-roll clips', status: 'pending' as const },
  ];
  assert.equal(hasRemainingRunWork(steps), true);
  assert.equal(deriveHeldRunPrimaryAction({
    reviewStatus: 'pending', stepsState: steps, hasDeferredWorkSignal: false,
  }), 'continue');
});

test('a truly finished deliver-only hold remains mark done', () => {
  assert.equal(deriveHeldRunPrimaryAction({
    reviewStatus: 'pending',
    stepsState: [{ index: 1, label: 'Draft complete', status: 'done' }],
    hasDeferredWorkSignal: false,
  }), 'mark_done');
});

test('legacy held runs retain the explicit deferred-work fallback', () => {
  assert.equal(deriveHeldRunPrimaryAction({
    reviewStatus: 'pending', stepsState: [], hasDeferredWorkSignal: true,
  }), 'approve_finish');
});

test('needs-input remains a request for an answer, never an approval', () => {
  assert.equal(deriveHeldRunPrimaryAction({
    reviewStatus: 'needs_input', stepsState: [{ index: 1, label: 'Question', status: 'pending' }], hasDeferredWorkSignal: true,
  }), 'answer');
});
