import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {JSDOM} from 'jsdom';
register(new URL('../../../scripts/dom-test-loader.mjs',import.meta.url),{data:{stubs:{
  '@/lib/supabase/client':['scripts','stubs','supabase-client.mjs']}}});
let React:typeof import('react'),createRoot:typeof import('react-dom/client').createRoot,View:typeof import('./stage-preview-review.tsx').default;
const dom=new JSDOM('<!doctype html><body></body>');
before(async()=>{
  for(const key of ['window','document','HTMLElement','Node','MouseEvent'])
    Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  React=await import('react');({createRoot}=await import('react-dom/client'));View=(await import('./stage-preview-review.tsx')).default;
});
after(()=>dom.window.close());
const summary={contractVersion:'stage-preview-summary.v1' as const,runId:'10000000-0000-4000-8000-000000000001',
  preparationId:'10000000-0000-4000-8000-000000000002',machineId:'10000000-0000-4000-8000-000000000003',
  receiptDigest:'a'.repeat(64),reviewState:'pass' as const,ownerHoldReady:true};
const token='previewToken1234567890',url=`implexa-artifact://preview/${token}`;
const evidence={...summary,ok:true,contractVersion:'stage-preview-local-view.v1',readOnly:true,ownerApproved:false,temporalQaPassed:false,
  criteria:[{id:'title',requirement:'Readable title'}],judgments:[{criterionId:'title',verdict:'pass',reason:'Checked title.',frameIds:['frame-1']}],
  items:[{id:'frame-1',kind:'full_resolution',mime:'image/png',url}]};
test('explicit owner click sends the displayed digest once and media display failure disables approval',async()=>{
  const auth='synthetic-owner-session-not-a-credential';(globalThis as any).__implexaTestOwnerSession=auth;
  for(const broken of [false,true]){
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host),calls:unknown[][]=[];
    (window as any).implexaDesktop={createStagePreview:async()=>({...evidence,decisionDigest:'b'.repeat(64),temporalQa:{
      contractVersion:'stage-preview-temporal-summary.v1',status:'not_applicable',calibrationDigest:null,slotCount:0,
      passedSlotCount:0,offsetIndexProvenSlotCount:0,notVisuallyResolvableSlotCount:0,slots:[]}}),
      approveStagePreview:async(...args:unknown[])=>{calls.push(args);return {ok:true,continuationRequestId:summary.machineId,historical:false};},
      revokeArtifactPreview:async()=>({ok:true})};
    try{
      await React.act(async()=>root.render(React.createElement(View,{summary})));
      await React.act(async()=>host.querySelector('button')!.click());
      const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Approve this Preview and continue to Master') as HTMLButtonElement;
      assert.ok(button);assert.equal(calls.length,0,'opening evidence is not approval');
      if(broken)await React.act(async()=>host.querySelector('img')!.dispatchEvent(new dom.window.Event('error')));
      assert.equal(button.disabled,broken);
      await React.act(async()=>{button.click();button.click();});
      assert.equal(calls.length,broken?0:1);
      if(!broken){assert.deepEqual(calls[0],[summary.runId,summary.preparationId,'b'.repeat(64),auth]);
        assert.match(host.textContent!,/exact Preview was approved.*not video delivery/);}
      assert.equal(host.textContent!.includes(auth),false,'session is never rendered');
    }finally{await React.act(async()=>root.unmount());host.remove();delete(window as any).implexaDesktop;}
  }
  delete(globalThis as any).__implexaTestOwnerSession;
});
test('owner opens a read-only modal with captured frames and closing revokes its tokens, including late replies',async()=>{
  for(const late of [false,true]){
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host),revoked:string[]=[],calls:unknown[][]=[];
    let finish:(value:unknown)=>void=()=>{};
    (window as any).implexaDesktop={createStagePreview:async(...args:unknown[])=>{calls.push(args);return late?new Promise(resolve=>{finish=resolve;}):evidence;},
      revokeArtifactPreview:async(t:string)=>{revoked.push(t);return {ok:true};}};
    try{
      await React.act(async()=>root.render(React.createElement(View,{summary})));
      assert.equal(host.querySelector('[role="dialog"]'),null);
      await React.act(async()=>host.querySelector('button')!.click());
      assert.deepEqual(calls,[[summary.runId,summary.preparationId]]);
      if(!late){assert.equal(host.querySelector('img')?.getAttribute('src'),url);assert.match(host.textContent!,/Checked title/);
        await React.act(async()=>host.querySelector('img')!.dispatchEvent(new dom.window.Event('error')));
        assert.match(host.querySelector('[role="alert"]')!.textContent!,/could not be verified.*does not mean its files are gone/);}
      assert.doesNotMatch([...host.querySelectorAll('button')].map(b=>b.textContent).join('|'),/Approve|Continue|Retry/);
      await React.act(async()=>(host.querySelector('[aria-label="Close"]') as HTMLButtonElement).click());
      if(late)await React.act(async()=>finish(evidence));
      assert.equal(host.querySelector('[role="dialog"]'),null);assert.deepEqual(revoked,[token]);
    }finally{await React.act(async()=>root.unmount());host.remove();delete (window as any).implexaDesktop;}
  }
});

