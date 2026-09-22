import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const component = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/_components/checkpointed-continuation-history.tsx'), 'utf8');
const page = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/runs/[id]/page.tsx'), 'utf8');

test('run page renders exact continuation identity and stage history', () => {
  for (const field of ['checkpointId', 'requestId', 'sourceAttemptId', 'continuationAttemptId', 'sourceFence',
    'continuationFence', 'continuationNumber', 'lastCompletedStage', 'nextStage',
    'materializationState', 'attemptLifecycleState', 'materializationDigest', 'attemptExitClassification']) {
    assert.match(component, new RegExp(field));
  }
  assert.match(page, /checkpointedContinuations/);
  assert.match(page, /CheckpointedContinuationHistoryCard/);
  assert.match(page, /<CheckpointedContinuationHistoryCard history={checkpointedContinuations} \/>/);
  assert.match(component, /short\(item\.checkpointId\)/);
});

test('unavailable history is visible and a legitimate continuation is not Needs You', () => {
  assert.match(component, /Continuation history could not be checked/);
  assert.match(component, /do not need your input/);
  assert.doesNotMatch(component, /Needs You/);
  assert.match(page, /unavailable is rendered honestly/);
});

test('UI distinguishes durable materialization proof from neutral attempt lifecycle', () => {
  assert.match(component, /Preserved files verified/);
  assert.match(component, /Preserved-file verification refused/);
  assert.match(component, /Preserved-file verification pending/);
  assert.match(component, /materialization \{short\(item\.materializationDigest\)\}/);
  assert.match(component, /Continuation process started/);
  assert.match(component, /Continuation process ended/);
  assert.match(component, /Continuation ended before process start/);
  assert.match(component, /durable attempt state/);
  assert.match(component, /Desktop verifies preserved files locally/);
  assert.doesNotMatch(component, /Verified and reused|Reuse refused|Verifying preserved work/);
});
