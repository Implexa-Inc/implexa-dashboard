import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../../../lib/test/render.ts';
const familyId='80000000-0000-4000-8000-000000000002';
const value={ok:true,contractVersion:'agent-display-metrics.v1',familyId,basis:'versioned_worker_runs',visibility:'owner_aggregate',totalRuns:5,scoredRuns:2,averageScore:85,timedRuns:3,averageDurationMs:90000,ownLastRun:{at:'2026-11-21T12:00:00Z',executor:'codex',model:'own-model'}};
test('background metrics show denominators, all-time scope and only own engine metadata',async()=>{
 const calls:any[]=[];const r=await render('./agent-display-metrics.tsx',{slug:'video-agent',source:'generated',familyId,delivered:'92% · 8 checked runs'},{fetch:(async(url:any,init:any)=>{calls.push({url,init});return {ok:true,json:async()=>value};}) as typeof fetch});
 try{assert.match(r.text(),/85\/100/);assert.match(r.text(),/2 of 5 runs scored/);assert.match(r.text(),/3 of 5 runs timed/);assert.match(r.text(),/Codex · own-model/);assert.match(r.text(),/Review and repair runs aren’t counted/);assert.equal(calls.length,1);assert.equal(calls[0].init.method,undefined);}finally{r.cleanup();}
});
test('statistics failure has its own retry and never offers a Run or setup gate',async()=>{
 let fail=true;const r=await render('./agent-display-metrics.tsx',{slug:'video-agent',source:'generated',familyId,delivered:'Not measured yet'},{fetch:(async()=>{if(fail)throw Error('offline');return {ok:true,json:async()=>value};}) as typeof fetch});
 try{assert.match(r.text(),/You can still use this agent/);assert.doesNotMatch(r.text(),/0 runs|Check setup/);fail=false;await r.click(r.getByText('Retry statistics'));assert.match(r.text(),/85\/100/);}finally{r.cleanup();}
});
