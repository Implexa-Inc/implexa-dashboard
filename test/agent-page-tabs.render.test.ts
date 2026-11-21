import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../lib/test/render.ts';

test('owner Training is a real destination and does not navigate or mutate on load',async()=>{
 const r=await render('agent-tabs.tsx',{active:'overview',panel:'Overview content',tabs:[{key:'overview',label:'Overview'},{key:'training',label:'Training',href:'/training/my-agent'},{key:'setup',label:'Setup'}]});
 try{
  assert.equal(r.document.querySelector('a')?.getAttribute('href'),'/training/my-agent');
  assert.equal(r.document.querySelector('a')?.textContent,'Training');
  assert.equal(r.calls.backend.length,0);assert.equal(r.calls.replace.length,0);
  await r.click(r.getByText('Setup'));
  assert.deepEqual(r.calls.replace,['/?tab=setup']);
  assert.equal(r.document.querySelector('[aria-selected="true"]')?.textContent,'Setup');
  assert.equal(r.text().includes('Overview content'),true,'previous panel stays readable while navigation is pending');
 }finally{r.cleanup();}
});
test('a customer tab strip does not invent a Training destination',async()=>{
 const r=await render('agent-tabs.tsx',{active:'overview',panel:'Overview content',tabs:[{key:'overview',label:'Overview'},{key:'runs',label:'My runs',href:'/workflows/my-agent?legacy=1&tab=runs'},{key:'setup',label:'Setup',href:'/workflows/my-agent?legacy=1&tab=setup'}]});
 try{assert.equal(r.queryByText('Training'),null);assert.equal(r.document.querySelectorAll('a').length,2);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});
const agent={id:'11111111-1111-4111-8111-111111111111',slug:'my-agent',name:'My agent',job:'A useful result.',builder:{id:'trainer',name:'Trainer'},ownership:'Hired',limitations:'Known limits.',version:{id:'33333333-3333-4333-8333-333333333333',number:'4',updatedAt:'2026-11-21T18:00:00Z'},readiness:{state:'Ready',reason:null},primaryAction:'Use agent',testedCompatibility:{executionEngines:['Codex']},requiredInputs:{version:1,fields:[]},acquisition:{id:'installed',pinnedVersionId:'33333333-3333-4333-8333-333333333333',activeVersionId:'33333333-3333-4333-8333-333333333333',lifecycle:'installed'}};
test('installed customer Run opens the existing form and management remains in More without mutation',async()=>{
 const r=await render('agent-resume.tsx',{agent});
 try{
  const run=r.document.querySelector('a[href="/workflows/my-agent?run=1"]');assert.equal(run?.textContent,'Run');
  assert.equal(r.document.querySelector('a[href="/training/my-agent"]'),null);
  const more=r.document.querySelector('.agent-page-more');assert.ok(more?.querySelector('button'));
  assert.ok(more?.textContent?.includes('Pause agent'));
  await r.click(more!.querySelector('summary')!);assert.equal(r.calls.backend.length,0);
 }finally{r.cleanup();}
});
test('only an owner gets Training and edit links in the same agent layout',async()=>{
 const r=await render('agent-resume.tsx',{agent:{...agent,ownership:'Owned'}});
 try{assert.ok(r.document.querySelector('a[href="/training/my-agent"]'));assert.ok(r.document.querySelector('a[href="/training/my-agent?chat=edit"]'));assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});

test('Overview has the same give/get sections without editable input fields',async()=>{
 const fields=[{key:'brief',label:'Your brief',description:'Context',kind:'text',required:true}];
 for(const ownership of ['Owned','Hired','Available']){
  const r=await render('agent-resume.tsx',{agent:{...agent,ownership,requiredInputs:{version:1,fields}}});
  try{assert.ok(r.queryByText('What you give, what you get'));assert.ok(r.queryByText('You give'));assert.ok(r.queryByText('You get'));assert.equal(r.document.querySelector('input,textarea,select'),null);assert.equal(r.queryByText('Required inputs'),null);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
 }
});
test('marketplace setup retains its configured inputs and exact acquisition writer',async()=>{
 const r=await render('agent-resume.tsx',{surface:'setup',agent:{...agent,readiness:{state:'Needs setup',reason:null},requiredInputs:{version:1,fields:[{key:'brief',label:'Your brief',description:'Context',kind:'text',required:true}]}}});
 try{const field=r.document.querySelector('input:not([type="checkbox"])');assert.ok(field);assert.ok(r.queryByText('Required inputs'));assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});
