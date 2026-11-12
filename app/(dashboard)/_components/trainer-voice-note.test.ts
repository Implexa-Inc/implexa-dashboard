import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';
const owner='11111111-1111-4111-8111-111111111111',note='22222222-2222-4222-8222-222222222222',sha='a'.repeat(64);
const attach={sourceKind:'run_artifact',sourceRef:'run:artifact',mark:{frameMs:5000,region:{x:0,y:0,width:1000000,height:1000000}}};
test('voice uses trusted Desktop recorder only; transcript is editable and enters feedback only on explicit Add',async()=>{
 const calls:any[]=[],inserted:string[]=[];
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{calls.push({op,args});assert.equal(args.expectedOwnerId,owner);
  if(op==='listVoiceNotes')return {ok:true,voiceNotes:[]};
  if(op==='startVoiceNote')return {ok:true,voiceNoteId:note};
  if(op==='getVoiceNote')return {ok:true,voiceNote:{voiceNoteId:note,state:'ready',attach,sha256:sha,durationMs:1000,failureReason:null}};
  if(op==='transcribeVoiceNote')return {ok:true,transcript:{text:'Use a meaningful map.',voiceNoteSha256:sha,digest:sha,language:null,segments:[],modelRevision:'local'}};
  throw Error('Unexpected native operation');}};
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach,onInsert:(text:string)=>inserted.push(text)},{bridge});
 try{
  assert.deepEqual(calls.map(call=>call.op),['listVoiceNotes']);await r.click(r.getByText('Add a voice note'));await r.act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  assert.deepEqual(calls.map(call=>call.op),['listVoiceNotes','startVoiceNote','getVoiceNote','transcribeVoiceNote']);assert.deepEqual(JSON.parse(JSON.stringify(calls[1].args.attach)),attach);assert.equal(inserted.length,0);
  const area=r.document.querySelector('textarea')!;await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!.call(area,'Use a map only when geography matters.');area.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
  await r.click(r.getByText('Add to this note'));assert.deepEqual(inserted,['Use a map only when geography matters.']);assert.equal(calls.some(call=>['trainingLocal','accept'].includes(call.op)),false);
 }finally{r.cleanup();}
});
test('a late voice note cannot attach to a different source or mark',async()=>{
 let resolve:any;const inserted:string[]=[];
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string)=>op==='listVoiceNotes'?{ok:true,voiceNotes:[]}:op==='startVoiceNote'?{ok:true,voiceNoteId:note}:op==='getVoiceNote'?new Promise(done=>resolve=done):{ok:true}};
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

test('saved local notes recover by exact mark independent of JSON order and require explicit transcription and deletion',async()=>{
 const calls:any[]=[],inserted:string[]=[];let deleteCount=0;
 const reordered={mark:{region:{height:1000000,width:1000000,y:0,x:0},frameMs:5000},sourceRef:'run:artifact',sourceKind:'run_artifact'};
 const view={voiceNoteId:note,state:'ready',attach:reordered,sha256:sha,durationMs:1000,failureReason:null,createdAt:'2026-11-11T12:00:00Z'};
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{calls.push({op,args});assert.equal(args.expectedOwnerId,owner);
  if(op==='listVoiceNotes'){assert.equal(args.sourceRef,'run:artifact');return {ok:true,voiceNotes:[{...view,voiceNoteId:owner,attach:{...reordered,mark:{...reordered.mark,frameMs:6000}}},view]};}
  if(op==='getVoiceNote')return {ok:true,voiceNote:view};
  if(op==='transcribeVoiceNote')return {ok:true,transcript:{text:'A recovered preference.',voiceNoteSha256:sha,digest:sha}};
  if(op==='delete')return ++deleteCount===1?{ok:false,reason:'delete_cancelled'}:{ok:true};throw Error('Unexpected operation');}};
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach,onInsert:(text:string)=>inserted.push(text)},{bridge});
 try{
  assert.match(r.text(),/Saved voice notes for this mark \(1\)/);assert.deepEqual(calls.map(call=>call.op),['listVoiceNotes']);assert.equal(r.document.querySelector('textarea'),null);
  await r.click([...r.document.querySelectorAll('button')].find(button=>button.textContent?.startsWith('Recover voice note'))!);
  assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement)?.value,'A recovered preference.');assert.equal(inserted.length,0);
  await r.click(r.getByText('Add to this note'));assert.deepEqual(inserted,['A recovered preference.']);assert.match(r.text(),/Audio stays saved on this Mac/);assert.equal(deleteCount,0);
  await r.click(r.getByText('Delete saved voice note…'));assert.equal(deleteCount,1);assert.equal(r.document.querySelector('[role="alert"]'),null);assert.match(r.text(),/Audio stays saved/);
  await r.click(r.getByText('Delete saved voice note…'));assert.equal(deleteCount,2);assert.doesNotMatch(r.text(),/Audio stays saved/);assert.deepEqual(calls.filter(call=>call.op==='delete').map(call=>call.args.recordingId),[note,note]);
 }finally{r.cleanup();}
});

