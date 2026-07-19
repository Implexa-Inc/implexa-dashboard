import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeRepairState } from './judge-repair-state.ts';

test('repair lifecycle distinguishes queued, running, and the exact repaired child', () => {
  assert.deepEqual(judgeRepairState({ verdict: 'repair', repairRound: 0, requestStatus: 'pending' }),
    { phase: 'queued', nextRound: 1, repairedRunId: null });
  assert.deepEqual(judgeRepairState({ verdict: 'repair', repairRound: 0, requestStatus: 'consumed' }),
    { phase: 'running', nextRound: 1, repairedRunId: null });
  assert.deepEqual(judgeRepairState({ verdict: 'repair', repairRound: 0, requestStatus: 'done', requestRunId: 'child', currentRunId: 'parent' }),
    { phase: 'completed', nextRound: 1, repairedRunId: 'child' });
});

test('missing queue state and convergence limit stay visible instead of pretending work is running', () => {
  assert.equal(judgeRepairState({ verdict: 'repair', repairRound: 0 }).phase, 'queue_failed');
  assert.equal(judgeRepairState({ verdict: 'repair', repairRound: 2, requestStatus: 'pending' }).phase, 'limit_reached');
  assert.equal(judgeRepairState({ verdict: 'blocked', repairRound: 0, requestStatus: 'pending' }).phase, 'none');
});