test('a failed Preview requests upstream Compose revision, never approval to Master',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try{
    await React.act(async()=>root.render(React.createElement(View,{summary:{...summary,reviewState:'fail'}})));
    await React.act(async()=>host.querySelector('button')!.click());
    assert.match(host.textContent!,/Preview failed\. Compose must be revised through an owner action; Master is not available/);
    assert.doesNotMatch(host.textContent!,/owner decision are still required before Master/);
  }finally{await React.act(async()=>root.unmount());host.remove();}
});
test('temporal Preview displays the qualified counts and each unresolvable slot without approving Master',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const temporalQa={contractVersion:'stage-preview-temporal-summary.v1',status:'passed',calibrationDigest:'a'.repeat(64),
    slotCount:8,passedSlotCount:8,offsetIndexProvenSlotCount:2,notVisuallyResolvableSlotCount:6,
    slots:Array.from({length:8},(_,i)=>({sceneId:'scene-1',slotId:`slot-${i}`,verdict:'passed',
      offsetEvidence:i<2?'informative':'not_visually_resolvable'}))};
  (window as any).implexaDesktop={createStagePreview:async()=>({...evidence,temporalQaPassed:true,temporalQa}),
    revokeArtifactPreview:async()=>({ok:true})};
  try{
    await React.act(async()=>root.render(React.createElement(View,{summary})));
    await React.act(async()=>host.querySelector('button')!.click());
    const section=host.querySelector('[aria-label="Temporal QA"]')!;
    assert.match(section.textContent!,/passed for 8\/8 slots; offset index proven on 2\/8; 6\/8 not visually resolvable/);
    assert.equal(section.textContent!.split('offset not visually resolvable within ±2 source frames').length-1,6);
    assert.match(host.textContent!,/exact owner decision is still required before Master/);
    assert.doesNotMatch([...host.querySelectorAll('button')].map(b=>b.textContent).join('|'),/Approve|Continue|Retry/);
  }finally{await React.act(async()=>root.unmount());host.remove();delete(window as any).implexaDesktop;}
});
test('temporal refusal copy names technical or unassessable evidence rather than blaming a Compose judgment',async()=>{
  for(const status of ['failed','not_assessable']){
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host),held={...summary,reviewState:'incomplete' as const};
    const temporalQa={contractVersion:'stage-preview-temporal-summary.v1',status,calibrationDigest:'a'.repeat(64),slotCount:1,
      passedSlotCount:0,offsetIndexProvenSlotCount:0,notVisuallyResolvableSlotCount:1,
      slots:[{sceneId:'scene-1',slotId:'slot-1',verdict:status,offsetEvidence:'not_visually_resolvable'}]};
    (window as any).implexaDesktop={createStagePreview:async()=>({...evidence,reviewState:'incomplete',temporalQaPassed:false,temporalQa}),
      revokeArtifactPreview:async()=>({ok:true})};
    try{
      await React.act(async()=>root.render(React.createElement(View,{summary:held})));
      await React.act(async()=>host.querySelector('button')!.click());
      assert.match(host.textContent!,status==='failed'?/not a Compose creative finding/:/insufficient provider visibility.*audio window.*not a Compose semantic finding/);
      assert.doesNotMatch(host.textContent!,/Compose must be revised/);
      assert.match(host.textContent!,/no automatic retry or new media spending/);
    }finally{await React.act(async()=>root.unmount());host.remove();delete(window as any).implexaDesktop;}
  }
});
