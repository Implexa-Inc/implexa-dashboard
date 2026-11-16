import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {render} from '../../../../lib/test/render.ts';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('../../../../test/fixtures/annotation-operating-gap-producer.v2.json',import.meta.url),'utf8'));
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function page(){const row=structuredClone(fixture.listRow);row.edit={state:'available',review:null,requestId:null,requestStatus:null,reviewedNote:null};return {ok:true,contractVersion:'training-annotation-gap-list.v1',analyses:[row],nextCursor:null};}
const receipt=fixture.response.analysisReceipt,H=receipt.resultDigest;
const props={sessionId:id(10),versionId:fixture.response.binding.expectedActiveVersionId,slug:'video-agent',refreshKey:0};
test('a proposal restores after taste acceptance; review queues only the edited generic note through the existing form',async t=>{
 const calls:any[]=[];let queued=false;
 const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async(url:string,init:any={})=>{
  calls.push({url,init});if(init.method==='POST'){queued=true;return {ok:true,json:async()=>({ok:true,application:'edit_queued',requestId:id(20)})};}
  const p:any=page();if(queued)p.analyses[0].edit={state:'queued',review:fixture.listRow.edit.review,requestId:id(20),requestStatus:'queued',reviewedNote:'Keep prompt authoring self-contained.'};return {ok:true,json:async()=>p};
 }) as typeof fetch});t.after(()=>r.cleanup());
 Object.defineProperty(r.window,'crypto',{value:webcrypto,configurable:true});Object.assign(r.window,{TextEncoder});
 await r.act(async()=>{});assert.match(r.text(),/Update an agent step/);assert.equal(r.text().includes(fixture.response.operatingGap.privateRationale),false);assert.equal(r.text().includes(fixture.response.operatingGap.evidenceExcerpt),false);assert.equal(calls.filter(c=>c.init.method==='POST').length,0);
 await r.click(r.getByText('Review agent update'));
 const input=r.document.querySelector('textarea')!;assert.equal(input.value,fixture.response.operatingGap.genericDelta);
 await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Keep prompt authoring self-contained.');input.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
 await r.click(r.getByText('Apply change'));await r.act(async()=>{});
 const post=calls.find(c=>c.init.method==='POST'),body=JSON.parse(post.init.body);
 assert.match(post.url,/annotation-gap-edit/);assert.deepEqual(body,{action:'queue',analysisResultEventId:receipt.resultEventId,analysisResultDigest:H,expectedActiveVersionId:fixture.response.binding.expectedActiveVersionId,stepOrder:receipt.target.stepOrder,stepDigest:receipt.target.stepDigest,supersedes:null,note:'Keep prompt authoring self-contained.',noteDigest:createHash('sha256').update('Keep prompt authoring self-contained.').digest('hex')});
 assert.match(r.text(),/Agent update queued/);assert.equal(calls.filter(c=>c.init.method==='POST').length,1);
});
test('a tool proposal requests capability review and never enables the step-edit writer; present results stay quiet',async t=>{
 let mode='tool';const calls:any[]=[];
 const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async(url:string,init:any={})=>{calls.push(init);const p:any=page();p.analyses[0].result.operatingGap.kind='tool';p.analyses[0].result.operatingGap.capability='presenter_background_removal';if(mode==='present')p.analyses[0].result.operatingGap.genericDelta='';p.analyses[0].result.operatingGap.status=mode==='present'?'present':'suggested';p.analyses[0].edit.state='not_applicable';
  if(mode==='tool')p.analyses[0].edit.state='blocked';return {ok:true,json:async()=>p};}) as typeof fetch});t.after(()=>r.cleanup());await r.act(async()=>{});
 assert.match(r.text(),/Tool capability to review/);assert.equal(r.queryByText('Review agent update'),null);assert.equal(calls.some(c=>c.method==='POST'),false);
 mode='present';await r.rerender({...props,refreshKey:1});await r.act(async()=>{});assert.equal(r.queryByText('Suggested agent improvements'),null);
});

test('pending and failed analyses stay visible even though no edit is applicable, and refresh never starts inference',async t=>{
 const calls:any[]=[];let failed=false;
 const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async(url:string,init:any={})=>{calls.push({url,init});const p:any=page();p.analyses[0]={...p.analyses[0],outcome:failed?'failed':'pending',reason:failed?'teaching_suggestion_provider_timeout':null,result:null,edit:{state:'not_applicable',review:null,requestId:null,requestStatus:null,reviewedNote:null}};return {ok:true,json:async()=>p};}) as typeof fetch});t.after(()=>r.cleanup());await r.act(async()=>{});
 assert.match(r.text(),/Checking your agent setup/);failed=true;await r.click(r.getByText('Refresh suggestions'));assert.match(r.text(),/Agent setup needs another look/);assert.equal(calls.some(c=>c.init.method==='POST'),false);
});

