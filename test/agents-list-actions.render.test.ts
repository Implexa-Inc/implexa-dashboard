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
