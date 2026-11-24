import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {requestCheckpointRecovery,resumeCheckpointRecovery} from './review-preview.ts';
const fixture=JSON.parse(fs.readFileSync(path.join(process.cwd(),'test-fixtures/generated/checkpoint-owner-recovery.v1.json'),'utf8'));
for(const capture of fixture.captures)test(`normal ${capture.kind} recovery uses the actual Desktop producer response and transient session`,async()=>{
 const v=capture.clientView;let reads=0,writes=0;const calls:unknown[][]=[];
 const original=(globalThis as unknown as {window?:unknown}).window;
 try{
  (globalThis as unknown as {window:unknown}).window={implexaDesktop:{
   createCheckpointRecovery:async(...args:unknown[])=>{reads++;calls.push(args);return capture.clientView;},
   resumeCheckpointRecovery:async(...args:unknown[])=>{writes++;calls.push(args);return capture.clientResult;}}};
  assert.deepEqual(await requestCheckpointRecovery(v.runId,v.requestId,v.launchAttemptId),capture.clientView);assert.equal(writes,0,'inspection never submits the owner action');
  assert.deepEqual(await resumeCheckpointRecovery(v.runId,v.requestId,v.launchAttemptId,v.decisionDigest,'inert-owner-session-token'),capture.clientResult);
  assert.deepEqual(calls[0],[v.runId,v.requestId,v.launchAttemptId]);assert.deepEqual(calls[1],[v.runId,v.requestId,v.launchAttemptId,v.decisionDigest,'inert-owner-session-token']);
  assert.deepEqual(await resumeCheckpointRecovery(v.runId,v.requestId,v.launchAttemptId,v.decisionDigest,'short'),{ok:false,error:'bad_request'});
  assert.deepEqual(await requestCheckpointRecovery('bad',v.requestId,v.launchAttemptId),{ok:false,error:'bad_request'});assert.equal(reads,1);assert.equal(writes,1);
  (globalThis as unknown as {window:unknown}).window={implexaDesktop:{}};
  assert.deepEqual(await requestCheckpointRecovery(v.runId,v.requestId,v.launchAttemptId),{ok:false,error:'update_required'});
  delete (globalThis as unknown as {window?:unknown}).window;
  assert.deepEqual(await requestCheckpointRecovery(v.runId,v.requestId,v.launchAttemptId),{ok:false,error:'desktop_required'});
 }finally{if(original===undefined)delete (globalThis as unknown as {window?:unknown}).window;else (globalThis as unknown as {window:unknown}).window=original;}
});


test('the existing history control submits one explicit owner action and keeps the session out of state',async()=>{
 const component=fs.readFileSync(path.join(process.cwd(),'app/(dashboard)/_components/checkpointed-continuation-history.tsx'),'utf8');
 const start=component.indexOf('  async function resume(){'),end=component.indexOf('  if (history.status',start);assert.ok(start>=0&&end>start);
 const c=fixture.captures.find((c:{kind:string})=>c.kind==='owner_continue'),v=c.clientView;
 let sessions=0,writes=0,finish:((value:unknown)=>void)|undefined;const messages:string[]=[],inFlight={current:false};
 const resume=vm.runInNewContext(stripTypeScriptTypes(component.slice(start,end))+'\nresume;',{
  runId:v.runId,recovery:{requestId:v.requestId,continuationAttemptId:v.launchAttemptId},decision:v.decisionDigest,inFlight,
  setBusy:()=>{},setDecision:()=>{},setMessage:(m:string)=>messages.push(m),
  createClient:()=>({auth:{getSession:()=>{sessions++;return new Promise(resolve=>{finish=resolve;});}}}),
  resumeCheckpointRecovery:async(...args:unknown[])=>{writes++;assert.deepEqual(args,[v.runId,v.requestId,v.launchAttemptId,v.decisionDigest,'inert-owner-session-token']);return c.clientResult;}});
 const first=resume(),second=resume();assert.equal(sessions,1);assert.equal(writes,0);assert.equal(inFlight.current,true);
 finish!({data:{session:{access_token:'inert-owner-session-token'}}});await Promise.all([first,second]);
 assert.equal(writes,1);assert.equal(inFlight.current,false);assert.match(messages.at(-1)!,/Continuation queued/);
 assert.ok(messages.every(m=>!m.includes('inert-owner-session-token')));
});

test('fresh and historical producer receipts have distinct UI truth; absent or malformed history is unconfirmed',async()=>{
 const component=fs.readFileSync(path.join(process.cwd(),'app/(dashboard)/_components/checkpointed-continuation-history.tsx'),'utf8');
 const start=component.indexOf('  async function resume(){'),end=component.indexOf('  if (history.status',start);
 const c=fixture.captures.find((c:{kind:string})=>c.kind==='owner_continue'),v=c.clientView;
 const {historical:ignored,...withoutHistory}=c.clientResult;void ignored;
 for(const [result,expected] of [[c.clientResult,/Continuation queued/],[c.clientHistorical,/Recovery was recorded earlier/],
  [withoutHistory,/Recovery was not confirmed/],[{...c.clientHistorical,historical:'true'},/Recovery was not confirmed/]] as const){
  const messages:string[]=[];
  const resume=vm.runInNewContext(stripTypeScriptTypes(component.slice(start,end))+'\nresume;',{
   runId:v.runId,recovery:{requestId:v.requestId,continuationAttemptId:v.launchAttemptId},decision:v.decisionDigest,inFlight:{current:false},
   setBusy:()=>{},setDecision:()=>{},setMessage:(s:string)=>messages.push(s),createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'inert-owner-session-token'}}})}}),
   resumeCheckpointRecovery:async()=>result});
  await resume();assert.match(messages.at(-1)!,expected);
  if(result!==c.clientResult)assert.doesNotMatch(messages.at(-1)!,/Continuation queued/);
 }
});