test('late recovery lists cannot offer notes from a previous source',async()=>{
 let release:(value:any)=>void=()=>{};let reads=0;
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string)=>op==='listVoiceNotes'?(++reads===1?new Promise(resolve=>release=resolve):{ok:true,voiceNotes:[]}):{ok:false}};
 const props={ownerId:owner,attach,onInsert:()=>{}},r=await render('trainer-voice-note.tsx',props,{bridge});
 try{await r.rerender({...props,attach:{...attach,sourceRef:'other:artifact'}});await r.act(async()=>{release({ok:true,voiceNotes:[{voiceNoteId:note,state:'ready',attach,sha256:sha,durationMs:1000,failureReason:null}]});await new Promise(resolve=>setTimeout(resolve,10));});assert.doesNotMatch(r.text(),/Recover voice note/);assert.equal(r.document.querySelector('textarea'),null);}finally{r.cleanup();}
});

for(const terminal of ['cancelled','discarded','start_failed'])test(`native voice ${terminal} settles without a screen-permission error`,async()=>{
 let listener:(value:any)=>void=()=>{},release:(value:any)=>void=()=>{};const dirty:boolean[]=[];
 const bridge={trainerCommentaryContractVersion:'1',onReviewRecorderChanged:(callback:(value:any)=>void)=>{listener=callback;return()=>{};},reviewRecorder:async(op:string)=>op==='listVoiceNotes'?{ok:true,voiceNotes:[]}:op==='startVoiceNote'?{ok:true,voiceNoteId:note}:op==='getVoiceNote'?new Promise(resolve=>release=resolve):{ok:false}};
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach,onInsert:()=>{},onDirtyChange:(value:boolean)=>dirty.push(value)},{bridge});
 try{
  await r.click(r.getByText('Add a voice note'));await r.act(()=>listener({ownerId:owner,recordingId:note,origin:'voice_note',state:terminal,...(terminal==='start_failed'?{failure:{phase:'started_ack',errorName:'NotAllowedError',reason:'microphone_unavailable'}}:{})}));
  if(terminal==='start_failed')assert.match(r.text(),/microphone is unavailable/);else assert.equal(r.document.querySelector('[role="alert"]'),null);
  assert.equal(dirty.at(-1),false);assert.doesNotMatch(r.text(),/screen or window|Screen Recording/);
 }finally{await r.act(async()=>release({ok:false,reason:'recording_not_found'}));r.cleanup();}
});

test('voice rectangle rounding stays inside native coordinate bounds',async()=>{
 const calls:any[]=[],edge={...attach,mark:{frameMs:0,region:{x:999999,y:0,width:2,height:1000001}}};
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{calls.push({op,args});return op==='listVoiceNotes'?{ok:true,voiceNotes:[]}:op==='startVoiceNote'?{ok:true,voiceNoteId:note}:{ok:false,reason:'recording_not_found'};}};
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach:edge,onInsert:()=>{}},{bridge});
 try{await r.click(r.getByText('Add a voice note'));assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call=>call.op==='startVoiceNote').args.attach.mark.region)),{x:999999,y:0,width:1,height:1000000});}finally{r.cleanup();}
});


