import test from 'node:test';import assert from 'node:assert/strict';
import {render} from '../../../../lib/test/render.ts';
import {trainingOpportunities,questionPresentation,type TrainerQuestion} from '../../../../lib/trainer-questions.ts';
const U=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
const q:TrainerQuestion={id:U(1),receiptDigest:H,createdAt:'2026-11-12T12:00:00Z',questionId:'presenter',question:'Should the presenter be close up or wide?',sceneElement:'presenter and diagram',property:'presenter_graphic_integration',stage:'build',questionVersionId:U(2),runId:U(3),runState:'completed',runStatus:'completed',outcome:'no_match',returnedReferenceIds:[],recordedEvidence:false,fallback:null,recurrenceCount:1,teachings:[]};
const questions={ok:true,contractVersion:'trainer-questions.v1',agentFamilyId:U(4),activeVersionId:U(2),items:[q],nextCursor:null};
const p={id:U(5),digest:H,value:{question:'How should your presenter appear beside diagrams?',options:['Use a close presenter crop beside diagrams.','Use a wider crop when gestures explain the point.']}};
test('opportunities require a real signal, dedupe topics, omit prepared answers and bound the list',()=>{
 assert.deepEqual(trainingOpportunities([{...q,outcome:'matched'}],U(2)),[]);assert.equal(trainingOpportunities([{...q,outcome:'matched',opportunityReason:'review_finding'}],U(2)).length,1);
 assert.equal(trainingOpportunities([q,{...q,id:U(9)}],U(2)).length,1);assert.deepEqual(trainingOpportunities([{...q,teachings:[{sessionId:U(7),recordId:U(8),recordDigest:H,state:'prepared',reason:null,targetVersionId:U(2)}]}],U(2)),[]);
 assert.equal(questionPresentation(p),true);assert.equal(questionPresentation({...p,value:{...p.value,options:['same','same']}}),false);
});
test('picking a choice only fills a draft; Save creates a linked suggestion, never admission or a run',async()=>{
 const requests:any[]=[];let saved=0;const props={questions,sessionId:U(6),versionId:U(2),disabled:false,onSaved:()=>saved++,onStart:async()=>{}};
 const r=await render('../training/[slug]/training-opportunities.tsx',props,{fetch:(async(_url:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));requests.push({body,key:(init.headers as any)['Idempotency-Key']});return {ok:true,json:async()=>body.action==='present'?{ok:true,presentation:p}:{ok:true,contractVersion:'training-question-teaching.v1',questionReceiptId:q.id,recordId:U(8),recordDigest:H}};}) as any});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 try{assert.equal(requests.length,0);await r.click(r.getByText('Answer →'));assert.equal(requests.length,1);const choices=r.document.querySelectorAll('input[type=radio]');assert.equal(choices.length,3);assert.ok([...choices].every(x=>!(x as HTMLInputElement).checked));await r.click(choices[1]);assert.equal(requests.length,1);assert.equal(saved,0);await r.click(r.getByText('Save answer'));assert.equal(requests.length,2);assert.equal(requests[1].body.rawAnswer,p.value.options[1]);assert.equal(requests[1].body.optionIndex,1);assert.equal(saved,1);assert.match(r.text(),/saved as a teaching suggestion/);}finally{r.cleanup();}
});
test('uncertain saves retry the exact key and text; Skip never calls a server',async()=>{
 const requests:any[]=[];let fail=true;const r=await render('../training/[slug]/training-opportunities.tsx',{questions,sessionId:U(6),versionId:U(2),disabled:false,onSaved:()=>{},onStart:async()=>{}},{fetch:(async(_url:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));requests.push({body,key:(init.headers as any)['Idempotency-Key']});if(body.action==='save'&&fail){fail=false;throw Error('network');}return {ok:true,json:async()=>body.action==='present'?{ok:true,presentation:p}:{ok:true,contractVersion:'training-question-teaching.v1',questionReceiptId:q.id,recordId:U(8),recordDigest:H}};}) as any});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 try{await r.click(r.getByText('Answer →'));await r.click(r.document.querySelectorAll('input[type=radio]')[0]);await r.click(r.getByText('Save answer'));assert.ok(r.document.querySelector('[role=alert]'));await r.click(r.getByText('Save answer'));assert.equal(requests[1].key,requests[2].key);assert.deepEqual(requests[1].body,requests[2].body);}finally{r.cleanup();}
 const skip=await render('../training/[slug]/training-opportunities.tsx',{questions,sessionId:U(6),versionId:U(2),disabled:false,onSaved:()=>assert.fail('saved'),onStart:async()=>{}},{fetch:(()=>assert.fail('skip called API')) as any});try{await skip.click(skip.getByText('Skip'));assert.match(skip.text(),/No new questions/);}finally{skip.cleanup();}
});
