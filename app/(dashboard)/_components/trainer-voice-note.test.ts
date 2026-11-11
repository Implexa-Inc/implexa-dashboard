import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';
const owner='11111111-1111-4111-8111-111111111111',note='22222222-2222-4222-8222-222222222222',sha='a'.repeat(64);
const attach={sourceKind:'run_artifact',sourceRef:'run:artifact',mark:{frameMs:5000,region:{x:0,y:0,width:1000000,height:1000000}}};
test('voice uses trusted Desktop recorder only; transcript is editable and enters feedback only on explicit Add',async()=>{
 const calls:any[]=[],inserted:string[]=[];
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{calls.push({op,args});assert.equal(args.expectedOwnerId,owner);
  if(op==='startVoiceNote')return {ok:true,voiceNoteId:note};
  if(op==='getVoiceNote')return {ok:true,voiceNote:{voiceNoteId:note,state:'ready',attach,sha256:sha,durationMs:1000,failureReason:null}};
  if(op==='transcribeVoiceNote')return {ok:true,transcript:{text:'Use a meaningful map.',voiceNoteSha256:sha,digest:sha,language:null,segments:[],modelRevision:'local'}};
  throw Error('Unexpected native operation');}};
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach,onInsert:(text:string)=>inserted.push(text)},{bridge});
 try{
  assert.equal(calls.length,0);await r.click(r.getByText('Add a voice note'));await r.act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  assert.deepEqual(calls.map(call=>call.op),['startVoiceNote','getVoiceNote','transcribeVoiceNote']);assert.deepEqual(calls[0].args.attach,attach);assert.equal(inserted.length,0);
  const area=r.document.querySelector('textarea')!;await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(area,'Use a map only when geography matters.');area.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
  await r.click(r.getByText('Add to this note'));assert.deepEqual(inserted,['Use a map only when geography matters.']);assert.equal(calls.some(call=>['trainingLocal','accept'].includes(call.op)),false);
 }finally{r.cleanup();}
});
test('a late voice note cannot attach to a different source or mark',async()=>{
 let resolve:any;const inserted:string[]=[];
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string)=>op==='startVoiceNote'?{ok:true,voiceNoteId:note}:op==='getVoiceNote'?new Promise(done=>resolve=done):{ok:true}};
 const props={ownerId:owner,attach,onInsert:(text:string)=>inserted.push(text)};
 const r=await render('trainer-voice-note.tsx',props,{bridge});
 try{await r.click(r.getByText('Add a voice note'));await r.rerender({...props,attach:{...attach,sourceRef:'another:artifact'}});
  await r.act(async()=>{resolve({ok:true,voiceNote:{voiceNoteId:note,state:'ready',attach,sha256:sha,durationMs:1000,failureReason:null}});await new Promise(done=>setTimeout(done,10));});
  assert.equal(r.document.querySelector('textarea'),null);assert.equal(inserted.length,0);
 }finally{r.cleanup();}
});
test('missing capability is text-only and overlong transcript is not silently truncated',async()=>{
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach,onInsert:()=>{throw Error('must not insert');}},{bridge:{}});
 try{assert.match(r.text(),/Update Desktop for voice notes/);assert.equal((r.getByText('Add a voice note') as HTMLButtonElement).disabled,true);}finally{r.cleanup();}
});

test('a pending native start is unsaved work before the recorder returns its id',async()=>{
 let resolveStart:(value:any)=>void=()=>{};const dirty:boolean[]=[];
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string)=>op==='startVoiceNote'?new Promise(resolve=>{resolveStart=resolve;}):{ok:false}};
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach,onInsert:()=>{},onDirtyChange:(value:boolean)=>dirty.push(value)},{bridge});
 try{await r.click(r.getByText('Add a voice note'));assert.equal(dirty.at(-1),true,'a source cannot be replaced while its native recorder is starting');}
 finally{await r.act(async()=>resolveStart({ok:false,reason:'recorder_failed'}));r.cleanup();}
});
