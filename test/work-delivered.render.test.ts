import {test} from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../lib/test/render.ts';
const item={id:'result-id',slug:'agent-a',source:'manual',name:'Video agent',why:null,output_markdown:'The delivered output.',ran_at:'2026-11-21T12:00:00Z',pending:false,stepsState:null,holdKind:null,state:{state:'completed',label:'Done',attention:false,tone:'ok'},verification:'not_recorded',feedbackQuestions:null,feedbackAnswers:null,feedbackAt:null,recommendations:null,judgment:null};
test('Delivered uses shared rows and keeps the result overlay, feedback and continuation on its filter',async()=>{
 const r=await render('../inbox/inbox-list.tsx',{initialItems:[item],basePath:'/work?view=delivered',heading:null,workRows:true},{backend:()=>({ok:true}),fetch:(async()=>Response.json({})) as typeof fetch});
 try{
  await r.act(async()=>{});
  assert.equal(r.document.querySelectorAll('.work-item-row').length,1);
  const open=r.queryByText('Open');assert.ok(open);
  await r.click(open!);
  assert.equal(r.calls.replace.at(-1),'/work?view=delivered&run=result-id');
  assert.ok(r.document.querySelector('[role="dialog"]'));
  assert.match(r.text(),/The delivered output/);
  assert.match(r.text(),/Continue/);
  await r.act(()=>r.window.dispatchEvent(new r.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(r.calls.replace.at(-1),'/work?view=delivered');
  assert.equal(r.document.querySelector('[role="dialog"]'),null);
 }finally{r.cleanup();}
});
