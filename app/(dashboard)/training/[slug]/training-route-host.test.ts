import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../../../../lib/test/render.ts';
const id=(n:number)=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`,O=id(1),F=id(2),V=id(3),S=id(4),SOURCE=id(5),TOKEN=id(6),H='a'.repeat(64);
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const props={slug:'fixture',ownerId:O,familyId:F,runContext:{slug:'fixture',workflowVersionId:V,statusUnavailable:false,revisePending:false}};
test('one mounted controller preserves drafts across Train and annotation, fences versions/accounts and stays inert on other pages',async()=>{
 const calls:string[]=[];
 const bridge={trainingLocalContractVersion:'2',trainingLocal:async(op:string)=>{calls.push(op);
  if(op==='home')return {ok:true,home:{agent:{name:'Fixture',currentVersionId:V},recentSessions:[{sessionId:S,sourceMode:'raw_input',terminal:false,agent:{baseVersionId:V}}],successorProjection:{contractVersion:'agent-training-successor-projection.v1',activeVersionId:V,eligiblePredecessor:null},managerTrainingRequirements:{contractVersion:'manager-reference-training-readiness.v1',scope:'workflow_version_quality_references',workflowVersionId:V,classified:true,requiredPairs:[],fulfilledPairs:[],missingPairs:[],readiness:'not_applicable',reason:null}}};
  if(op==='scope')return {ok:true,scope:{agent:{name:'Fixture',currentVersionId:V},session:{sessionId:S,baseVersionId:V,terminal:false}}};
  if(op==='list')return {ok:true,sources:[{sourceId:SOURCE,sourceReferenceDigest:H,token:TOKEN,metadata:{mediaType:'image/png',durationMs:0,sha256:H,width:1,height:1},decisions:[]}],pendingDecisions:[],failedDrafts:[]};
  if(op==='preview')return {ok:true,image};return {ok:false,reason:'unavailable'};
 }};
 const r=await render('../../../lib/test/fixtures/training-route-host.tsx',{value:props},{bridge});
 const path=(href:string)=>{(r.window as unknown as {__implexaTestPath:string}).__implexaTestPath=href;};
 const target={kind:'image',sourceId:SOURCE,sessionId:S};
 const route=`/training/fixture/annotate/${SOURCE}?sessionId=${S}`;
 const flush=()=>r.act(()=>new Promise(resolve=>setTimeout(resolve,20)));
 try{
  assert.equal(calls.length,0,'a registered controller is inert outside the editor routes');path('/training/fixture');await r.rerender({value:props});await flush();assert.ok(r.queryByText('Train Fixture'),JSON.stringify({text:r.text(),calls,dom:r.document.body.innerHTML.slice(0,1000)}));
  path(route);await r.rerender({value:{...props,annotationTarget:target}});await flush();
  let area=r.document.querySelector('[aria-label="Your feedback on this image"]') as HTMLTextAreaElement;assert.ok(area);const first=area;
  await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(area,'Preserve this unfinished note.');area.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
  assert.equal(r.document.querySelector('#training-companion'),null);
  path('/training/fixture');await r.rerender({value:props});await flush();path(route);await r.rerender({value:{...props,annotationTarget:target}});await flush();
  area=r.document.querySelector('[aria-label="Your feedback on this image"]') as HTMLTextAreaElement;assert.equal(area.value,'Preserve this unfinished note.');assert.notEqual(area,first,'the media view may remount; its controller draft remains');
  path(route.replace(`sessionId=${S}`,`sessionId=${id(8)}`));await r.rerender({value:{...props,annotationTarget:target}});assert.ok(area.closest('[hidden]'),'query-scope transitions hide the old view before server authorization');
  path(route);const before=calls.length;await r.rerender({value:{...props,runContext:{...props.runContext,workflowVersionId:id(9)},annotationTarget:target}});await flush();
  assert.match(r.text(),/The agent version changed/);assert.ok(area.closest('[hidden]'));assert.equal(area.value,'Preserve this unfinished note.');assert.equal(calls.length,before,'no automatic replay for the new version');
  await r.rerender({value:{...props,ownerId:id(10),annotationTarget:target}});await flush();area=r.document.querySelector('[aria-label="Your feedback on this image"]') as HTMLTextAreaElement;assert.equal(area.value,'','another owner does not inherit the draft');
  await r.rerender({value:{...props,ownerId:id(10),annotationTarget:target},registered:false});assert.ok(area.closest('[hidden]'),'a refused server page cannot leave stale actions usable');
  path('/training/fixture/listing');await r.rerender({value:props,registered:false});assert.equal(r.document.querySelector('.training-route-host'),null);
  assert.equal(calls.some(op=>['annotate','accept','create','recording'].includes(op)),false);
 }finally{r.cleanup();}
});
