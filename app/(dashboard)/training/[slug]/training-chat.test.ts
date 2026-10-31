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
async function setup(t:any,options:{turns?:any[];offlineOnce?:boolean;wrongContext?:boolean;historical?:boolean;embedded?:boolean;guided?:boolean}={}){
 const calls:any[]=[],actions:any[]=[];let saved=options.turns||[],posts=0;
 const props={guided:options.guided,embedded:options.embedded,sessionId:SESSION,versionId:VERSION,slug:'video-agent',sources:[source],selectedSourceId:SOURCE,disabled:options.historical===true,
  onSelectSource:()=>{},onAction:async(...args:any[])=>{actions.push(args);}};
 const r=await render('../training/[slug]/training-chat.tsx',props,{fetch:(async(url:string,init:any={})=>{
  calls.push({url,init});let c=context();if(options.wrongContext)c.agent.versionId=id(99);
  if(init.method==='POST'){posts++;const b=JSON.parse(init.body);saved=[turn({turnId:b.turnId,message:b.message})];
   if(options.offlineOnce&&posts===1)throw Error('private upstream text');
   return {ok:true,json:async()=>({ok:true,contractVersion:'training-chat.v1',canSend:true,turn:saved[0],context:c})};}
  return {ok:true,json:async()=>({ok:true,contractVersion:'training-chat.v1',canSend:!options.historical,turns:saved,totalTurns:saved.length,context:options.historical?null:c})};
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
test('historical conversation can open and restore messages while Send and actions remain unavailable',async t=>{
 const {r,calls,actions}=await setup(t,{turns:[turn()],historical:true});
 assert.equal((r.getByText('Open conversation') as HTMLButtonElement).disabled,false);
 await r.click(r.getByText('Open conversation'));assert.match(r.text(),/Please review this recording/);
 assert.equal((r.getByText('Send') as HTMLButtonElement).disabled,true);
 assert.equal((r.getByText('Analyze the recording’s taste') as HTMLButtonElement).disabled,true);
 assert.equal(calls.length,1);assert.equal(actions.length,0);
});


test('embedded Training companion restores privately with GET only and stays the same conversation across layout changes',async t=>{
 const {r,calls,actions,props}=await setup(t,{embedded:true,turns:[turn()]});
 assert.equal(r.queryByText('Open conversation'),null);
 assert.match(r.text(),/Please review this recording/);
 assert.equal(r.document.querySelectorAll('textarea').length,1);
 assert.equal(calls.length,1);assert.equal(calls[0].init.method,undefined);
 await type(r,'Keep this unsent feedback while I review the example.');
 await r.rerender({...props,busy:true});
 assert.equal(r.document.querySelector('textarea')!.value,'Keep this unsent feedback while I review the example.');
 assert.equal(calls.length,1);assert.equal(actions.length,0);
});

test('selected feedback is an explicit target, never sent by opening; Send binds target and clears it after save',async t=>{
 const {r,calls,props}=await setup(t,{guided:true,embedded:true});
 const target={kind:'feedback',id:id(40),digest:H},request={key:'first-target',target,prompt:'Please prepare a learning from the selected feedback.'};
 let saved=0;await r.rerender({...props,request,onSaved:()=>saved++});
 assert.equal(calls.filter(c=>c.init.method==='POST').length,0);assert.equal(saved,0);
 assert.match(r.text(),/Nothing is sent until Send/);
 await r.click(r.getByText('Send'));const b=JSON.parse(calls.find(c=>c.init.method==='POST').init.body);
 assert.deepEqual(b.target,target);assert.equal(b.changesContract,'guided-training-changes.v1');assert.equal(saved,1);
 assert.equal(r.queryByText('Cancel selected target'),null);
 await type(r,'Prefer fewer labels.');await r.click(r.getByText('Send'));
 const normal=JSON.parse(calls.filter(c=>c.init.method==='POST').at(-1).init.body);assert.equal(normal.target,null);
});
test('switching selected targets changes idempotency identity and a version switch drops an unsent target',async t=>{
 const {r,calls,props}=await setup(t,{guided:true,embedded:true});
 await r.rerender({...props,request:{key:'target-one',target:{kind:'record',id:id(40),digest:H},prompt:'Prefer quieter emphasis.'}});
 await r.rerender({...props,request:{key:'target-two',target:{kind:'record',id:id(41),digest:H},prompt:'Prefer quieter emphasis.'}});
 await r.click(r.getByText('Send'));assert.equal(JSON.parse(calls.find(c=>c.init.method==='POST').init.body).target.id,id(41));
 await r.rerender({...props,versionId:id(90),disabled:true});assert.equal(r.queryByText('Cancel selected target'),null);
});
