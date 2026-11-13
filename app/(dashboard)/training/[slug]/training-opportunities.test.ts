import test from 'node:test';import assert from 'node:assert/strict';
import {render} from '../../../../lib/test/render.ts';
import {trainingOpportunities,questionPresentation,type TrainerQuestion} from '../../../../lib/trainer-questions.ts';
const U=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
const q:TrainerQuestion={id:U(1),receiptDigest:H,createdAt:'2026-11-12T12:00:00Z',questionId:'presenter',question:'Should the presenter be close up or wide?',sceneElement:'presenter and diagram',property:'presenter_graphic_integration',stage:'build',questionVersionId:U(2),runId:U(3),runState:'completed',runStatus:'completed',outcome:'no_match',opportunityReason:'no_match',returnedReferenceIds:[],recordedEvidence:false,fallback:null,recurrenceCount:1,teachings:[]};
const questions={ok:true,contractVersion:'trainer-questions.v1',agentFamilyId:U(4),activeVersionId:U(2),items:[q],nextCursor:null};
const p={id:U(5),digest:H,value:{question:'How should your presenter appear beside diagrams?',options:['Use a close presenter crop beside diagrams.','Use a wider crop when gestures explain the point.']}};
test('opportunities require a real signal, dedupe topics, omit prepared answers and bound the list',()=>{
 assert.deepEqual(trainingOpportunities([{...q,outcome:'matched',opportunityReason:null}],U(2)),[]);assert.equal(trainingOpportunities([{...q,outcome:'matched',opportunityReason:'review_finding'}],U(2)).length,1);
 assert.equal(trainingOpportunities([q,{...q,id:U(9)}],U(2)).length,1);assert.deepEqual(trainingOpportunities([{...q,teachings:[{sessionId:U(7),recordId:U(8),recordDigest:H,state:'prepared',reason:null,targetVersionId:U(2)}]}],U(2)),[]);
 assert.equal(questionPresentation(p),true);assert.equal(questionPresentation({...p,value:{...p.value,options:['same','same']}}),false);
});
test('picking a choice only fills a draft; Save creates a linked suggestion, never admission or a run',async()=>{
 const requests:any[]=[];let saved=0;const props={questions,sessionId:U(6),versionId:U(2),disabled:false,onSaved:()=>saved++,onStart:async()=>{}};
 const r=await render('../training/[slug]/training-opportunities.tsx',props,{fetch:(async(_url:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));requests.push({body,key:(init.headers as any)['Idempotency-Key']});return {ok:true,json:async()=>body.action==='present'?{ok:true,presentation:p}:{ok:true,contractVersion:'training-question-teaching.v1',questionReceiptId:q.id,recordId:U(8),recordDigest:H}};}) as any});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 try{assert.equal(requests.length,0);await r.click(r.getByText('Answer →'));assert.equal(requests.length,1);const choices=r.document.querySelectorAll('input[type=radio]');assert.equal(choices.length,3);assert.ok([...choices].every(x=>!(x as HTMLInputElement).checked));await r.click(choices[1]);assert.equal(requests.length,1);assert.equal(saved,0);await r.click(r.getByText('Save answer'));assert.equal(requests.length,2);assert.equal(requests[1].body.rawAnswer,p.value.options[1]);assert.equal(requests[1].body.optionIndex,1);assert.equal(saved,1);assert.equal(r.document.querySelector('section'),null);}finally{r.cleanup();}
});
test('uncertain saves retry the exact key and text; Skip never calls a server',async()=>{
 const requests:any[]=[];let fail=true;const r=await render('../training/[slug]/training-opportunities.tsx',{questions,sessionId:U(6),versionId:U(2),disabled:false,onSaved:()=>{},onStart:async()=>{}},{fetch:(async(_url:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));requests.push({body,key:(init.headers as any)['Idempotency-Key']});if(body.action==='save'&&fail){fail=false;throw Error('network');}return {ok:true,json:async()=>body.action==='present'?{ok:true,presentation:p}:{ok:true,contractVersion:'training-question-teaching.v1',questionReceiptId:q.id,recordId:U(8),recordDigest:H}};}) as any});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 try{await r.click(r.getByText('Answer →'));await r.click(r.document.querySelectorAll('input[type=radio]')[0]);await r.click(r.getByText('Save answer'));assert.ok(r.document.querySelector('[role=alert]'));await r.click(r.getByText('Save answer'));assert.equal(requests[1].key,requests[2].key);assert.deepEqual(requests[1].body,requests[2].body);}finally{r.cleanup();}
 const skip=await render('../training/[slug]/training-opportunities.tsx',{questions,sessionId:U(6),versionId:U(2),disabled:false,onSaved:()=>assert.fail('saved'),onStart:async()=>{}},{fetch:(()=>assert.fail('skip called API')) as any});try{await skip.click(skip.getByText('Skip'));assert.equal(skip.document.querySelector('[aria-labelledby=training-opportunities-heading]'),null);}finally{skip.cleanup();}
});

