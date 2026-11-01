import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';

const base={id:'run-a',skill_slug:'video-studio',ran_at:'2026-11-01T19:00:00Z',status:'completed',run_state:'completed'};
test('run history exposes actual failures, approval holds, input holds and completions with real run permalinks',async()=>{
 const r=await render('run-activity.tsx',{runs:[base,{...base,id:'failed',status:'failed',run_state:'failed'}, {...base,id:'approval',review_status:'pending'}, {...base,id:'input',review_status:'needs_input'}]});
 try{
  assert.equal(r.document.querySelectorAll('li').length,4);
  assert.match(r.text(),/Failed/);assert.match(r.text(),/Waiting for approval/);assert.match(r.text(),/Needs your input/);
  assert.deepEqual(Array.from(r.document.querySelectorAll('a')).map(a=>a.getAttribute('href')),['/runs/run-a','/runs/failed','/runs/approval','/runs/input']);
  assert.equal(r.calls.backend.length,0);
 }finally{r.cleanup();}
});
test('unavailable history is distinct from an empty history',async()=>{
 const r=await render('run-activity.tsx',{runs:[],unavailable:true});
 try{assert.match(r.text(),/temporarily unavailable/);assert.doesNotMatch(r.text(),/No recent runs/);}finally{r.cleanup();}
});
test('one existing live poller shows current step and only known-empty reads claim no activity',async()=>{
 const card={runId:'run-a',requestId:'request-a',skillSlug:'video-studio',status:'running',lifecyclePhase:'executing',since:new Date().toISOString(),currentStepIndex:3,totalSteps:8,currentStepLabel:'Compose'};
 const r=await render('live-run-activity.tsx',{}, {backend:path=>path==='/api/v2/scheduled-skills/live'?{items:[card]}:{}});
 try{await r.act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});assert.match(r.text(),/Step 3\/8 · Compose/);assert.equal(r.document.querySelectorAll('a[href="/runs/run-a"]').length,1);assert.doesNotMatch(r.text(),/No active runs/);}finally{r.cleanup();}
 for(const fail of [false,true]){
  const e=await render('live-run-activity.tsx',{}, {backend:()=>{if(fail)throw Error('offline');return {items:[]};}});
  try{await e.act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});assert.match(e.text(),fail?/temporarily unavailable/:/No active runs right now/);if(fail)assert.doesNotMatch(e.text(),/No active runs/);}finally{e.cleanup();}
 }
});
