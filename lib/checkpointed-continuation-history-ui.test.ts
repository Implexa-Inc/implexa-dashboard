import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parseStagePreviewRead } from './review-preview.ts';

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

test('the existing run-detail read exposes retained Preview without an approval hold or another request', async () => {
  const read = page.indexOf('const response = await callBackend(`/api/v2/runs/');
  const start = page.lastIndexOf('  try {',read), end = page.indexOf('  // 0139 is additive.',read);
  assert.ok(start>0 && end>start);
  const runId='10000000-0000-4000-8000-000000000001';
  const summary={contractVersion:'stage-preview-summary.v1',runId,
    preparationId:'10000000-0000-4000-8000-000000000002',receiptDigest:'a'.repeat(64),
    machineId:'10000000-0000-4000-8000-000000000003',reviewState:'fail',ownerHoldReady:false};
  for(const unavailable of [false,true]){
    const calls: unknown[]=[];
    const result=await vm.runInNewContext(`(async()=>{
      let checkpointedContinuations={status:'unavailable',reason:'continuation_history_unavailable'};
      let stagePreview={state:'unavailable'};
      ${page.slice(start,end)}
      return {stagePreview,checkpointedContinuations};
    })()`,{r:{id:runId},session:{access_token:'synthetic-owner-session'},encodeURIComponent,parseStagePreviewRead,
      callBackend:async(url: string,options: unknown)=>{
        calls.push([url,options]);if(unavailable)throw Error('synthetic transport failure');
        return {ok:true,run:{id:runId,stagePreview:summary,checkpointedContinuations:{status:'available',items:[]}}};
      }});
    assert.equal(calls.length,1);
    assert.equal(result.stagePreview.state,unavailable?'unavailable':'ready');
    if(!unavailable)assert.equal(result.stagePreview.summary.ownerHoldReady,false);
  }
});
