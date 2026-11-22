import {readFileSync} from 'node:fs';
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

test('Coach tiles and rows use actual pending decisions and distinguish unversioned training from zero',async()=>{
 const r=await render('training-agent-picker.tsx',{owned,loadSummary:true},{fetch:(async(url:any)=>String(url).includes('/coach?')?http(roster):{ok:false}) as typeof fetch});
 try{await flush(r);const tiles=r.document.querySelector('[aria-label="Coaching summary"]')!;assert.deepEqual([...tiles.querySelectorAll('b')].map(n=>n.textContent),['1+','2','0']);const row=r.document.querySelector('.coach-agent-row')!;assert.equal(row.querySelector('.coach-row-decisions b')?.textContent,'1');assert.equal(row.querySelector('.coach-row-learnings b')?.textContent,'0');assert.ok(r.document.querySelector('#coach-waiting'));assert.equal(r.document.querySelectorAll('#all-coach-agents .coach-agent-row').length,2,'Waiting shortcuts never remove rows from the full list');assert.match(r.text(),/No active version/);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});

// Complete actual Coach HTTP producer output over disposable full-schema SQL;
// see the pinned generator and provenance. Component-owned catalog props are synthetic.
const producerRoot=new URL('../lib/test/fixtures/training-owner-context/',import.meta.url);
const produced=(name:string)=>JSON.parse(readFileSync(new URL(name+'.json',producerRoot),'utf8'));
const roster=produced('coach-roster'),family=produced('coach-family'),unavailable=produced('coach-unavailable');
const ready=family.body.agents[0],unversioned=roster.body.agents.find((a:any)=>a.versionId===null);
const owned=[{workflow_id:ready.id,slug:ready.slug,name:'Ready agent',source:'generated',description:'Ready to teach.',updated_at:'2026-11-10T00:00:00Z'},{workflow_id:unversioned.id,slug:unversioned.slug,name:'Older agent',source:'generated',description:'An older harness.',updated_at:'2026-11-01T00:00:00Z'}];
const http=(packet:any)=>({ok:packet.status>=200&&packet.status<300,status:packet.status,headers:packet.headers,json:async()=>packet.body});
const flush=(r:any)=>r.act(()=>new Promise(resolve=>setTimeout(resolve,20)));

test('catalog rows are usable before one background summary; actual returned facts never move them',async()=>{
 let release:(v:any)=>void=()=>{};const waiting=new Promise(resolve=>{release=resolve;}),calls:string[]=[];
 const r=await render('training-agent-picker.tsx',{owned,loadSummary:true},{fetch:(async(url:any)=>{calls.push(String(url));if(String(url).includes('/agent-training/coach?'))return waiting;return {ok:false};}) as typeof fetch});
 try{
  const names=()=>Array.from(r.document.querySelectorAll('#all-coach-agents .coach-agent-row h3')).map(n=>n.textContent);
  assert.deepEqual(names(),['Ready agent','Older agent']);assert.match(r.text(),/Loading counts/);assert.equal(r.document.querySelector('#all-coach-agents .coach-agent-row .btn-outline')?.getAttribute('href'),'/training/owned');assert.doesNotMatch(r.text(),/Nothing waiting/);assert.equal(calls.filter(x=>x.includes('/coach?')).length,1);
  await r.act(()=>release(http(roster)));await flush(r);assert.deepEqual(names(),['Ready agent','Older agent'],'summary order differs from catalog; rows do not repartition');assert.ok(r.document.querySelector('#coach-waiting'),'Waiting shortcuts remain available without removing the same agent from the stable full list');assert.match(r.text(),/No active version/);assert.match(r.text(),/decisions and lessons aren’t counted/);
  const oldRow=Array.from(r.document.querySelectorAll('#all-coach-agents .coach-agent-row')).find(n=>n.textContent?.includes('Older agent'))!;assert.doesNotMatch(oldRow.textContent||'',/Nothing waiting|0 to decide/);assert.equal(calls.filter(x=>x.includes('/coach?')).length,1,'no automatic per-family fanout');
 }finally{release(http(roster));r.cleanup();}
});

test('failed summary leaves agents available; only an explicit row retry reads that exact family',async()=>{
 const calls:string[]=[];const r=await render('training-agent-picker.tsx',{owned,loadSummary:true},{fetch:(async(url:any)=>{const path=String(url);calls.push(path);return path.includes('familyId=')?http(family):http(unavailable);}) as typeof fetch});
 try{
  await flush(r);assert.match(r.text(),/Count unavailable/);assert.doesNotMatch(r.text(),/No agents to train yet|Nothing waiting/);assert.equal(r.document.querySelectorAll('#all-coach-agents .coach-agent-row').length,2);assert.equal(calls.filter(x=>x.includes('/coach?')).length,1);
  const first=r.document.querySelector('#all-coach-agents .coach-agent-row')!;await r.click(first.querySelector('button')!);await flush(r);
  const reads=calls.filter(x=>x.includes('/coach?'));assert.equal(reads.length,2);assert.equal(new URL(reads[1],'https://test.invalid').searchParams.get('familyId'),ready.id);assert.match(first.textContent||'',/Review 1/);assert.match(r.document.querySelectorAll('#all-coach-agents .coach-agent-row')[1].textContent||'',/Count unavailable/);
 }finally{r.cleanup();}
});

test('wrong-family responses, duplicate catalog binding and unmount never supply stale counts or automatic retries',async()=>{
 for(const bad of ['wrong-family','duplicate','duplicate-id','network']){
  const values=bad==='duplicate'?[owned[0],{...owned[0],workflow_id:unversioned.id}]:bad==='duplicate-id'?[owned[0],{...owned[0],slug:'alias',name:'Alias'}]:owned;const calls:string[]=[];
  const r=await render('training-agent-picker.tsx',{owned:values,loadSummary:true},{fetch:(async(url:any)=>{const path=String(url);calls.push(path);if(!path.includes('/coach?'))return {ok:false};if(bad==='network')throw Error('synthetic transport failure');if(path.includes('familyId='))return http(produced('coach-unversioned-family'));return bad==='duplicate-id'?http(roster):http(unavailable);}) as typeof fetch});
  try{await flush(r);const row=r.document.querySelector('#all-coach-agents .coach-agent-row')!;assert.match(row.textContent||'',/Count unavailable/);const retry=row.querySelector('button')!;
   if(bad==='duplicate'||bad==='duplicate-id')assert.equal((retry as HTMLButtonElement).disabled,true);else if(bad==='wrong-family'){await r.click(retry);await flush(r);assert.match(row.textContent||'',/Count unavailable/);assert.doesNotMatch(row.textContent||'',/Nothing waiting|No active version/);}
   assert.equal(calls.filter(x=>x.includes('/coach?')).length,bad==='wrong-family'?2:1);
  }finally{r.cleanup();}
 }
});

test('manual retry stays single-flight and a timed-out count becomes retryable again without a loop',async()=>{
 let calls=0;const r=await render('training-agent-picker.tsx',{owned,loadSummary:true},{fetch:(async(url:any,init:any={})=>{
  if(!String(url).includes('/coach?'))return {ok:false};calls++;if(!String(url).includes('familyId='))return http(unavailable);
  return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('synthetic timeout')),{once:true}));
 }) as typeof fetch});
 try{
  await flush(r);const first=r.document.querySelector('#all-coach-agents .coach-agent-row button')!;await r.click(first);assert.equal(calls,2);
  assert.ok(Array.from(r.document.querySelectorAll('#all-coach-agents .coach-agent-row button')).every(b=>(b as HTMLButtonElement).disabled));
  await r.act(()=>new Promise(resolve=>setTimeout(resolve,5100)));assert.equal(calls,2,'timeout never retries automatically');assert.equal((r.document.querySelector('#all-coach-agents .coach-agent-row button') as HTMLButtonElement).disabled,false);assert.match(r.text(),/Count unavailable/);
 }finally{r.cleanup();}
});

