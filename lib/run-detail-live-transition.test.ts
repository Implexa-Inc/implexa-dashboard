import assert from 'node:assert/strict';
import test from 'node:test';

import { isWatchableRunState, shouldShowRunProblem } from './run-state.ts';

test('run details keeps watching across queued to running', () => {
  assert.equal(isWatchableRunState('queued'), true);
  assert.equal(isWatchableRunState('running'), true);
  assert.equal(isWatchableRunState('completed'), false);
  assert.equal(isWatchableRunState('failed'), false);
});

test('active queue/start states never render as a terminal stalled run', () => {
  assert.equal(shouldShowRunProblem({ state: 'queued', attention: false }, 'exit_timeout'), false);
  assert.equal(shouldShowRunProblem({ state: 'running', attention: false }, 'exit_timeout'), false);
  assert.equal(shouldShowRunProblem({ state: 'stalled', attention: true }, null), true);
  assert.equal(shouldShowRunProblem({ state: 'failed', attention: false }, null), true);
  assert.equal(shouldShowRunProblem({ state: 'completed', attention: false }, 'It ran past its time limit.'), true);
  assert.equal(shouldShowRunProblem({ state: 'completed', attention: false }, null), false,
    'successful settlement provenance has no failure explanation');
});
