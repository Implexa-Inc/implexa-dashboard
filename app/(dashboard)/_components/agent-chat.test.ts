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
