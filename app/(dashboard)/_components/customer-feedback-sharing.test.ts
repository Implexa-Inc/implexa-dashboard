import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {render} from '../../../lib/test/render.ts';
const U=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'),image=`data:image/png;base64,${bytes.toString('base64')}`;
const evidence={evidenceId:U(2),sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length,width:1,height:1,mediaType:'image/png',timeMs:100};
const issue={id:U(3),body:'Show meaningful geography.',anchor:{version:2},sessionId:U(4),runId:U(5),artifactId:U(6),kind:'content',status:'draft',submittedRequestId:null,createdAt:null,reviewerResolution:null};
const contribution={id:U(7),agentFamilyId:U(8),producingVersionId:U(9),shareDigest:H,excerpt:issue.body,evidence,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),storedAt:new Date().toISOString(),withdrawnAt:null,dismissedAt:null,referenceOnly:true};
test('customer reviews exact note and frame before explicit sharing; retries preserve share identity and withdrawal is separate',async()=>{
 const requests:any[]=[],native:any[]=[],preview={ok:true,contractVersion:'customer-feedback-share-context.v1',receipt:{customerId:U(1),issueId:issue.id,excerpt:issue.body,evidence,assistedDraftingAllowed:true,assistedDraftingProvider:'anthropic'},shareDigest:H,image,trainerName:'the trainer',agentName:'Video Studio'};
 let lose=true;
 const r=await render('customer-feedback-sharing.tsx',{issue,ownerId:U(1)},{bridge:{customerContributionEvidenceContractVersion:'1',trainingLocal:async(op:string,args:any)=>{native.push({op,args});return preview;}},fetch:(async(_url:any,init:any)=>{requests.push(init);const body=JSON.parse(init.body);if(body.action==='share'&&lose){lose=false;throw Error('lost');}return {ok:true,json:async()=>({ok:true,contribution:body.action==='withdraw'?{...contribution,withdrawnAt:new Date().toISOString()}:contribution})};}) as typeof fetch});
 Object.defineProperty(r.window,'crypto',{value:webcrypto});
 try{
  await r.click(r.getByText('Suggest an improvement to the trainer'));assert.equal(requests.length,0);assert.equal(native.length,0);
  await r.click(r.getByText('Review what will be shared'));assert.equal(native.length,1);assert.equal(requests.length,0);assert.equal(r.document.querySelector('img')?.getAttribute('src'),image);assert.match(r.text(),/Anthropic’s AI to draft guidance/);
  await r.click(r.getByText('Share with the trainer'));assert.equal(requests.length,1);
  await r.click(r.getByText('Share with the trainer'));assert.equal(requests.length,2);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
  const sent=JSON.parse(requests[1].body);assert.equal(sent.consent,true);assert.equal(sent.excerpt,issue.body);assert.equal(sent.image,image);assert.equal(sent.ownerId,undefined);
  assert.match(r.text(),/with the trainer for review/);await r.click(r.getByText('Withdraw this shared example'));assert.equal(JSON.parse(requests[2].body).action,'withdraw');
 }finally{r.cleanup();}
});
test('missing Desktop route leaves feedback private and makes zero share requests',async()=>{
 let calls=0;const r=await render('customer-feedback-sharing.tsx',{issue,ownerId:U(1)},{fetch:(async()=>{calls++;throw Error('must not share');}) as typeof fetch});
 try{await r.click(r.getByText('Suggest an improvement to the trainer'));await r.click(r.getByText('Review what will be shared'));assert.match(r.text(),/Update Implexa Desktop/);assert.equal(calls,0);assert.equal(r.queryByText('Share with the trainer'),null);}finally{r.cleanup();}
});

test('switching annotations while native preview is pending does not leave the new note busy',async()=>{
 let resolveOld!:(value:any)=>void;
 const r=await render('customer-feedback-sharing.tsx',{issue,ownerId:U(1)},{bridge:{customerContributionEvidenceContractVersion:'1',trainingLocal:async()=>new Promise(resolve=>{resolveOld=resolve;})}});
 Object.defineProperty(r.window,'crypto',{value:webcrypto});
 try{
  await r.click(r.getByText('Suggest an improvement to the trainer'));await r.click(r.getByText('Review what will be shared'));
  await r.rerender({issue:{...issue,id:U(30),body:'A different saved note.'},ownerId:U(1)});
  await r.act(()=>resolveOld({ok:false,reason:'customer_feedback_frame_unavailable'}));
  await r.click(r.getByText('Suggest an improvement to the trainer'));assert.equal((r.getByText('Review what will be shared') as HTMLButtonElement).disabled,false);
  assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement).value,'A different saved note.');assert.equal(r.document.querySelector('img'),null);
 }finally{r.cleanup();}
});