test('an unconfirmed queue reconciles its latest approval before the trainer can submit a changed note',async t=>{
 const calls:any[]=[];let attempted=false,queued=false;
 const approval={eventId:id(30),digest:H,revision:1,supersedes:null};
 const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async(url:string,init:any={})=>{
  calls.push({url,init});if(init.method==='POST'){if(!attempted){attempted=true;return {ok:false,json:async()=>({ok:false,reason:'annotation_gap_queue_unconfirmed'})};}queued=true;return {ok:true,json:async()=>({ok:true,application:'edit_queued',requestId:id(20)})};}
  const p:any=page();if(attempted)p.analyses[0].edit={state:queued?'queued':'reviewed_unqueued',review:approval,requestId:queued?id(20):null,requestStatus:queued?'pending':null,reviewedNote:'First reviewed note.'};return {ok:true,json:async()=>p};
 }) as typeof fetch});t.after(()=>r.cleanup());Object.defineProperty(r.window,'crypto',{value:webcrypto,configurable:true});Object.assign(r.window,{TextEncoder});await r.act(async()=>{});
 await r.click(r.getByText('Review agent update'));await r.click(r.getByText('Apply change'));await r.act(async()=>{});
 assert.ok(calls.some(c=>c.url.includes(`requestEventId=${receipt.requestEventId}`)));
 const input=r.document.querySelector('textarea')!;
 await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Correct the reviewed setup change.');input.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
 await r.click(r.getByText('Apply change'));await r.act(async()=>{});
 const posts=calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,2);assert.deepEqual(JSON.parse(posts[1].init.body).supersedes,{eventId:approval.eventId,digest:approval.digest});assert.equal(JSON.parse(posts[1].init.body).note,'Correct the reviewed setup change.');assert.match(r.text(),/Agent update queued/);
});

test('a failed targeted queue check can be retried without reloading or losing the edited note',async t=>{
 let attempted=false,failRead=true;const approval={eventId:id(30),digest:H,revision:1,supersedes:null};
 const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async(url:string,init:any={})=>{
  if(init.method==='POST'){attempted=true;return {ok:false,json:async()=>({ok:false,reason:'annotation_gap_queue_unconfirmed'})};}
  if(attempted&&failRead)throw Error('temporary read failure');
  const p:any=page();if(attempted)p.analyses[0].edit={state:'reviewed_unqueued',review:approval,requestId:null,requestStatus:null,reviewedNote:'Saved approval.'};return {ok:true,json:async()=>p};
 }) as typeof fetch});t.after(()=>r.cleanup());Object.defineProperty(r.window,'crypto',{value:webcrypto,configurable:true});Object.assign(r.window,{TextEncoder});await r.act(async()=>{});
 await r.click(r.getByText('Review agent update'));const input=r.document.querySelector('textarea')!;
 await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Keep this trainer edit.');input.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
 await r.click(r.getByText('Apply change'));await r.act(async()=>{});assert.equal((r.getByText('Apply change') as HTMLButtonElement).disabled,true);
 failRead=false;await r.click(r.getByText('Check saved update'));await r.act(async()=>{});
 assert.equal((r.getByText('Apply change') as HTMLButtonElement).disabled,false);assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement).value,'Keep this trainer edit.');
});

test('incomplete setup remains visible even without a proposed edit and never implies no gap was found',async t=>{
 const calls:any[]=[];const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async(url:string,init:any={})=>{calls.push(init);const p:any=page();p.analyses[0].result.operatingGap=null;p.analyses[0].result.analysisReceipt.setupState='incomplete';p.analyses[0].result.analysisReceipt.target=null;p.analyses[0].edit.state='not_applicable';return {ok:true,json:async()=>p};}) as typeof fetch});t.after(()=>r.cleanup());await r.act(async()=>{});
 assert.match(r.text(),/Agent setup couldn’t be checked/);assert.match(r.text(),/No step or tool assessment was possible/);assert.equal(r.queryByText('Review agent update'),null);assert.equal(calls.some(c=>c.method==='POST'),false);
});

test('unsupported or uncertain procedure findings remain visible without enabling an edit',async t=>{
 for(const status of ['unsupported','incomplete']){
  const r=await render('../training/[slug]/training-operating-changes.tsx',props,{fetch:(async()=>{const p:any=page();p.analyses[0].result.operatingGap.status=status;p.analyses[0].result.operatingGap.genericDelta='';p.analyses[0].edit.state='not_applicable';return {ok:true,json:async()=>p};}) as typeof fetch});t.after(()=>r.cleanup());await r.act(async()=>{});
  assert.match(r.text(),/needs a capability or method review/);assert.ok(r.queryByText('Why this needs review'));assert.equal(r.queryByText('Review agent update'),null);
 }
});
