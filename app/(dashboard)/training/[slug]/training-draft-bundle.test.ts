import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../../lib/test/render.ts';
const draft={id:'one',digest:'a'.repeat(64),judgment:'Use a map when location explains the point.',appliesWhen:'When geography matters.',example:'This map grounds the comparison.',category:'layout variety',relation:'accepted',renderEvidence:'Exact saved frame'};
const component='../training/[slug]/training-draft-bundle.tsx';
const openButton=(r:any)=>[...r.document.querySelectorAll('button')].find((el:any)=>el.textContent?.startsWith('Apply selected lesson')||/^Apply \d+ selected lessons$/.test(el.textContent||'')) as HTMLButtonElement;
const confirmButton=(r:any)=>[...r.document.querySelectorAll('button')].find((el:any)=>el.textContent==='Apply these lessons as shown') as HTMLButtonElement;
const dialog=(r:any)=>r.document.querySelector('[role="dialog"][aria-label="Apply these lessons?"]') as HTMLElement;

test('preselected lessons require one batch review showing exact example, category and each distinct relation',async()=>{
 const applied:any[]=[],drafts=[draft,{...draft,id:'two',relation:'rejected',judgment:'Avoid repeated text.'},{...draft,id:'three',relation:'contrast'},{...draft,id:'four',relation:'exception'}];
 const r=await render(component,{drafts,busy:false,onApply:(ids:string[])=>applied.push(ids),onEdit:()=>{}});
 try{
  assert.match(r.text(),/4 selected/);assert.equal(r.document.querySelectorAll('input[type=checkbox]').length,4,'only cheap Include choices remain');assert.equal(r.document.querySelector('[aria-label^="Confirm example use"]'),null);
  assert.equal(openButton(r).disabled,false);await r.click(openButton(r));assert.equal(applied.length,0);
  const summary=dialog(r)!;assert.ok(summary);assert.equal(summary.querySelectorAll('li').length,4);assert.match(summary.textContent||'',/Exact saved frame/);assert.match(summary.textContent||'',/layout variety/);
  for(const label of ['keep this','avoid this','use this as a contrast','use this as an exception'])assert.match(summary.textContent||'',new RegExp(label));
  await r.click(confirmButton(r));assert.deepEqual(JSON.parse(JSON.stringify(applied)),[['one','two','three','four']]);assert.equal(dialog(r),null);
 }finally{r.cleanup();}
});

test('the confirmation applies its frozen set and newly extracted lessons cannot sneak into it',async()=>{
 const applied:any[]=[],props={drafts:[draft],busy:false,onApply:(ids:string[])=>applied.push(ids),onEdit:()=>{}};
 const r=await render(component,props);
 try{
  await r.click(openButton(r));await r.rerender({...props,drafts:[draft,{...draft,id:'new',judgment:'A newly extracted lesson.'}]});
  assert.equal(dialog(r).querySelectorAll('li').length,1);assert.doesNotMatch(dialog(r).textContent||'',/newly extracted/);assert.equal(confirmButton(r).disabled,false);
  const confirm=confirmButton(r);await r.click(confirm);await r.click(confirm);assert.deepEqual(JSON.parse(JSON.stringify(applied)),[['one']],'a stale duplicate click cannot apply twice');
 }finally{r.cleanup();}
});

for(const change of [{digest:'b'.repeat(64)},{relation:'rejected'},{judgment:'Updated exact wording.'}])test(`changed ${Object.keys(change)[0]} blocks the frozen review until current lessons are shown again`,async()=>{
 const applied:any[]=[],props={drafts:[draft],busy:false,onApply:(ids:string[])=>applied.push(ids),onEdit:()=>{}},r=await render(component,props);
 try{
  await r.click(openButton(r));await r.rerender({...props,drafts:[{...draft,...change}]});
  assert.equal(confirmButton(r).disabled,true);assert.match(dialog(r).textContent||'',/A selected lesson changed/);await r.click(confirmButton(r));assert.equal(applied.length,0);
  await r.click(r.getByText('Review current lessons'));assert.equal(confirmButton(r).disabled,false);await r.click(confirmButton(r));assert.deepEqual(JSON.parse(JSON.stringify(applied)),[['one']]);
 }finally{r.cleanup();}
});

test('unknown scope stays unselected and held; Include, Review and cancellation remain cheap',async()=>{
 const edits:string[]=[],applied:any[]=[],props={drafts:[draft,{...draft,id:'unknown',relation:undefined}],busy:false,onApply:(ids:string[])=>applied.push(ids),onEdit:(id:string)=>edits.push(id)};
 const r=await render(component,props);
 try{
  const boxes=[...r.document.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];assert.equal(boxes[0].checked,true);assert.equal(boxes[1].checked,false);assert.equal(boxes[1].disabled,true);assert.match(r.text(),/classification needs review/);
  await r.click([...r.document.querySelectorAll('button')].find(button=>button.textContent==='Review')!);assert.deepEqual(edits,['one']);assert.equal(dialog(r),null);
  await r.click(openButton(r));await r.click(r.getByText('Keep reviewing'));assert.equal(applied.length,0);assert.equal(dialog(r),null);
  await r.click(boxes[0]);assert.equal(openButton(r).disabled,true);
 }finally{r.cleanup();}
});

test('removing all proposed lessons invalidates an already-open confirmation',async()=>{
 const applied:any[]=[],props={drafts:[draft],busy:false,onApply:(ids:string[])=>applied.push(ids),onEdit:()=>{}},r=await render(component,props);
 try{await r.click(openButton(r));await r.rerender({...props,drafts:[]});assert.ok(dialog(r));assert.equal(confirmButton(r).disabled,true);assert.match(dialog(r).textContent||'',/lesson changed/);assert.equal(applied.length,0);}finally{r.cleanup();}
});


test('an owner-corrected relation is attributed to the owner in both card and frozen summary',async()=>{
 const r=await render(component,{drafts:[{...draft,relation:'rejected',relationOrigin:'owner'}],busy:false,onApply:()=>{},onEdit:()=>{}});
 try{assert.match(r.text(),/Your choice: avoid this/);assert.doesNotMatch(r.text(),/Implexa suggests: avoid this/);await r.click(openButton(r));assert.match(dialog(r).textContent||'',/Your choice: avoid this/);assert.doesNotMatch(dialog(r).textContent||'',/Suggested by Implexa/);}finally{r.cleanup();}
});
