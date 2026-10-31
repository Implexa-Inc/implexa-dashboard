import test from 'node:test';
import assert from 'node:assert/strict';
import { render, type Rendered } from '../../../../lib/test/render.ts';

const props={jwt:'test-owner-session',slug:'reference-assessment',id:'341a0016-f976-4c3d-a7d3-658243b6bed6',name:'Reference assessment',
 currentStatus:'draft',isSystem:false,isOwnedByMe:true,usageCount:0,activeShares:[],currentContent:'# Existing method',currentScope:'private',currentVersion:1};
async function change(r:Rendered,value:string){
 const input=r.document.querySelector('textarea')!;
 const setter=Object.getOwnPropertyDescriptor(r.window.HTMLTextAreaElement.prototype,'value')!.set!;
 await r.act(()=>{setter.call(input,value);input.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
}
test('reviewed private draft wording uses existing edit API without activation or sharing',async()=>{
 const r=await render('../skills/[slug]/actions.tsx',props);
 try{
  await r.click(r.getByText('Edit draft wording'));await change(r,' \n# Clarified method\n');
  await r.click(r.getByText('Save draft wording'));
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls.backend)),[{path:`/api/v2/skills/${props.id}/edit`,init:{jwt:props.jwt,method:'POST',body:{content:'# Clarified method',changeNote:'Reviewed draft wording before activation',expectedDraftVersion:1}}}]);
  assert.match(r.text(),/Activation and sharing are separate actions/);
 }finally{r.cleanup();}
});
test('failed edit preserves the exact draft for correction and does not activate',async()=>{
 const r=await render('../skills/[slug]/actions.tsx',props,{backend:()=>{throw Error('Edit unavailable');}});
 try{
  await r.click(r.getByText('Edit draft wording'));await change(r,'# Preserved correction');
  await r.click(r.getByText('Save draft wording'));
  assert.match(r.text(),/Edit unavailable/);assert.equal(r.document.querySelector('textarea')!.value,'# Preserved correction');
  assert.equal(r.calls.backend.length,1);
 }finally{r.cleanup();}
});
test('draft editor is absent on foreign, system, shared or active methods',async()=>{
 for(const delta of [{isOwnedByMe:false},{isSystem:true},{currentScope:'universal'},{currentStatus:'active'},{activeShares:[{shareMode:'public'}]}]){
  const r=await render('../skills/[slug]/actions.tsx',{...props,...delta});
  try{assert.equal(r.queryByText('Edit draft wording'),null);}finally{r.cleanup();}
 }
});
