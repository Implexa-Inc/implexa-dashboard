import test from 'node:test';
import assert from 'node:assert/strict';
import {render,type Rendered} from '../../../../lib/test/render.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,VERSION=id(1),SESSION=id(2),SOURCE=id(3),H='a'.repeat(64);
const source={sourceId:SOURCE,localName:'Cambrian demonstration',metadata:{sha256:H,mediaType:'video/mp4',durationMs:324000}};
const context=()=>({agent:{id:id(4),name:'Video agent',slug:'video-agent',versionId:VERSION},researchMethodPresent:true,
 boundMethods:[{stageIndex:2,source:'community',slug:'implexa-inc-reference-research-assessment',contentDigest:H}],
 source:{sourceId:SOURCE,sha256:H},availableActions:['none','analyse_taste','review_method','test_agent']});
const turn=(patch={})=>({turnId:id(5),versionId:VERSION,sourceId:SOURCE,sourceSha256:H,message:'Please review this recording.',createdAt:'2026-10-31T12:00:00Z',
 status:'answered',answer:'The research method is already attached. We can review taste.',action:'analyse_taste',reason:null,...patch});
async function setup(t:any,options:{turns?:any[];offlineOnce?:boolean;wrongContext?:boolean}={}){
 const calls:any[]=[],actions:any[]=[];let saved=options.turns||[],posts=0;
 const props={sessionId:SESSION,versionId:VERSION,slug:'video-agent',sources:[source],selectedSourceId:SOURCE,disabled:false,
  onSelectSource:()=>{},onAction:async(...args:any[])=>{actions.push(args);}};
 const r=await render('../training/[slug]/training-chat.tsx',props,{fetch:(async(url:string,init:any={})=>{
  calls.push({url,init});let c=context();if(options.wrongContext)c.agent.versionId=id(99);
  if(init.method==='POST'){posts++;const b=JSON.parse(init.body);saved=[turn({turnId:b.turnId,message:b.message})];
   if(options.offlineOnce&&posts===1)throw Error('private upstream text');
   return {ok:true,json:async()=>({ok:true,contractVersion:'training-chat.v1',canSend:true,turn:saved[0],context:c})};}
  return {ok:true,json:async()=>({ok:true,contractVersion:'training-chat.v1',canSend:true,turns:saved,totalTurns:saved.length,context:c})};
 }) as typeof fetch});t.after(()=>r.cleanup());
 return {r,calls,actions,props};
}
async function type(r:Rendered,text:string){
 const e=r.document.querySelector('textarea')!;
 await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(e,text);e.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
}
test('opening chat shows server-bound method and disclosure without calling a provider or existing action',async t=>{
 const {r,calls,actions}=await setup(t);assert.equal(calls.length,0);
 await r.click(r.getByText('Open conversation'));
 assert.match(r.text(),/Reference research assessment is already attached/);assert.match(r.text(),/aaaaaaaaaaaa/);
 assert.match(r.text(),/No recording frames or transcript are sent by this chat/);assert.equal(calls.length,1);assert.equal(actions.length,0);
});
test('a normal Send preserves raw wording and only an explicit current action click enters existing flow',async t=>{
 const {r,calls,actions}=await setup(t);await r.click(r.getByText('Open conversation'));await type(r,'  What does my recording teach?  ');
 await r.click(r.getByText('Send'));const posts=calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,1);
 const b=JSON.parse(posts[0].init.body);assert.equal(b.message,'  What does my recording teach?  ');assert.equal(b.sourceId,SOURCE);assert.equal(b.expectedActiveVersionId,VERSION);
 assert.equal(b.consent,true);assert.equal(actions.length,0);
 await r.click(r.getByText('Analyze the recording’s taste'));assert.deepEqual(JSON.parse(JSON.stringify(actions)),[['analyse_taste',{versionId:VERSION,sourceId:SOURCE,sourceSha256:H}]]);
 assert.equal(calls.filter(c=>c.init.method==='POST').length,1);
});
test('reload/refresh restores a saved conversation without POST; stale version actions cannot execute',async t=>{
 const {r,calls,actions,props}=await setup(t,{turns:[turn()]});await r.click(r.getByText('Open conversation'));
 assert.match(r.text(),/Please review this recording/);await r.click(r.getByText('Refresh saved messages'));
 assert.equal(calls.some(c=>c.init.method==='POST'),false);
 await r.rerender({...props,versionId:id(99),disabled:true});
 assert.equal(actions.length,0);assert.equal(calls.some(c=>c.init.method==='POST'),false);
});
test('unconfirmed Send preserves the question and refresh recovers the saved reply without a model retry',async t=>{
 const {r,calls}=await setup(t,{offlineOnce:true});await r.click(r.getByText('Open conversation'));await type(r,'Keep this wording.');await r.click(r.getByText('Send'));
 await r.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
 assert.match(r.text(),/Refresh saved messages before sending again/);assert.equal(r.document.querySelector('textarea')!.value,'Keep this wording.');
 const refresh=Array.from(r.document.querySelectorAll('button')).find(b=>b.textContent==='Refresh saved messages')!;
 assert.equal(refresh.disabled,false);
 await r.click(refresh);await r.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});assert.match(r.text(),/The research method is already attached/);
 assert.equal(calls.filter(c=>c.init.method==='POST').length,1);assert.doesNotMatch(r.text(),/private upstream text/);
});
test('wrong server context cannot enable Send or a source/version-bound action',async t=>{
 const {r,calls,actions}=await setup(t,{turns:[turn()],wrongContext:true});await r.click(r.getByText('Open conversation'));
 assert.match(r.text(),/training chat unavailable/);assert.equal((r.getByText('Send') as HTMLButtonElement).disabled,true);
 assert.equal(calls.length,1);assert.equal(actions.length,0);
});
