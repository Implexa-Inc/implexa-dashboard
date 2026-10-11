import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
import { trainingProposedAdoptionPreview, trainingProposedAdoptionReceipt } from '../../../lib/manager-training-run-preflight.ts';
register(new URL('../../../scripts/dom-test-loader.mjs', import.meta.url), { data: { stubs: {
  '@/lib/supabase/client': ['scripts','stubs','supabase-client.mjs'],
  '@/lib/api': ['scripts','stubs','backend-api.mjs'],
} } });
const SOURCE='22222222-2222-4222-8222-222222222222', TARGET='33333333-3333-4333-8333-333333333333';
const PAIR={stage:'build',property:'layout_variety',relation:'accepted'};
const preview=()=>({ok:true,contractVersion:'manager-training-successor-adoption-preview.v1',sourceWorkflowVersionId:SOURCE,targetWorkflowVersionId:TARGET,eligibleRecordCount:1,alreadyAdoptedRecordCount:0,newlyAdoptableRecordCount:1,eligibleRouteCount:1,readiness:'adoption_available',reason:null,expectedAdoptionDigest:'a'.repeat(64)});
const receipt=()=>({ok:true,contractVersion:'manager-training-successor-adoption.v1',created:true,sourceWorkflowVersionId:SOURCE,targetWorkflowVersionId:TARGET,adoptedRecordCount:1,adoptionReceiptIds:['11111111-1111-4111-8111-111111111111'],eligibleRouteCount:1,adoptionSetDigest:'b'.repeat(64),managerTrainingRequirements:{contractVersion:'manager-reference-training-readiness.v1',scope:'workflow_version_quality_references',workflowVersionId:TARGET,classified:true,requiredPairs:[PAIR],fulfilledPairs:[PAIR],missingPairs:[],readiness:'reference_training_ready',reason:null}});
test('proposed preview and receipt reuse exact existing authority validators',()=>{
  const p=trainingProposedAdoptionPreview(preview(),SOURCE,TARGET)!; assert.ok(p);
  assert.ok(trainingProposedAdoptionReceipt(receipt(),'compositor',p));
  for(const value of [null,{...preview(),extra:true},{...preview(),expectedAdoptionDigest:'not-a-digest'},{...preview(),sourceWorkflowVersionId:TARGET}]) assert.equal(trainingProposedAdoptionPreview(value,SOURCE,TARGET),null);
  for(const value of [{...receipt(),extra:true},{...receipt(),targetWorkflowVersionId:SOURCE},{...receipt(),adoptionReceiptIds:[]},{...receipt(),managerTrainingRequirements:{...receipt().managerTrainingRequirements,missingPairs:[PAIR]}}]) assert.equal(trainingProposedAdoptionReceipt(value,'compositor',p),null);
});
async function mount(handler:(path:string,options:any)=>unknown){
  const dom=new JSDOM('<body></body>',{url:'https://app.implexa.ai'});
  for(const key of ['window','document','HTMLElement','Node','MouseEvent','sessionStorage'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true; (globalThis as any).__IMPLEXA_TEST_BACKEND__=handler;
  const React=await import('react'),{createRoot}=await import('react-dom/client'),{ProposedAgentUpdateGate}=await import('./agent-update-gate.tsx');
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  await React.act(async()=>root.render(React.createElement(ProposedAgentUpdateGate,{slug:'compositor',baseVersionId:SOURCE})));
  return{host,click:async(name:string)=>React.act(async()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===name)!.click()),confirm:async()=>React.act(async()=>{const c=document.querySelector<HTMLInputElement>('input[type=checkbox]')!;c.click();}),text:()=>document.body.textContent!,close:async()=>{await React.act(async()=>root.unmount());dom.window.close();delete(globalThis as any).__IMPLEXA_TEST_BACKEND__;}};
}
const hardening=()=>({ok:true,slug:'compositor',activeVersion:{id:SOURCE},latestCandidate:{workflowVersionId:TARGET,versionStatus:'proposed',result:'hardening_passed',activationEligible:true,manifestDigest:'c'.repeat(64)}});
test('owner separately confirms exact reference carry-forward and activation; no run API is called',async()=>{
  const calls:any[]=[];let lost=true;
  const ui=await mount((path,options)=>{calls.push({path,options});if(path.endsWith('/hardening'))return hardening();if(path.endsWith('/preview-proposed-adoption'))return preview();if(path.endsWith('/adopt-proposed')){if(lost){lost=false;throw Error('lost reply');}return receipt();}if(path.endsWith('/apply'))return{ok:true,version_id:TARGET,status:'applied',version_number:37};throw Error('unexpected route');});
  try{
    assert.equal(calls.length,0);await ui.click('Review proposed update');assert.equal(calls.length,2);
    assert.equal(document.querySelector<HTMLButtonElement>('button.btn-primary')!.disabled,true);
    await ui.confirm();await ui.click('Carry accepted references');assert.match(ui.text(),/not confirmed/);
    await ui.click('Confirm same carry-forward');
    const writes=calls.filter(x=>x.path.endsWith('/adopt-proposed'));assert.equal(writes.length,2);
    assert.equal(writes[0].options.idempotencyKey,writes[1].options.idempotencyKey);
    assert.deepEqual(writes[0].options.body,{sourceVersionId:SOURCE,targetVersionId:TARGET,expectedAdoptionDigest:'a'.repeat(64)});
    assert.equal(calls.some(x=>x.path.endsWith('/apply')),false);assert.equal(document.querySelector<HTMLButtonElement>('button.btn-primary')!.disabled,true);
    await ui.confirm();await ui.click('Activate reviewed proposal');assert.match(ui.text(),/Definition v37 applied/);
    assert.deepEqual(calls.at(-1).options.body,{expectedBaseVersionId:SOURCE});assert.equal(calls.at(-1).path,`/api/v2/agents/compositor/revisions/${TARGET}/apply`);
  }finally{await ui.close();}
});
test('stale or failed compiler projection offers no adoption or activation',async()=>{
  for(const bad of [{...hardening(),activeVersion:{id:TARGET}},{...hardening(),latestCandidate:{...hardening().latestCandidate,result:'hardening_failed'}}]){
    const calls:any[]=[];const ui=await mount((path)=>{calls.push(path);return bad;});
    try{await ui.click('Review proposed update');assert.equal(calls.length,1);assert.match(ui.text(),/could be verified/);assert.equal(document.querySelector('input[type=checkbox]'),null);}finally{await ui.close();}
  }
});
test('a fresh already-adopted preview recovers a lost adoption reply without another write',async()=>{
  const calls:string[]=[];const ui=await mount(path=>{calls.push(path);if(path.endsWith('/hardening'))return hardening();if(path.endsWith('/preview-proposed-adoption'))return{...preview(),alreadyAdoptedRecordCount:1,newlyAdoptableRecordCount:0,readiness:'already_adopted'};return{ok:true,version_id:TARGET,status:'applied',version_number:37};});
  try{await ui.click('Review proposed update');await ui.confirm();await ui.click('Activate reviewed proposal');assert.equal(calls.some(p=>p.endsWith('/adopt-proposed')),false);assert.match(ui.text(),/Definition v37 applied/);}finally{await ui.close();}
});
