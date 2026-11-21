import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../lib/test/render.ts';
const accountId='11111111-1111-4111-8111-111111111111',version='33333333-3333-4333-8333-333333333333';
const checklist={slug:'ready-agent',name:'Ready agent',summary:null,state:'created',source:'generated',canActivate:true,stepsLeft:0,steps:[],requiresLocal:false,readyToRun:true,setupReadAvailable:true,blockingQuestions:0,pendingQuestions:0,setupContext:{accountId,versionId:version,requiredRouteClass:'headless',needsBrowser:false,needsComputerUse:false,requiredGroups:[],missingRequiredGroups:[]}};
const props={checklist,surface:'setup',runInputs:{workflowVersionId:version,inputContract:{version:1,fields:[]},inputContractDigest:'a'.repeat(64)},statusUnavailable:false,revisePending:false};
const auth={getSession:async()=>({data:{session:{access_token:'synthetic-jwt',user:{id:accountId}}}})};
const flush=async(r:any)=>r.act(()=>new Promise(resolve=>setTimeout(resolve,15)));
test('the last required item completes Setup once through the existing activation writer, without starting work',async()=>{
 const r=await render('activation-card.tsx',props,{exportName:'ActivationCard',auth,backend:()=>({ok:true})});
 try{await flush(r);const calls=r.calls.backend.filter(c=>c.path.endsWith('/activate'));assert.equal(calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify((calls[0].init as any).body)),{optIns:{},onDemand:true,completeSetup:true,expectedVersionId:version});assert.equal(r.calls.backend.some(c=>c.path==='/api/v2/me/run-requests'),false);await r.rerender(props);await flush(r);assert.equal(r.calls.backend.filter(c=>c.path.endsWith('/activate')).length,1);}finally{r.cleanup();}
});
test('unread answers, missing required input, unavailable lifecycle, pending edit and a mismatched version cannot auto-complete',async()=>{
 const cases=[{setupBlockedReason:'Finish marketplace setup first.'},{checklist:{...checklist,setupReadAvailable:false}},{checklist:{...checklist,blockingQuestions:1,readyToRun:false}},{statusUnavailable:true},{revisePending:true},{runInputs:{...props.runInputs,workflowVersionId:'44444444-4444-4444-8444-444444444444'}}];
 for(const change of cases){const r=await render('activation-card.tsx',{...props,...change},{exportName:'ActivationCard',auth,backend:()=>({ok:true})});try{await flush(r);assert.equal(r.calls.backend.filter(c=>c.path.endsWith('/activate')).length,0);}finally{r.cleanup();}}
});
test('a required permission needs the user’s deliberate choice before completion',async()=>{
 const permission={group:'shell',label:'Run commands',tier:2,optional:false,granted:false};const r=await render('activation-card.tsx',{...props,checklist:{...checklist,steps:[{id:'permissions',title:'Permissions',status:'todo',data:{items:[permission]}}]}},{exportName:'ActivationCard',auth,backend:()=>({ok:true})});
 try{await flush(r);assert.equal(r.calls.backend.filter(c=>c.path.endsWith('/activate')).length,0);await r.click(r.getByText('View'));const allow=r.document.querySelector('input[type="checkbox"]')||r.document.querySelector('[data-permission-action="shell"]');assert.ok(allow);await r.click(allow!);await flush(r);assert.equal(r.calls.backend.filter(c=>c.path.endsWith('/activate')).length,1);}finally{r.cleanup();}
});
test('failure waits for an explicit retry and an account switch cannot grant access',async()=>{
 const r=await render('activation-card.tsx',props,{exportName:'ActivationCard',auth,backend:()=>{throw Error('Temporary failure');}});
 try{await flush(r);await r.rerender(props);await flush(r);assert.equal(r.calls.backend.filter(c=>c.path.endsWith('/activate')).length,1);await r.click(r.getByText('Try again'));await flush(r);assert.equal(r.calls.backend.filter(c=>c.path.endsWith('/activate')).length,2);}finally{r.cleanup();}
 const foreign=await render('activation-card.tsx',props,{exportName:'ActivationCard',auth:{getSession:async()=>({data:{session:{access_token:'other-jwt',user:{id:'other-account'}}}})},backend:()=>({ok:true})});try{await flush(foreign);assert.equal(foreign.calls.backend.filter(c=>c.path.endsWith('/activate')).length,0);}finally{foreign.cleanup();}
});

test('a changed target while authentication is pending cannot send a stale completion',async()=>{
 let release:(value:any)=>void=()=>{};const pending=new Promise(resolve=>{release=resolve;});
 const r=await render('activation-card.tsx',props,{exportName:'ActivationCard',auth:{getSession:()=>pending},backend:()=>({ok:true})});
 try{await r.rerender({...props,runInputs:{...props.runInputs,workflowVersionId:'44444444-4444-4444-8444-444444444444'}});await r.act(()=>release({data:{session:{access_token:'synthetic-jwt',user:{id:accountId}}}}));await flush(r);assert.equal(r.calls.backend.filter(c=>c.path.endsWith('/activate')).length,0);assert.ok(r.queryByText('The agent changed. Reload Setup.'));}finally{r.cleanup();}
});

test('an unread active Setup never claims ready and keeps completion inert',async()=>{
 const r=await render('activation-card.tsx',{...props,checklist:{...checklist,state:'active',setupReadAvailable:false}},{exportName:'ActivationCard',auth,backend:()=>({ok:true})});
 try{await flush(r);assert.ok(r.queryByText('Setup status unavailable'));assert.equal(r.queryByText(/^Ready to run$/),null);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});
test('an optional-only preferences card is readable without implying required answers or saving on read',async()=>{
 const optional={key:'caption',question:'Caption style',kind:'choice',optional:true,options:['Small','Large']};
 const r=await render('agent-setup-card.tsx',{slug:'ready-agent'},{auth,backend:()=>({schema:[optional],answers:{caption:'Small'},missing:[],complete:true,needs_setup:false,ready_to_run:true})});
 try{await flush(r);assert.ok(r.queryByText('Your preferences'));assert.ok(r.queryByText('Remembered for next time.'));assert.equal(r.queryByText('Questions this agent needs answered'),null);assert.equal(r.calls.backend.filter(c=>(c.init as any)?.method==='POST').length,0);}finally{r.cleanup();}
});