test('leaving the roster aborts its one in-flight summary instead of delivering stale account facts',async()=>{
 let signal:AbortSignal|undefined,release:(v:any)=>void=()=>{};const wait=new Promise(resolve=>{release=resolve;});let reads=0;
 const r=await render('training-agent-picker.tsx',{owned,loadSummary:true},{fetch:(async(url:any,init:any={})=>{if(!String(url).includes('/coach?'))return {ok:false};reads++;signal=init.signal;return wait;}) as typeof fetch});
 assert.equal(reads,1);assert.equal(signal?.aborted,false);r.cleanup();assert.equal(signal?.aborted,true);release(http(roster));assert.equal(reads,1);
});

test('Retry counts explicitly reopens one complete summary while keeping the same catalog list',async()=>{
 let reads=0;const r=await render('training-agent-picker.tsx',{owned,loadSummary:true},{fetch:(async(url:any)=>{if(!String(url).includes('/coach?'))return {ok:false};reads++;return http(reads===1?unavailable:roster);}) as typeof fetch});
 try{await flush(r);assert.equal(reads,1);assert.match(r.text(),/Count unavailable/);const names=()=>Array.from(r.document.querySelectorAll('#all-coach-agents .coach-agent-row h3')).map(n=>n.textContent);const before=names();await r.click(r.getByText('Retry counts'));await flush(r);assert.equal(reads,2);assert.deepEqual(names(),before);assert.ok(r.document.querySelector('#coach-waiting'));assert.equal(r.document.querySelectorAll('#all-coach-agents .coach-agent-row').length,2);}finally{r.cleanup();}
});

test('malformed non-string catalog IDs leave only their own rows unknown instead of crashing the roster',async()=>{
 for(const workflow_id of [42,{},null]){
  const r=await render('training-agent-picker.tsx',{owned:[{...owned[0],workflow_id},owned[1]],loadSummary:true},{fetch:(async(url:any)=>String(url).includes('/coach?')?http(roster):{ok:false}) as typeof fetch});
  try{await flush(r);assert.equal(r.document.querySelectorAll('#all-coach-agents .coach-agent-row').length,2);assert.match(r.document.querySelector('#all-coach-agents .coach-agent-row')!.textContent||'',/Count unavailable/);assert.equal((r.document.querySelector('#all-coach-agents .coach-agent-row button') as HTMLButtonElement).disabled,true);assert.match(r.document.querySelectorAll('#all-coach-agents .coach-agent-row')[1].textContent||'',/No active version/);}finally{r.cleanup();}
 }
});
