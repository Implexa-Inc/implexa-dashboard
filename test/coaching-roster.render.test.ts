import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../lib/test/render.ts';
const agent=(n:number,source='generated')=>({slug:`agent-${n}`,name:`Agent ${n}`,description:`Useful output ${n}. More detail.`,source});
test('Coach shows only trainer-owned harnesses, deduplicates them and keeps the recording target',async()=>{
 const recordingId='11111111-1111-4111-8111-111111111111';
 const r=await render('training-agent-picker.tsx',{owned:[agent(1),agent(1),agent(2,'community')],recordingId});
 try{assert.equal(r.document.querySelectorAll('[role="dialog"] .coach-agent-row').length,1);assert.doesNotMatch(r.text(),/Agent 2/);assert.ok(r.document.querySelector('[role="dialog"][aria-label="Which agent should this recording teach?"]'));assert.match(r.text(),/Which agent should this recording teach/);assert.equal(r.getByText('Choose agent').getAttribute('href'),`/training/agent-1?annotateRecording=${recordingId}`);assert.match(r.text(),/Useful output 1/);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});
test('Coach searches by the actual name or description and expands the same roster',async()=>{
 const r=await render('training-agent-picker.tsx',{owned:Array.from({length:10},(_,i)=>agent(i))});
 try{assert.equal(r.document.querySelectorAll('.coach-agent-row').length,8);await r.click(r.getByText('Show all 10'));assert.equal(r.document.querySelectorAll('.coach-agent-row').length,10);const search=r.document.querySelector('input')!;await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLInputElement.prototype,'value')!.set!.call(search,'Useful output 9');search.dispatchEvent(new r.window.Event('input',{bubbles:true}));});assert.equal(r.document.querySelectorAll('.coach-agent-row').length,1);assert.match(r.text(),/Agent 9/);await r.click(r.getByText('All · 10'));assert.equal(r.document.querySelectorAll('.coach-agent-row').length,8);}finally{r.cleanup();}
});
test('known empty and unavailable Coach sources never use the same state',async()=>{
 const empty=await render('training-agent-picker.tsx',{owned:[]});try{assert.match(empty.text(),/No agents to train yet/);assert.ok(empty.document.querySelector('.collection-empty-enso'));}finally{empty.cleanup();}
 const partial=await render('training-agent-picker.tsx',{owned:[],partial:true});try{assert.doesNotMatch(partial.text(),/No agents to train yet|All · 0/);assert.match(partial.text(),/Some agents couldn’t be checked/);assert.ok(partial.document.querySelector('[role="alert"] button.btn-outline'));}finally{partial.cleanup();}
 const failed=await render('training-agent-picker.tsx',{reason:'timeout'},{exportName:'TrainingFeedUnavailable'});try{assert.match(failed.text(),/Couldn’t load the agents you train/);assert.doesNotMatch(failed.text(),/No agents to train yet/);}finally{failed.cleanup();}
});

test('Coach orders by existing updated_at with deterministic fallback and keeps feedback beside search',async()=>{
 const r=await render('training-agent-picker.tsx',{owned:[{...agent(1),updated_at:'2026-11-01T00:00:00Z'},{...agent(2),updated_at:'2026-11-20T00:00:00Z'},{...agent(3),updated_at:'invalid'}]});
 try{const rows=[...r.document.querySelectorAll('.coach-agent-row h3')].map(x=>x.textContent);assert.deepEqual(rows,['Agent 2','Agent 1','Agent 3']);assert.ok(r.document.querySelector('.coach-collection-tools input'));assert.equal(r.document.querySelector('.coach-collection-tools a')?.getAttribute('href'),'/training?view=review');assert.doesNotMatch(r.text(),/taught today|last trained/);}finally{r.cleanup();}
});

test('closing the recording target dialog keeps the recording untouched and normal Train links clean',async()=>{
 const recordingId='11111111-1111-4111-8111-111111111111';const r=await render('training-agent-picker.tsx',{owned:[agent(1)],recordingId});
 try{r.window.history.replaceState(null,'',`/training?recordingId=${recordingId}&view=mine#position`);await r.click(r.document.querySelector('[role="dialog"] button[aria-label="Close"]')!);assert.equal(r.document.querySelector('[role="dialog"]'),null);assert.equal(r.getByText('Train').getAttribute('href'),'/training/agent-1');assert.deepEqual(r.calls.replace,['/training?view=mine#position']);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});
