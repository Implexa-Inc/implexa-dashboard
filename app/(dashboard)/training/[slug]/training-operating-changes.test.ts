import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {render} from '../../../../lib/test/render.ts';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('../../../../test/fixtures/annotation-operating-gap-producer.v1.json',import.meta.url),'utf8'));
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function page(){const row=structuredClone(fixture.listRow);row.edit={state:'available',requestId:null,requestStatus:null,reviewedNote:null};return {ok:true,contractVersion:'training-annotation-gap-list.v1',analyses:[row],nextCursor:null};}
const receipt=fixture.response.analysisReceipt,H=receipt.resultDigest;
const props={sessionId:id(10),versionId:fixture.response.binding.expectedActiveVersionId,slug:'video-agent',refreshKey:0};
test('a proposal restores after taste acceptance; review queues only the edited generic note through the existing form',async t=>{
 const calls:any[]=[];let queued=false;
 const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async(url:string,init:any={})=>{
  calls.push({url,init});if(init.method==='POST'){queued=true;return {ok:true,json:async()=>({ok:true,application:'edit_queued',requestId:id(20)})};}
  const p:any=page();if(queued)p.analyses[0].edit={state:'queued',requestId:id(20),requestStatus:'queued',reviewedNote:'Keep prompt authoring self-contained.'};return {ok:true,json:async()=>p};
 }) as typeof fetch});t.after(()=>r.cleanup());
 Object.defineProperty(r.window,'crypto',{value:webcrypto,configurable:true});Object.assign(r.window,{TextEncoder});
 await r.act(async()=>{});assert.match(r.text(),/Update an agent step/);assert.equal(r.text().includes(fixture.response.operatingGap.privateRationale),false);assert.equal(r.text().includes(fixture.response.operatingGap.evidenceExcerpt),false);assert.equal(calls.filter(c=>c.init.method==='POST').length,0);
 await r.click(r.getByText('Review agent update'));
 const input=r.document.querySelector('textarea')!;assert.equal(input.value,'Before delivery, inspect diagram relationships against the accepted plan and correct mismatches.');
 await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Keep prompt authoring self-contained.');input.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
 await r.click(r.getByText('Apply change'));await r.act(async()=>{});
 const post=calls.find(c=>c.init.method==='POST'),body=JSON.parse(post.init.body);
 assert.match(post.url,/annotation-gap-edit/);assert.deepEqual(body,{action:'queue',analysisResultEventId:receipt.resultEventId,analysisResultDigest:H,expectedActiveVersionId:fixture.response.binding.expectedActiveVersionId,stepOrder:receipt.target.stepOrder,stepDigest:receipt.target.stepDigest,note:'Keep prompt authoring self-contained.',noteDigest:createHash('sha256').update('Keep prompt authoring self-contained.').digest('hex')});
 assert.match(r.text(),/Agent update queued/);assert.equal(calls.filter(c=>c.init.method==='POST').length,1);
});
test('a tool proposal requests capability review and never enables the step-edit writer; present results stay quiet',async t=>{
 let mode='tool';const calls:any[]=[];
 const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async(url:string,init:any={})=>{calls.push(init);const p:any=page();p.analyses[0].result.operatingGap.kind='tool';p.analyses[0].result.operatingGap.status=mode==='present'?'present':'suggested';p.analyses[0].edit.state='not_applicable';
  if(mode==='tool')p.analyses[0].edit.state='blocked';return {ok:true,json:async()=>p};}) as typeof fetch});t.after(()=>r.cleanup());await r.act(async()=>{});
 assert.match(r.text(),/Tool capability to review/);assert.equal(r.queryByText('Review agent update'),null);assert.equal(calls.some(c=>c.method==='POST'),false);
 mode='present';await r.rerender({...props,refreshKey:1});await r.act(async()=>{});assert.equal(r.queryByText('Suggested agent improvements'),null);
});

test('pending and failed analyses stay visible even though no edit is applicable, and refresh never starts inference',async t=>{
 const calls:any[]=[];let failed=false;
 const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async(url:string,init:any={})=>{calls.push({url,init});const p:any=page();p.analyses[0]={...p.analyses[0],outcome:failed?'failed':'pending',reason:failed?'teaching_suggestion_provider_timeout':null,result:null,edit:{state:'not_applicable',requestId:null,requestStatus:null,reviewedNote:null}};return {ok:true,json:async()=>p};}) as typeof fetch});t.after(()=>r.cleanup());await r.act(async()=>{});
 assert.match(r.text(),/Checking your agent setup/);failed=true;await r.click(r.getByText('Refresh suggestions'));assert.match(r.text(),/Agent setup needs another look/);assert.equal(calls.some(c=>c.init.method==='POST'),false);
});
