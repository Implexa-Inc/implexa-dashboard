import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../lib/test/render.ts';
const version='33333333-3333-4333-8333-333333333333';
const props={slug:'collection-agent',name:'Collection agent',isActive:true,workflowVersionId:version,openOnArrival:true};
function backend(path:string){return path.startsWith('/api/v2/agent-training/agents/')?{ok:true,home:{agent:{currentVersionId:version},successorProjection:{contractVersion:'agent-training-successor-projection.v1',activeVersionId:version,eligiblePredecessor:null},managerTrainingRequirements:{contractVersion:'manager-reference-training-readiness.v1',scope:'workflow_version_quality_references',workflowVersionId:version,classified:false,requiredPairs:[],fulfilledPairs:[],missingPairs:[],readiness:'not_applicable',reason:null}}}:{schema:[],answers:{},note:'',runInputDefaults:{}};}
const flush=async(r:any)=>r.act(()=>new Promise(resolve=>setTimeout(resolve,20)));
test('collection Run opens the existing form once and never submits a request on arrival',async()=>{
 const r=await render('agent-actions.tsx',props,{backend});
 try{await flush(r);assert.ok(r.document.querySelector('[role="dialog"]'));assert.ok(r.document.querySelector('textarea'),'the normal run note/input gate is visible');assert.equal(r.calls.backend.filter(c=>c.path.startsWith('/api/v2/agent-training/agents/')).length,1);assert.equal(r.calls.backend.filter(c=>c.path==='/api/v2/me/run-requests').length,0);await r.rerender(props);await flush(r);assert.equal(r.calls.backend.filter(c=>c.path.startsWith('/api/v2/agent-training/agents/')).length,1);}finally{r.cleanup();}
});
test('arrival cannot bypass unavailable status, inactive setup or a pending revision',async()=>{
 for(const gate of [{statusUnavailable:true},{isActive:false},{revisePending:true}]){
  const r=await render('agent-actions.tsx',{...props,...gate},{backend});
  try{await flush(r);assert.equal(r.calls.backend.filter(c=>c.path.startsWith('/api/v2/agent-training/agents/')||c.path==='/api/v2/me/run-requests').length,0);assert.equal(r.document.querySelector('textarea'),null);}finally{r.cleanup();}
 }
});

test('the Run intent is consumed without adding history and preserves other URL inputs',async()=>{
 const r=await render('agent-actions.tsx',{...props,openOnArrival:false},{backend});
 try{
  r.window.history.replaceState(null,'','/workflows/collection-agent?source=generated&run=1&legacy=1&tab=overview#agent');
  const length=r.window.history.length;
  await r.rerender(props);await flush(r);
  assert.equal(new URL(r.window.location.href).searchParams.has('run'),false);
  assert.equal(r.window.location.search,'?source=generated&legacy=1&tab=overview');assert.equal(r.window.location.hash,'#agent');
  assert.equal(r.window.history.length,length,'consuming the intent must not add a Back entry');
  assert.equal(r.calls.backend.filter(c=>c.path==='/api/v2/me/run-requests').length,0);
 }finally{r.cleanup();}
});
test('the agent dock keeps one Run label and parks supervised execution inside the existing run form',async()=>{
 const r=await render('agent-actions.tsx',{...props,presentation:'dock',runLabel:'Run'},{backend});
 try{await flush(r);assert.ok(r.document.querySelector('[role="dialog"]'));assert.ok(r.queryByText('More run options'));const watch=Array.from(r.document.querySelectorAll('label')).find(el=>el.textContent?.includes('Open in a session to watch'));assert.ok(watch?.querySelector('input'));await r.click(watch!.querySelector('input')!);assert.ok(r.queryByText('Open in Claude →'));assert.equal(r.calls.backend.filter(c=>c.path==='/api/v2/me/run-requests').length,0);}finally{r.cleanup();}
});
