import test from 'node:test';
import assert from 'node:assert/strict';
import {render,type Rendered} from '../../../lib/test/render.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,OWNER=id(1),H='a'.repeat(64);
const turn=(n:number,patch:any={})=>({turnId:id(n),message:'Create a presenter video editor.',baseReplyId:null,createdAt:'2026-10-31T12:00:00Z',status:'answered',
 replyId:id(n+100),replyDigest:H,reply:'Prepared; nothing has started.',brief:{name:'Video studio',goal:'Edit presenter footage.',inputs:['One raw video'],outputs:['Playable MP4'],tools:[{name:'Remotion',requirement:'required'}]},
 trainingNotes:['Prefer warm, quiet layouts.'],questions:[],buildIntent:'Edit presenter footage. Deliver MP4.',toolPreferences:['remotion'],tools:[{name:'Remotion',requirement:'required',supported:true}],model:'claude-haiku-5-5',reason:null,...patch});
async function type(r:Rendered,s:string){const e=r.document.querySelector('textarea')!;await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(e,s);e.dispatchEvent(new r.window.Event('input',{bubbles:true}));});}
async function setup(t:any,initial:any[]=[]){
 let turns=initial;const calls:any[]=[];let draftId='';
 const r=await render('./guided-agent-creation.tsx',{ownerId:OWNER},{fetch:(async(url:string,init:any={})=>{
  calls.push({url,init});
  if(url==='/api/agents/plan-preview')return {ok:true,json:async()=>({ok:true,decisionMode:'direct',autoToolPreferences:['ffmpeg'],disclosures:[]})};
  if(url==='/api/agents/create')return {ok:true,json:async()=>({ok:true,request:{id:id(99)}})};
  if(init.method==='POST'){const b=JSON.parse(init.body);draftId=b.draftId;turns=[...turns,turn(turns.length+2,{turnId:b.turnId,message:b.message,baseReplyId:b.baseReplyId})];}
  else draftId=new URL(url,'https://test.invalid').searchParams.get('draftId')!;
  return {ok:true,json:async()=>({ok:true,contractVersion:'agent-creation-brief.v1',draftId,turns,totalTurns:turns.length,buildRequestId:null})};
 }) as typeof fetch});t.after(()=>r.cleanup());return {r,calls};
}
test('creation opens with one blank chat, restores saved cards by GET and starts nothing',async t=>{
 const {r,calls}=await setup(t,[turn(2)]);assert.equal(r.document.querySelectorAll('textarea').length,1);assert.equal(r.document.querySelectorAll('input:not([type=hidden])').length,0);
 assert.match(r.text(),/One raw video/);assert.match(r.text(),/Playable MP4/);assert.match(r.text(),/have not been admitted as learnings/);
 assert.equal(calls.length,1);assert.equal(calls[0].init.method,undefined);
 await r.click(r.getByText('Refresh saved draft'));assert.equal(calls.length,2);assert.equal(calls.some(c=>c.init.method==='POST'),false);
});
test('Send preserves words and exact selected base; edits and Undo never build or call another provider',async t=>{
 const {r,calls}=await setup(t,[turn(2)]);await type(r,'  Keep the task, but prefer FFmpeg.  ');await r.click(r.getByText('Send'));
 const posts=calls.filter(c=>c.url==='/api/agents/creation-draft'&&c.init.method==='POST');assert.equal(posts.length,1);
 const b=JSON.parse(posts[0].init.body);assert.equal(b.message,'  Keep the task, but prefer FFmpeg.  ');assert.equal(b.baseReplyId,id(102));assert.equal(b.consent,true);
 await r.click(r.getByText('Undo last change'));assert.match(r.text(),/Previous saved draft restored/);assert.equal(calls.filter(c=>c.init.method==='POST').length,1);
 assert.equal(calls.some(c=>c.url==='/api/agents/create'),false);
});
test('explicit Build passes only the chosen private-source reference and public intent through the existing gate',async t=>{
 const {r,calls}=await setup(t,[turn(2)]);await r.click(r.getByText('Build this agent'));
 await r.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
 const creates=calls.filter(c=>c.url==='/api/agents/create');assert.equal(creates.length,1);
 const body=JSON.parse(creates[0].init.body);assert.deepEqual(body.creationDraftBinding,{draftId:new URL(calls[0].url,'https://test.invalid').searchParams.get('draftId'),replyId:id(102),replyDigest:H});
 assert.equal(body.intent,'');assert.deepEqual(body.creationDraftFiles,[]);assert.equal(body.toolPreferences,undefined);assert.doesNotMatch(JSON.stringify(body),/warm, quiet|trainingNotes/);
 assert.match(r.text(),/not yet a built or tested agent/);
});
test('a pending durable reply prevents duplicate Send and Build, but can still be read',async t=>{
 const {r,calls}=await setup(t,[turn(2),turn(3,{status:'pending',replyId:null,replyDigest:null,reply:null,brief:null,model:null,trainingNotes:[],questions:[],buildIntent:null,tools:[],toolPreferences:[]})]);
 assert.equal((r.getByText('Build this agent') as HTMLButtonElement).disabled,true);assert.equal(r.document.querySelector('textarea')!.disabled,true);
 await r.click(r.getByText('Refresh saved draft'));assert.equal(calls.length,2);assert.equal(calls.some(c=>c.init.method==='POST'),false);
});
test('Undo from a new branch selects its actual base, not the abandoned preceding list item',async t=>{
 const {r,calls}=await setup(t,[turn(2),turn(3,{baseReplyId:id(102),message:'Abandoned branch'}),turn(4,{baseReplyId:id(102),message:'Current branch'})]);
 await r.click(r.getByText('Undo last change'));await type(r,'Revise the restored draft.');await r.click(r.getByText('Send'));
 const post=calls.find(c=>c.url==='/api/agents/creation-draft'&&c.init.method==='POST');assert.equal(JSON.parse(post.init.body).baseReplyId,id(102));
});
