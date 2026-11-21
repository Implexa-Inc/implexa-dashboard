import {test} from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../lib/test/render.ts';
const agent=(slug:string,extra:Record<string,unknown>={})=>({slug,name:slug==='owned'?'My agent':'Another agent',source:'generated',section:'on_demand',category:{key:'video',label:'Video',emoji:''},...extra});
test('known owners get the existing edit-chat and training paths; unknown ownership never inherits source fallback',async()=>{
 const r=await render('agents-list.tsx',{agents:[agent('owned',{canTrain:true}),agent('unknown')],availableAgents:[]});
 try{
  const menus=Array.from(r.document.querySelectorAll('button[aria-label="More actions"]'));
  await r.click(menus[0]);assert.ok(r.document.querySelector('a[href="/training/owned"]'));assert.ok(r.document.querySelector('a[href="/training/owned?chat=edit"]'));
  await r.click(menus[0]);await r.click(menus[1]);assert.equal(r.document.querySelector('a[href="/training/unknown"]'),null);
  assert.equal(r.calls.backend.length,0,'opening a menu never edits or trains');
  assert.doesNotMatch(r.text(),/Readiness|Tested engine/);
 }finally{r.cleanup();}
});
test('drafts can be archived, and Pause retains the original stop-schedule operation',async()=>{
 const r=await render('agents-list.tsx',{agents:[agent('owned',{canTrain:true,section:'scheduled'}),agent('draft',{section:'not_activated',canTrain:true})]},{backend:()=>({ok:true})});
 try{
  await r.click(r.document.querySelector('button[aria-label="More actions"]')!);
  const pause=Array.from(r.document.querySelectorAll('[role="menuitem"]')).find(node=>node.textContent?.startsWith('Pause'));assert.ok(pause);
  await r.click(pause!);assert.equal(r.calls.backend.at(-1)?.path,'/api/v2/me/workflows/deactivate');
  const draftGroup=Array.from(r.document.querySelectorAll('summary')).find(node=>node.textContent?.startsWith('Drafts'));assert.ok(draftGroup);await r.click(draftGroup!);
  const draftRow=Array.from(r.document.querySelectorAll('li')).find(node=>node.querySelector('a[href*="/workflows/draft"]'));assert.ok(draftRow);
  await r.click(draftRow!.querySelector('button[aria-label="More actions"]')!);
  const archive=Array.from(r.document.querySelectorAll('[role="menuitem"]')).find(node=>node.textContent?.startsWith('Archive'));assert.ok(archive);await r.click(archive!);
  assert.equal(r.calls.backend.at(-1)?.path,'/api/v2/me/workflows/dismiss');
 }finally{r.cleanup();}
});

test('active roster is capped, Run keeps the normal agent gate, and result links remain separate',async()=>{
 const agents=Array.from({length:10},(_,i)=>agent(`video-${i}`,{lastRun:{id:`run-${i}`,status:'completed',runState:'completed',ranAt:`2026-11-${String(10+i).padStart(2,'0')}T12:00:00Z`}}));
 const r=await render('agents-list.tsx',{agents});
 try{assert.equal(r.document.querySelectorAll('.agent-roster-row').length,8);const row=r.document.querySelector('.agent-roster-row')!;assert.equal(row.querySelector('a.agent-run')?.textContent,'Run');assert.match(row.querySelector('a.agent-run')?.getAttribute('href')||'',/\/workflows\/video-9\?source=generated/);assert.equal(row.querySelector('.agent-last-run')?.getAttribute('href'),'/runs/run-9');await r.click(r.getByText('Show all 10'));assert.equal(r.document.querySelectorAll('.agent-roster-row').length,10);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});
test('attention cards cap at three, favorites at four, and unavailable roster does not claim no agents',async()=>{
 const agents=Array.from({length:6},(_,i)=>agent(`agent-${i}`,{favorite:true,needsIntervention:true,interventionReason:'Connect the account'}));
 const r=await render('agents-list.tsx',{agents});
 try{assert.equal(r.document.querySelectorAll('.agent-need-card').length,3);assert.equal(r.document.querySelectorAll('.agent-favorite-card').length,4);await r.click(r.document.querySelector('section[aria-label="Needs you"] .agent-section-more button')!);assert.equal(r.document.querySelectorAll('.agent-need-card').length,6);}finally{r.cleanup();}
 const missing=await render('agents-list.tsx',{agents:[],rosterKnown:false});try{assert.doesNotMatch(missing.text(),/No agents yet/);}finally{missing.cleanup();}
});

test('a recovered server roster replaces the prior empty view without remounting',async()=>{
 const r=await render('agents-list.tsx',{agents:[],rosterKnown:false});
 try{assert.doesNotMatch(r.text(),/No agents yet/);await r.rerender({agents:[agent('recovered',{name:'Recovered agent'})],rosterKnown:true});assert.match(r.text(),/Recovered agent/);assert.equal(r.document.querySelectorAll('.agent-roster-row').length,1);assert.doesNotMatch(r.text(),/No agents yet/);}finally{r.cleanup();}
});

test('archive and rollback keep the collection header count consistent with the visible roster',async()=>{
 let fail=false;
 const r=await render('../../../test/fixtures/agent-collection.tsx',{agents:[agent('first',{name:'First'}),agent('second',{name:'Second'})]},{backend:()=>{if(fail)throw new Error('unavailable');return {ok:true};}});
 try{
  const count=()=>r.document.querySelector('nav[aria-label="Agents views"] a')?.textContent?.trim();
  assert.equal(count(),'Your agents 2');
  await r.click(r.document.querySelector('button[aria-label="More actions"]')!);
  await r.click(Array.from(r.document.querySelectorAll('[role="menuitem"]')).find(n=>n.textContent?.startsWith('Archive'))!);
  assert.equal(count(),'Your agents 1');
  fail=true;await r.click(r.document.querySelector('button[aria-label="More actions"]')!);
  await r.click(Array.from(r.document.querySelectorAll('[role="menuitem"]')).find(n=>n.textContent?.startsWith('Archive'))!);
  assert.equal(count(),'Your agents 1');assert.match(r.text(),/Could not archive/);
 }finally{r.cleanup();}
});
