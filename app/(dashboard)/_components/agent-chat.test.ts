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
