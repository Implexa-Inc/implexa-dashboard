import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../../lib/test/render.ts';

test('disabled image annotation also prevents starting a voice capture',async()=>{
 const calls:any[]=[],r=await render('../training/[slug]/training-image-player.tsx',{ownerId:'11111111-1111-4111-8111-111111111111',sourceId:'source',image:'data:image/png;base64,aW1hZ2U=',timeMs:0,text:'',disabled:true,onChange:()=>{},onDone:()=>{}},{bridge:{trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{calls.push({op,args});return {ok:false};}}});
 try{const button=[...r.document.querySelectorAll('button')].find(button=>button.textContent?.includes('Add a voice note'))!;assert.equal(button.disabled,true);await r.click(button);assert.deepEqual(calls.filter(call=>call.op!=='listVoiceNotes'),[],'disabled annotation permits only read-only saved-note recovery, never capture or mutation');for(const call of calls)assert.deepEqual(JSON.parse(JSON.stringify(call.args)),{sourceRef:'source',expectedOwnerId:'11111111-1111-4111-8111-111111111111'});}finally{r.cleanup();}
});

test('a reopened image keeps its original spatial mark when the trainer edits the note',async()=>{
 const spatial={geometry:{kind:'point',x:0.2,y:0.3,width:null,height:null},sourceFrame:{visualWidth:640,visualHeight:360}},changes:any[]=[];
 const r=await render('../training/[slug]/training-image-player.tsx',{ownerId:'11111111-1111-4111-8111-111111111111',sourceId:'source',image:'data:image/png;base64,aW1hZ2U=',timeMs:0,text:'Saved note',initialSpatial:spatial,disabled:false,onChange:(text:string,mark:any)=>changes.push({text,mark}),onDone:()=>{}});
 try{
  const area=r.document.querySelector('textarea')!;
  await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(area,'Updated note');area.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
  assert.equal(changes.length,1);assert.equal(changes[0].text,'Updated note');assert.deepEqual(JSON.parse(JSON.stringify(changes[0].mark)),spatial);
  await r.rerender({ownerId:'11111111-1111-4111-8111-111111111111',sourceId:'second',key:'second-source',image:'data:image/png;base64,aW1hZ2U=',timeMs:0,text:'New note',initialSpatial:null,disabled:false,onChange:(text:string,mark:any)=>changes.push({text,mark}),onDone:()=>{}});
  const fresh=r.document.querySelector('textarea')!;await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(fresh,'Another note');fresh.dispatchEvent(new r.window.Event('input',{bubbles:true}));});assert.equal(changes.at(-1).mark,null,'a new source cannot inherit the prior mark');
 }finally{r.cleanup();}
});
