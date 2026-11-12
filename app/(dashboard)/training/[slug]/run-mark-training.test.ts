import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {render} from '../../../../lib/test/render.ts';
const U=(n:number)=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const bytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(640,16);bytes.writeUInt32BE(360,20);
const image='data:image/png;base64,'+bytes.toString('base64'),evidenceSha256=createHash('sha256').update(bytes).digest('hex');
const binding={sourceId:U(5),reviewSessionId:U(4),issueId:U(3),evidenceId:U(6),expectedActiveVersionId:U(2),issueDigest:sha('body'),anchorDigest:sha('anchor'),artifactSha256:sha('video'),evidenceSha256};
const issue={id:U(3),sessionId:U(4),runId:U(7),artifactId:U(8),body:'Use a spatial explanation here, not a list of names.',status:'draft',anchor:{version:2,temporal:{startMs:1000},observedArtifactSha256:binding.artifactSha256},reviewerResolution:null};
const artifact={id:U(8),runId:U(7),status:'validated',sha256:binding.artifactSha256};
const fields={chosen:'This example lists place names.',why:'Prefer a meaningful spatial relationship when geography matters.',process:'When location helps explain the subject.',desiredBehavior:'Choose a map or spatial illustration that fits the new narration.'};
const context={ok:true,contractVersion:'training-review-mark-evidence.v1',binding,evidence:{evidenceId:U(6),sha256:evidenceSha256,sizeBytes:bytes.length,width:640,height:360,mediaType:'image/png',timeMs:1000},feedback:issue.body,source:{runId:U(7),artifactId:U(8),sourceRole:'same_agent_prior_work'},image};
const suggestion={ok:true,contractVersion:'training-teaching-suggestion.v7',model:'claude-haiku-5-5',binding,status:'suggested',fields,reason:'',scopeSuggestion:{property:'narrative_visual_alignment',relation:'rejected'},sources:{chosen:'observed_frame',why:'trainer_preference',process:'transferable_guidance',desiredBehavior:'transferable_guidance'}};
const receipt={ok:true,contractVersion:'training-review-applied.v1',created:true,recordId:U(9),recordDigest:sha('record'),state:'accepted',acknowledgmentId:U(10),acknowledgmentDigest:sha('ack')};
const button=(r:any,text:string)=>[...r.document.querySelectorAll('button')].find((b:any)=>b.textContent?.trim()===text) as HTMLButtonElement;
async function flush(r:any,condition:()=>boolean){for(let i=0;i<40&&!condition();i++)await r.act(()=>new Promise(resolve=>setTimeout(resolve,5)));assert.equal(condition(),true,r.text());}
async function setup({native=context,reply=suggestion,providerFails=false,applyFails=false,initialJournal}:any={}){
 const calls:any[]=[],nativeCalls:any[]=[],applied:any[]=[],props={sessionId:U(1),currentVersionId:U(2),ownerId:U(11),slug:'video-studio',request:{issue,artifact},onClose:()=>{},onApplied:()=>{applied.push(true);},onScopeCheck:async()=>{}};let applyCount=0;
 const r=await render('../training/[slug]/run-mark-training.tsx',props,{bridge:{trainingReviewMarkContractVersion:'1',trainingLocal:async(operation:string,args:any)=>{nativeCalls.push({operation,args});return native;}},fetch:async(url:any,init:any)=>{const body=JSON.parse(init.body);calls.push({url:String(url),body,init});if(String(url).includes('operation=source'))return {ok:true,json:async()=>({ok:true,sourceId:U(5)})} as Response;
  if(String(url).includes('teaching-suggestion')){if(providerFails)throw Error('network disconnected');return {ok:true,json:async()=>reply} as Response;}
  if(String(url).includes('operation=apply')){if(applyFails&&applyCount++===0)return {ok:false,json:async()=>({ok:false,reason:'unavailable'})} as Response;return {ok:true,json:async()=>receipt} as Response;}throw Error('unexpectedroute');}});
 await r.act(()=>{Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});Object.assign(r.window,{TextEncoder});if(initialJournal)for(const [key,value] of initialJournal)r.window.localStorage.setItem(key,value);});
 return {r,calls,nativeCalls,applied,props};
}
test('marked-frame teaching preserves run provenance and requires visible relation confirmation before Apply',async()=>{
 const {r,calls,nativeCalls,applied}=await setup();try{
  await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('Implexa suggests: avoid this'));
  assert.equal(nativeCalls[0].operation,'readReviewMarkEvidence');assert.equal(nativeCalls[0].args.issueId,issue.id);assert.equal(nativeCalls[0].args.reviewSessionId,issue.sessionId);
  assert.equal(button(r,'Apply selected lesson').disabled,true);assert.equal(calls.some(c=>c.url.includes('operation=apply')),false);
  await r.click(r.document.querySelector('[aria-label="Confirm example use: avoid this"]')!);await r.click(button(r,'Apply selected lesson'));await flush(r,()=>applied.length===1);
  const write=calls.find(c=>c.url.includes('operation=apply'));assert.deepEqual(write.body.fields,fields);assert.equal(write.body.relation,'rejected');assert.equal(write.body.issueDigest,binding.issueDigest);assert.equal(write.body.artifactSha256,binding.artifactSha256);assert.match(write.init.headers['Idempotency-Key'],/^review-mark:[a-f0-9]{64}$/);
  assert.equal(calls.some(c=>/accept|submit|revision|demo-annotation/.test(c.url)),false);assert.match(r.text(),/Your lesson is saved/);
 }finally{r.cleanup();}
});
test('reopening a saved proposal revalidates its PNG and skips the model call',async()=>{
 const first=await setup();let saved:any[]=[];try{await first.r.click(button(first.r,'Extract training'));await flush(first.r,()=>first.r.text().includes('Implexa suggests: avoid this'));saved=Object.entries(first.r.window.localStorage);}finally{first.r.cleanup();}
 const second=await setup({initialJournal:saved});try{await second.r.click(button(second.r,'Extract training'));await flush(second.r,()=>second.r.text().includes('Implexa suggests: avoid this'));assert.equal(second.calls.filter(c=>c.url.includes('teaching-suggestion')).length,0);assert.equal(second.nativeCalls.length,1);}finally{second.r.cleanup();}
});
test('mismatched evidence and unsupported example relations cannot become teaching',async()=>{
 for(const options of [{native:{...context,binding:{...binding,artifactSha256:sha('other')}}},{reply:{...suggestion,scopeSuggestion:{...suggestion.scopeSuggestion,relation:'contrast'}}}]){
  const {r,calls}=await setup(options);try{await r.click(button(r,'Extract training'));await flush(r,()=>!!r.document.querySelector('[role="alert"]')||r.text().includes('needs its category'));assert.equal(button(r,'Apply selected lesson'),undefined);assert.equal(calls.some(c=>c.url.includes('operation=apply')),false);}finally{r.cleanup();}
 }
});
test('an interrupted extraction is not silently re-sent after reopening',async()=>{
 const {r,calls,props}=await setup({providerFails:true});try{await r.click(button(r,'Extract training'));await flush(r,()=>!!r.document.querySelector('[role="alert"]'));await r.rerender({...props,request:null});await r.rerender(props);await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('Drafting was interrupted'));assert.equal(calls.filter(c=>c.url.includes('teaching-suggestion')).length,1);}finally{r.cleanup();}
});
test('uncertain Apply retries the exact same receipt identity and cannot change its fields',async()=>{
 const {r,calls,applied}=await setup({applyFails:true});try{await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('Implexa suggests: avoid this'));await r.click(r.document.querySelector('[aria-label="Confirm example use: avoid this"]')!);await r.click(button(r,'Apply selected lesson'));await flush(r,()=>!!button(r,'Confirm the same Apply'));await r.click(button(r,'Confirm the same Apply'));await flush(r,()=>applied.length===1);const writes=calls.filter(c=>c.url.includes('operation=apply'));assert.equal(writes.length,2);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(writes[0].init.headers['Idempotency-Key'],writes[1].init.headers['Idempotency-Key']);}finally{r.cleanup();}
});