test('a pending answer blocks other cards and definite rejection restores editing',async()=>{
 const other={...q,id:U(12),property:'layout_variety',questionId:'layout'};let fail=true;const bodies:any[]=[];
 const r=await render('../training/[slug]/training-opportunities.tsx',{questions:{...questions,items:[q,other]},sessionId:U(6),versionId:U(2),disabled:false,onSaved:()=>{},onStart:async()=>{}},{fetch:(async(_url:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));bodies.push(body);if(body.action==='save'&&fail){fail=false;throw Error('network');}return {ok:body.action==='present',json:async()=>body.action==='present'?{ok:true,presentation:p}:{ok:false,reason:'question_answer_invalid_content'}};}) as any});
 try{await r.click([...r.document.querySelectorAll('button')].find(b=>b.textContent==='Answer →')!);await r.click(r.document.querySelectorAll('input[type=radio]')[0]);await r.click(r.getByText('Save answer'));assert.equal((r.getByText('Answer →') as HTMLButtonElement).disabled,true);await r.click(r.getByText('Save answer'));assert.equal((r.document.querySelector('fieldset') as HTMLFieldSetElement).disabled,false);assert.equal((r.getByText('Answer →') as HTMLButtonElement).disabled,false);assert.equal(bodies.filter(b=>b.action==='save').length,2);}finally{r.cleanup();}
});
test('changing the training session releases an in-flight presentation and fences its result',async()=>{
 let resolve:any;const props={questions,sessionId:U(6),versionId:U(2),disabled:false,onSaved:()=>{},onStart:async()=>{}};
 const r=await render('../training/[slug]/training-opportunities.tsx',props,{fetch:(()=>new Promise(r=>resolve=r)) as any});
 try{await r.click(r.getByText('Answer →'));assert.match(r.text(),/Preparing choices/);await r.rerender({...props,sessionId:U(16)});assert.equal((r.getByText('Answer →') as HTMLButtonElement).disabled,false);await r.act(()=>resolve({ok:true,json:async()=>({ok:true,presentation:p})}));assert.doesNotMatch(r.text(),/Suggested approaches/);}finally{r.cleanup();}
});

test('one improvement section groups pending teachings and questions, and disappears when empty',async()=>{
 let reviews=0;const props={questions,sessionId:U(6),versionId:U(2),disabled:false,onSaved:()=>{},onStart:async()=>{},pendingCount:1,onReview:()=>reviews++};
 const r=await render('../training/[slug]/training-opportunities.tsx',props);
 try{const section=r.document.querySelector('[aria-labelledby=training-opportunities-heading]')!;assert.match(section.textContent||'',/AI suggested Training improvements/);assert.match(section.textContent||'',/1 new teaching ready to review/);assert.match(section.textContent||'',/Should the presenter/);await r.click(r.getByText('Review training →'));assert.equal(reviews,1);await r.rerender({...props,questions:{...questions,items:[]}});assert.ok(r.getByText('Review training →'));assert.doesNotMatch(r.text(),/No new questions|Checking recent runs|Help your agent improve/);await r.rerender({...props,pendingCount:0,questions:{...questions,items:[]}});assert.equal(r.document.querySelector('section'),null);await r.rerender({...props,pendingCount:0,questions:null});assert.equal(r.document.querySelector('section'),null);}finally{r.cleanup();}
});