test('an uninserted transcript cannot be replaced by starting another voice note',async()=>{
 let starts=0;const inserted:string[]=[];
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string)=>{
  if(op==='listVoiceNotes')return {ok:true,voiceNotes:[]};
  if(op==='startVoiceNote'){starts++;return {ok:true,voiceNoteId:note};}
  if(op==='getVoiceNote')return {ok:true,voiceNote:{voiceNoteId:note,state:'ready',attach,sha256:sha,durationMs:1000,failureReason:null}};
  if(op==='transcribeVoiceNote')return {ok:true,transcript:{text:'Keep this unsaved voice feedback.',voiceNoteSha256:sha,digest:sha}};
  throw Error(op);
 }};
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach,onInsert:(text:string)=>inserted.push(text)},{bridge});
 try{
  await r.click(r.getByText('Add a voice note'));assert.equal(starts,1);const add=r.getByText('Add a voice note') as HTMLButtonElement;assert.equal(add.disabled,true);await r.click(add);assert.equal(starts,1);assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement).value,'Keep this unsaved voice feedback.');assert.equal(inserted.length,0);
  await r.click(r.getByText('Dismiss voice note'));assert.equal((r.getByText('Add a voice note') as HTMLButtonElement).disabled,false);await r.click(r.getByText('Add a voice note'));assert.equal(starts,2,'an explicit dismissal allows a new capture');
 }finally{r.cleanup();}
});

test('a temporary transcription failure retries the same saved audio without recording again or inserting automatically',async()=>{
 const calls:any[]=[],inserted:string[]=[];let attempts=0;
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{
  calls.push({op,args});if(op==='listVoiceNotes')return {ok:true,voiceNotes:[]};
  if(op==='startVoiceNote')return {ok:true,voiceNoteId:note};
  if(op==='getVoiceNote')return {ok:true,voiceNote:{voiceNoteId:note,state:'ready',attach,sha256:sha,durationMs:1000}};
  if(op==='transcribeVoiceNote')return ++attempts===1?{ok:false,reason:'asr_unavailable'}:{ok:true,transcript:{text:'Keep the diagram clear.',voiceNoteSha256:sha,digest:sha}};
  throw Error('Unexpected native operation');
 }};
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach,onInsert:(text:string)=>inserted.push(text)},{bridge});
 try{
  await r.click(r.getByText('Add a voice note'));assert.match(r.text(),/retry this saved note/);
  await r.click(r.getByText('Retry saved voice note'));
  assert.equal(attempts,2);assert.equal(calls.filter(call=>call.op==='startVoiceNote').length,1);
  assert.deepEqual(calls.filter(call=>call.op==='transcribeVoiceNote').map(call=>call.args.recordingId),[note,note]);
  assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement).value,'Keep the diagram clear.');assert.deepEqual(inserted,[]);
  await r.click(r.getByText('Add to this note'));assert.deepEqual(inserted,['Keep the diagram clear.']);
 }finally{r.cleanup();}
});

for(const reason of ['no_speech','transcript_invalid'])test(`${reason} explains how to recover without repeatedly transcribing unusable audio`,async()=>{
 const bridge={trainerCommentaryContractVersion:'1',reviewRecorder:async(op:string)=>op==='listVoiceNotes'?{ok:true,voiceNotes:[]}:op==='startVoiceNote'?{ok:true,voiceNoteId:note}:op==='getVoiceNote'?{ok:true,voiceNote:{voiceNoteId:note,state:'ready',attach,sha256:sha,durationMs:1000}}:{ok:false,reason}};
 const r=await render('trainer-voice-note.tsx',{ownerId:owner,attach,onInsert:()=>assert.fail('failure must not insert text')},{bridge});
 try{await r.click(r.getByText('Add a voice note'));assert.match(r.text(),reason==='no_speech'?/Check the selected microphone and record again/:/Record again, or type your feedback/);assert.equal(r.queryByText('Retry saved voice note'),null);assert.equal((r.getByText('Add a voice note') as HTMLButtonElement).disabled,false);}finally{r.cleanup();}
});
