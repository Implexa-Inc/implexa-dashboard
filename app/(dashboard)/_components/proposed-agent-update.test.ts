import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { trainingProposedAdoptionPreview, trainingProposedAdoptionReceipt,
  trainingSuccessorAdoptionActionAvailable } from '../../../lib/manager-training-run-preflight.ts';
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
async function mount(handler:(path:string,options:any)=>unknown, baseVersionId=SOURCE, slug='compositor'){
  const dom=new JSDOM('<body></body>',{url:'https://app.implexa.ai'});
  for(const key of ['window','document','HTMLElement','Node','MouseEvent','sessionStorage'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true; (globalThis as any).__IMPLEXA_TEST_BACKEND__=handler;
  const React=await import('react'),{createRoot}=await import('react-dom/client'),{ProposedAgentUpdateGate}=await import('./agent-update-gate.tsx');
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  await React.act(async()=>root.render(React.createElement(ProposedAgentUpdateGate,{slug,baseVersionId})));
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
const remapReview=()=>({acknowledgement:{fromVersionId:SOURCE,targetVersionId:TARGET,
  sourcePolicySetDigest:'d'.repeat(64),targetPolicySetDigest:'e'.repeat(64),remapDigest:'f'.repeat(64)},
  activationReceiptDigest:'9'.repeat(64),entries:[{from:{order:13,kind:'decision',label:'build',policyDigest:'8'.repeat(64)},
    to:{order:4,label:'scene_contract'},disposition:'consolidated'}],retiredLabels:['build']});
const zeroRequirements=()=>({contractVersion:'manager-reference-training-readiness.v1',scope:'workflow_version_quality_references',
  workflowVersionId:TARGET,classified:true,requiredPairs:[],fulfilledPairs:[],missingPairs:[],readiness:'not_applicable',reason:null});
test('only verified not-applicable requirements allow a zero-reference remap review',()=>{
  const value={...preview(),eligibleRecordCount:0,alreadyAdoptedRecordCount:0,newlyAdoptableRecordCount:0,eligibleRouteCount:0,
    readiness:'already_adopted',managerPolicyRemap:remapReview(),managerTrainingRequirements:zeroRequirements()};
  const checked=trainingProposedAdoptionPreview(value,SOURCE,TARGET)!;
  assert.ok(checked);assert.equal(checked.eligibleRecordCount,0);
  assert.deepEqual(checked.managerPolicyRemap,remapReview());
  for(const invalid of [
    {...value,managerTrainingRequirements:receipt().managerTrainingRequirements},
    {...value,managerTrainingRequirements:{...zeroRequirements(),missingPairs:[PAIR]}},
    {...value,managerPolicyRemap:{...remapReview(),extra:true}},
    {...value,managerPolicyRemap:{...remapReview(),acknowledgement:{...remapReview().acknowledgement,targetVersionId:SOURCE}}},
    {...value,managerPolicyRemap:{...remapReview(),activationReceiptDigest:'unknown'}},
  ])assert.equal(trainingProposedAdoptionPreview(invalid,SOURCE,TARGET),null);
});
test('owner sees exact policy remap and excluded label, then acknowledges only on Apply without adoption',async()=>{
  const calls:any[]=[];
  const value={...preview(),eligibleRecordCount:0,alreadyAdoptedRecordCount:0,newlyAdoptableRecordCount:0,eligibleRouteCount:0,
    readiness:'already_adopted',managerPolicyRemap:remapReview(),managerTrainingRequirements:zeroRequirements()};
  const ui=await mount((path,options)=>{calls.push({path,options});if(path.endsWith('/hardening'))return hardening();
    if(path.endsWith('/preview-proposed-adoption'))return value;
    if(path.endsWith('/apply'))return{ok:true,version_id:TARGET,status:'applied',version_number:43};throw Error('unexpected write');});
  try{
    await ui.click('Review proposed update');
    assert.match(ui.text(),/Stage 13 build → stage 4 scene_contract/);assert.match(ui.text(),/Excluded retired labels: build/);
    assert.ok(ui.text().includes(remapReview().acknowledgement.remapDigest));assert.ok(ui.text().includes(remapReview().activationReceiptDigest));
    assert.equal(document.querySelector<HTMLButtonElement>('button.btn-primary')!.disabled,true);
    await ui.confirm();await ui.click('Activate reviewed proposal');
    assert.deepEqual(calls.at(-1).options.body,{expectedBaseVersionId:SOURCE,managerPolicyRemapAcknowledgement:remapReview().acknowledgement});
    assert.equal(calls.some(c=>c.path.endsWith('/adopt-proposed')),false);assert.match(ui.text(),/Definition v43 applied/);
  }finally{await ui.close();}
});

// Unedited output from the backend's actual disposable-database producer.
// Mutations below are negative controls, never substitute positive fixtures.
function repurposeProducer() {
  return JSON.parse(readFileSync(new URL('../../../test/fixtures/task-identity-repurpose.json', import.meta.url), 'utf8'));
}

test('real producer fresh-purpose preview stays incompatible with adoption and preserves the exact acknowledgement',()=>{
  const {preview:value}=repurposeProducer();
  const checked=trainingProposedAdoptionPreview(value,value.sourceWorkflowVersionId,value.targetWorkflowVersionId)!;
  assert.ok(checked);assert.equal(checked.readiness,'not_compatible');assert.equal(checked.reason,'task_identity_changed');
  assert.deepEqual(checked.taskIdentityRepurpose,value.taskIdentityRepurpose);
  assert.equal(trainingSuccessorAdoptionActionAvailable(checked),false);
  for(const key of ['eligibleRecordCount','alreadyAdoptedRecordCount','newlyAdoptableRecordCount','eligibleRouteCount'])assert.equal((checked as any)[key],0);
});

test('fresh-purpose preview rejects stale, widened, mixed and adoption-shaped acknowledgements',()=>{
  const {preview:value}=repurposeProducer();
  const source=value.sourceWorkflowVersionId,target=value.targetWorkflowVersionId;
  const mutate=(fn:(v:any)=>void)=>{const v=structuredClone(value);fn(v);return v;};
  const controls=[
    mutate(v=>v.extra=true),mutate(v=>v.taskIdentityRepurpose.extra=true),
    mutate(v=>v.taskIdentityRepurpose.acknowledgement.extra=true),
    mutate(v=>v.taskIdentityRepurpose=null),mutate(v=>delete v.managerTrainingRequirements),
    mutate(v=>delete v.managerPolicyRemap),mutate(v=>{v.managerPolicyRemap=remapReview();
      Object.assign(v.managerPolicyRemap.acknowledgement,{fromVersionId:source,targetVersionId:target});}),
    mutate(v=>v.sourceWorkflowVersionId=target),mutate(v=>v.targetWorkflowVersionId=source),
    mutate(v=>v.taskIdentityRepurpose.acknowledgement.fromVersionId=target),
    mutate(v=>v.taskIdentityRepurpose.acknowledgement.targetVersionId=source),
    mutate(v=>v.taskIdentityRepurpose.acknowledgement.kind='manager_policy_remap'),
    mutate(v=>v.taskIdentityRepurpose.acknowledgement.targetLearningIdentityDigest=v.taskIdentityRepurpose.acknowledgement.sourceLearningIdentityDigest),
    mutate(v=>v.readiness='already_adopted'),mutate(v=>v.reason='manager_policy_changed'),
    mutate(v=>{v.readiness='adoption_available';v.reason=null;v.eligibleRecordCount=1;v.newlyAdoptableRecordCount=1;v.eligibleRouteCount=1;}),
    mutate(v=>v.eligibleRouteCount=1),mutate(v=>{v.eligibleRecordCount=1;v.alreadyAdoptedRecordCount=1;}),
    mutate(v=>v.managerTrainingRequirements.workflowVersionId=source),
    mutate(v=>v.managerTrainingRequirements=null),
    mutate(v=>v.taskIdentityRepurpose.activationReceiptDigest='unknown'),
    mutate(v=>v.taskIdentityRepurpose.activationReceiptDigest='A'.repeat(64)),
    mutate(v=>delete v.taskIdentityRepurpose.activationReceiptDigest),
  ];
  for(const key of ['sourceLearningIdentityDigest','targetLearningIdentityDigest','sourcePolicySetDigest','targetPolicySetDigest','repurposeDigest']){
    for(const invalid of ['A'.repeat(64),'a'.repeat(63),null])controls.push(mutate(v=>v.taskIdentityRepurpose.acknowledgement[key]=invalid));
    controls.push(mutate(v=>delete v.taskIdentityRepurpose.acknowledgement[key]));
  }
  for(const [i,v] of controls.entries())assert.equal(trainingProposedAdoptionPreview(v,source,target),null,`negative control ${i}`);
  assert.equal(trainingProposedAdoptionPreview(value,target,source),null);
});

test('real producer fresh-purpose Apply requires owner confirmation, sends only its typed acknowledgement and never adopts',async()=>{
  const fixture=repurposeProducer(),calls:any[]=[];
  const ui=await mount((path,options)=>{calls.push({path,options});
    if(path.endsWith('/hardening'))return fixture.hardening;
    if(path.endsWith('/preview-proposed-adoption'))return fixture.preview;
    if(path.endsWith('/apply'))return fixture.apply;
    throw Error('Unexpected authority route');
  },fixture.preview.sourceWorkflowVersionId,fixture.hardening.slug);
  try{
    await ui.click('Review proposed update');
    assert.match(ui.text(),/new job/);assert.match(ui.text(),/fresh training/);
    assert.match(ui.text(),/no existing teaching, releases or private preferences carry forward/);
    assert.match(ui.text(),/stay on their current version until each customer explicitly reactivates/);
    assert.match(ui.text(),/reactivate immediately, even before fresh training is released/);
    assert.equal(ui.text().includes('References are already carried forward'),false);
    assert.equal(ui.text().includes('Carry accepted references'),false);
    assert.equal(ui.text().includes('accepted records cover'),false);
    for(const digest of Object.values(fixture.preview.taskIdentityRepurpose.acknowledgement).filter(v=>typeof v==='string'&&v.length===64))assert.ok(ui.text().includes(digest as string));
    assert.ok(ui.text().includes(fixture.preview.taskIdentityRepurpose.activationReceiptDigest));
    assert.equal(document.querySelector<HTMLButtonElement>('button.btn-primary')!.disabled,true);
    await ui.click('Activate reviewed proposal');assert.equal(calls.length,2,'no Apply before confirmation');
    await ui.confirm();await ui.click('Activate reviewed proposal');
    assert.equal(calls.length,3);assert.ok(calls.at(-1).path.endsWith(`/revisions/${fixture.preview.targetWorkflowVersionId}/apply`));
    assert.deepEqual(calls.at(-1).options.body,{expectedBaseVersionId:fixture.preview.sourceWorkflowVersionId,
      taskIdentityRepurposeAcknowledgement:fixture.preview.taskIdentityRepurpose.acknowledgement});
    assert.match(ui.text(),/Definition v\d+ applied/);
    assert.equal(document.querySelector('input[type=checkbox]'),null);
  }finally{await ui.close();}
});

test('mandatory target training, missing fresh-purpose authority or any malformed preview cannot offer Apply',async()=>{
  const fixture=repurposeProducer();
  const mutations=[
    (v:any)=>{v.managerTrainingRequirements={...v.managerTrainingRequirements,classified:true,requiredPairs:[PAIR],fulfilledPairs:[],missingPairs:[PAIR],readiness:'coach_reference_training_required',reason:'manager_required_reference_training_missing'};},
    (v:any)=>delete v.taskIdentityRepurpose,
    (v:any)=>v.taskIdentityRepurpose.acknowledgement.targetVersionId=v.sourceWorkflowVersionId,
    (v:any)=>v.reason='agent_active_version_changed',
    (v:any)=>delete v.managerTrainingRequirements,
  ];
  for(const [index,change] of mutations.entries()){
    const value=structuredClone(fixture.preview);change(value);const calls:string[]=[];
    if(index===0)assert.ok(trainingProposedAdoptionPreview(value,value.sourceWorkflowVersionId,value.targetWorkflowVersionId),
      'required target training is a valid projection, not an unavailable read');
    const ui=await mount(path=>{calls.push(path);if(path.endsWith('/hardening'))return fixture.hardening;if(path.endsWith('/preview-proposed-adoption'))return value;throw Error('Unexpected write');},fixture.preview.sourceWorkflowVersionId,fixture.hardening.slug);
    try{await ui.click('Review proposed update');assert.equal(calls.length,2);assert.equal(document.querySelector('input[type=checkbox]'),null);assert.equal(document.querySelector('button.btn-primary'),null);assert.equal(ui.text().includes('Carry accepted references'),false);
      if(index===1){assert.match(ui.text(),/changes the agent’s job and cannot be activated right now/);assert.doesNotMatch(ui.text(),/This carries already accepted references|accepted records cover/);}}
    finally{await ui.close();}
  }
});

test('fresh-purpose transport failure stays unconfirmed without automatic Apply retry or reference adoption',async()=>{
  const fixture=repurposeProducer(),calls:string[]=[];
  const ui=await mount(path=>{calls.push(path);if(path.endsWith('/hardening'))return fixture.hardening;if(path.endsWith('/preview-proposed-adoption'))return fixture.preview;throw Error('Apply response unavailable');},fixture.preview.sourceWorkflowVersionId,fixture.hardening.slug);
  try{
    await ui.click('Review proposed update');await ui.confirm();await ui.click('Activate reviewed proposal');
    assert.equal(calls.length,3);assert.match(ui.text(),/Apply response unavailable/);assert.doesNotMatch(ui.text(),/Definition v\d+ applied/);
    assert.equal(calls.some(p=>p.endsWith('/adopt-proposed')),false);
  }finally{await ui.close();}
});

test('fresh-purpose review retains every compiler-passed exact-base proposal guard',async()=>{
  const fixture=repurposeProducer();
  const changes=[
    (h:any)=>h.latestCandidate.activationEligible=false,
    (h:any)=>h.latestCandidate.result='hardening_failed',
    (h:any)=>h.latestCandidate.versionStatus='applied',
    (h:any)=>h.latestCandidate.manifestDigest=null,
    (h:any)=>h.activeVersion.id=fixture.preview.targetWorkflowVersionId,
  ];
  for(const change of changes){
    const h=structuredClone(fixture.hardening);change(h);const calls:string[]=[];
    const ui=await mount(path=>{calls.push(path);return h;},fixture.preview.sourceWorkflowVersionId,fixture.hardening.slug);
    try{await ui.click('Review proposed update');assert.equal(calls.length,1);assert.equal(document.querySelector('input[type=checkbox]'),null);assert.match(ui.text(),/could be verified/);}
    finally{await ui.close();}
  }
});

test('fresh-purpose confirmation is cleared on a new review and a pending Apply cannot be delivered twice',async()=>{
  const fixture=repurposeProducer(),calls:string[]=[];
  let resolveApply:(v:unknown)=>void=()=>{};
  const pending=new Promise(resolve=>{resolveApply=resolve;});
  const ui=await mount(path=>{calls.push(path);if(path.endsWith('/hardening'))return fixture.hardening;
    if(path.endsWith('/preview-proposed-adoption'))return fixture.preview;if(path.endsWith('/apply'))return pending;throw Error('Unexpected write');},
    fixture.preview.sourceWorkflowVersionId,fixture.hardening.slug);
  try{
    await ui.click('Review proposed update');await ui.confirm();await ui.click('×');
    await ui.click('Review proposed update');
    assert.equal(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked,false);
    assert.equal(document.querySelector<HTMLButtonElement>('button.btn-primary')!.disabled,true);
    await ui.confirm();await ui.click('Activate reviewed proposal');
    const applyButton=document.querySelector<HTMLButtonElement>('button.btn-primary')!;
    assert.equal(applyButton.disabled,true);applyButton.click();
    assert.equal(calls.filter(p=>p.endsWith('/apply')).length,1);
    const React=await import('react');await React.act(async()=>resolveApply(fixture.apply));
    assert.match(ui.text(),/Definition v\d+ applied/);
  }finally{await ui.close();}
});
