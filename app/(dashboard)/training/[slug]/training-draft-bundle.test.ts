import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../../lib/test/render.ts';
const draft={id:'one',digest:'a'.repeat(64),judgment:'Use a map when location explains the point.',appliesWhen:'When geography matters.',example:'This map grounds the comparison.',category:'layout variety',relation:'accepted',renderEvidence:null};
const button=(r:any)=>[...r.document.querySelectorAll('button')].find((el:any)=>el.textContent?.startsWith('Apply')) as HTMLButtonElement;

test('preselected visual lessons show the proposed relation and require explicit owner confirmation before Apply',async()=>{
 const applied:any[]=[],r=await render('../training/[slug]/training-draft-bundle.tsx',{drafts:[draft,{...draft,id:'two',relation:'rejected',judgment:'Avoid repeated text.'}],busy:false,onApply:(ids:string[])=>applied.push(ids),onEdit:()=>{}});
 try{
  assert.match(r.text(),/Implexa suggests: keep this/);assert.match(r.text(),/Implexa suggests: avoid this/);assert.match(r.text(),/layout variety/);assert.match(r.text(),/2 selected/);
  assert.equal(button(r).disabled,true);assert.equal(applied.length,0);
  await r.click(r.document.querySelector('[aria-label="Confirm example use: keep this"]')!);assert.equal(button(r).disabled,true);
  await r.click(r.document.querySelector('[aria-label="Confirm example use: avoid this"]')!);assert.equal(button(r).disabled,false);
  await r.click(button(r));assert.deepEqual(JSON.parse(JSON.stringify(applied)),[['one','two']]);
 }finally{r.cleanup();}
});

test('a changed classification needs fresh confirmation and an unclassified lesson must be reviewed',async()=>{
 const edits:string[]=[],props={drafts:[draft],busy:false,onApply:()=>{},onEdit:(id:string)=>edits.push(id)};
 const r=await render('../training/[slug]/training-draft-bundle.tsx',props);
 try{
  await r.click(r.document.querySelector('[aria-label="Confirm example use: keep this"]')!);assert.equal(button(r).disabled,false);
  await r.rerender({...props,drafts:[{...draft,relation:'exception'}]});assert.equal(button(r).disabled,true);assert.match(r.text(),/use this as an exception/);
  await r.rerender({...props,drafts:[{...draft,relation:undefined}]});assert.equal(button(r).disabled,true);assert.match(r.text(),/classification needs review/);
  await r.click([...r.document.querySelectorAll('button')].find(b=>b.textContent==='Review')!);assert.deepEqual(edits,['one']);
 }finally{r.cleanup();}
});
