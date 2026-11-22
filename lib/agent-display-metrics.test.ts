import test from 'node:test';import assert from 'node:assert/strict';import {agentDisplayMetrics,metricDuration} from './agent-display-metrics.ts';
const id='80000000-0000-4000-8000-000000000002';
const metrics=()=>({ok:true,contractVersion:'agent-display-metrics.v1',familyId:id,basis:'versioned_worker_runs',visibility:'owner_aggregate',totalRuns:5,scoredRuns:2,averageScore:85,timedRuns:3,averageDurationMs:90000,ownLastRun:null});
test('metrics counts remain honest and cannot carry private run fields',()=>{
 assert.ok(agentDisplayMetrics(metrics()));for(const patch of [{runId:id},{scoredRuns:6},{timedRuns:-1},{averageScore:101},{ownLastRun:{at:'today',executor:'codex',model:'m'}}])assert.equal(agentDisplayMetrics({...metrics(),...patch}),null);
 assert.ok(agentDisplayMetrics({...metrics(),visibility:'insufficient_public_runs',totalRuns:null,scoredRuns:null,averageScore:null,timedRuns:null,averageDurationMs:null}));assert.equal(metricDuration(90000),'2 min');
});
