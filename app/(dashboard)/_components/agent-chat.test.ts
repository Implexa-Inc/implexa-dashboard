import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';

test('the common composer sends Enter, preserves Shift+Enter and never sends while composing or disabled',async t=>{
 let sent=0;const props={value:'My feedback',onChange:()=>{},onSend:()=>sent++};const r=await render('./agent-chat.tsx',props,{exportName:'ChatComposer'});t.after(()=>r.cleanup());
 const area=r.document.querySelector('textarea')!;
 await r.act(()=>area.dispatchEvent(new r.window.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true})));assert.equal(sent,0);
 await r.act(()=>area.dispatchEvent(new r.window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));assert.equal(sent,0);
 await r.act(()=>area.dispatchEvent(new r.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));assert.equal(sent,1);
 await r.rerender({...props,sendDisabled:true});await r.act(()=>area.dispatchEvent(new r.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));assert.equal(sent,1);
});
test('choice boxes return only the selected draft answer and do not call an API',async t=>{
 let fetches=0;const values:string[]=[];const r=await render('./agent-chat.tsx',{question:'Which tools?',choices:[{label:'Recommend tools',value:'Please recommend tools.'}],onChoose:(value:string)=>values.push(value)},{exportName:'ChatChoices',fetch:(async()=>{fetches++;return {ok:true};}) as typeof fetch});t.after(()=>r.cleanup());
 await r.click(r.getByText('Recommend tools'));assert.deepEqual(values,['Please recommend tools.']);assert.equal(fetches,0);
});

test('voice uses local dictation, preserves typed text and never auto-sends',async()=>{
 let composerId='',changes:string[]=[],sent=0;const id='70000000-0000-4000-8000-000000000001';
 const r=await render('./agent-chat.tsx',{voiceScope:'session-a',value:'Existing note.',onChange:(v:string)=>changes.push(v),onSend:()=>sent++},{exportName:'ChatComposer',auth:{getUser:async()=>({data:{user:{id}}})},bridge:{chatDictationContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{assert.equal(args.expectedOwnerId,id);if(op==='startChatDictation'){composerId=args.composerId;return {ok:true,voiceNoteId:id};}if(op==='getVoiceNote')return {ok:true,voiceNote:{state:'ready',attach:{sourceKind:'composer',sourceRef:composerId,mark:null}}};assert.equal(op,'transcribeChatDictation');return {ok:true,transcript:{text:'Keep the diagram simple.'}};}}});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 try{await r.click(r.document.querySelector('[aria-label="Dictate message"]')!);assert.equal((r.document.querySelector('[aria-label="Send message"]') as HTMLButtonElement).disabled,true);await r.act(()=>new Promise(resolve=>setTimeout(resolve,760)));assert.deepEqual(changes,['Existing note. Keep the diagram simple.']);assert.equal(sent,0);}finally{r.cleanup();}
});
test('a late dictation result cannot enter a different conversation',async()=>{
 let composerId='',changes:string[]=[];const id='70000000-0000-4000-8000-000000000001';let release:(x:any)=>void=()=>{};
 const props={voiceScope:'session-a',value:'',onChange:(v:string)=>changes.push(v),onSend:()=>assert.fail('sent')};
 const r=await render('./agent-chat.tsx',props,{exportName:'ChatComposer',auth:{getUser:async()=>({data:{user:{id}}})},bridge:{chatDictationContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{if(op==='startChatDictation'){composerId=args.composerId;return {ok:true,voiceNoteId:id};}if(op==='getVoiceNote')return {ok:true,voiceNote:{state:'ready',attach:{sourceKind:'composer',sourceRef:composerId,mark:null}}};if(op==='discardChatDictation')return {ok:true};return new Promise(resolve=>{release=resolve;});}}});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 try{await r.click(r.document.querySelector('[aria-label="Dictate message"]')!);await r.act(()=>new Promise(resolve=>setTimeout(resolve,760)));await r.rerender({...props,voiceScope:'session-b'});await r.act(()=>release({ok:true,transcript:{text:'Old conversation text.'}}));assert.deepEqual(changes,[]);}finally{r.cleanup();}
});

test('cancelled and silent dictation show useful feedback without editing or sending the draft',async()=>{
 const id='70000000-0000-4000-8000-000000000001';
 for(const reason of ['recording_not_found','no_speech']){
  let composerId='',discarded=0,changed=0,sent=0;
  const r=await render('./agent-chat.tsx',{voiceScope:'session-a',value:'My typed note.',onChange:()=>changed++,onSend:()=>sent++},{exportName:'ChatComposer',auth:{getUser:async()=>({data:{user:{id}}})},bridge:{chatDictationContractVersion:'1',reviewRecorder:async(op:string,args:any)=>{if(op==='startChatDictation'){composerId=args.composerId;return {ok:true,voiceNoteId:id};}if(op==='discardChatDictation'){discarded++;return {ok:true};}if(op==='getVoiceNote')return reason==='recording_not_found'?{ok:false,reason}:{ok:true,voiceNote:{state:'ready',attach:{sourceKind:'composer',sourceRef:composerId,mark:null}}};return {ok:false,reason};}}});
  try{await r.click(r.document.querySelector('[aria-label="Dictate message"]')!);await r.act(()=>new Promise(resolve=>setTimeout(resolve,760)));assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement).value,'My typed note.');assert.equal(changed,0);assert.equal(sent,0);assert.equal(discarded,1);assert.equal((r.document.querySelector('[aria-label="Dictate message"]') as HTMLButtonElement).disabled,false);if(reason==='recording_not_found'){assert.match(r.text(),/Dictation ended without changing your message/);assert.equal(r.document.querySelector('[role=alert]'),null);}else assert.match(r.text(),/No speech was heard. Check your microphone and try again/);}finally{r.cleanup();}
 }
});
