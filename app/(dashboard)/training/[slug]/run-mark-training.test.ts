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
 const calls:any[]=[],nativeCalls:any[]=[],applied:any[]=[],props={sessionId:U(1),currentVersionId:U(2),ownerId:U(11),slug:'video-studio',requests:[{issue,artifact}],onClose:()=>{},onApplied:()=>{applied.push(true);},onScopeCheck:async()=>{}};let applyCount=0;
 const r=await render('../training/[slug]/run-mark-training.tsx',props,{bridge:{trainingReviewMarkContractVersion:'1',trainingLocal:async(operation:string,args:any)=>{nativeCalls.push({operation,args});return native;}},fetch:async(url:any,init:any)=>{const body=JSON.parse(init.body);calls.push({url:String(url),body,init});if(String(url).includes('operation=source'))return {ok:true,json:async()=>({ok:true,sourceId:U(5)})} as Response;
  if(String(url).includes('teaching-suggestion')){if(providerFails)throw Error('network disconnected');return {ok:true,json:async()=>reply} as Response;}
  if(String(url).includes('operation=apply')){if(applyFails&&applyCount++===0)return {ok:false,json:async()=>({ok:false,reason:'unavailable'})} as Response;return {ok:true,json:async()=>receipt} as Response;}throw Error('unexpectedroute');}});
 await r.act(()=>{Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});Object.assign(r.window,{TextEncoder});if(initialJournal)for(const [key,value] of initialJournal)r.window.localStorage.setItem(key,value);});
 return {r,calls,nativeCalls,applied,props};
}
test('marked-frame teaching preserves run provenance and uses one visible batch confirmation before Apply',async()=>{
 const {r,calls,nativeCalls,applied}=await setup();try{
  await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('Implexa suggests: avoid this'));
  assert.equal(nativeCalls[0].operation,'readReviewMarkEvidence');assert.equal(nativeCalls[0].args.issueId,issue.id);assert.equal(nativeCalls[0].args.reviewSessionId,issue.sessionId);
  assert.equal(button(r,'Apply selected lesson').disabled,false);assert.equal(calls.some(c=>c.url.includes('operation=apply')),false);
  await r.click(button(r,'Apply selected lesson'));assert.equal(r.document.querySelectorAll('[role="dialog"]').length,1);assert.equal(calls.some(c=>c.url.includes('operation=apply')),false);await r.click(button(r,'Apply these lessons as shown'));await flush(r,()=>applied.length===1);
  const write=calls.find(c=>c.url.includes('operation=apply'));assert.deepEqual(write.body.fields,fields);assert.equal(write.body.relation,'rejected');assert.equal(write.body.issueDigest,binding.issueDigest);assert.equal(write.body.artifactSha256,binding.artifactSha256);assert.match(write.init.headers['Idempotency-Key'],/^review-mark:[a-f0-9]{64}$/);
  assert.equal(calls.some(c=>/accept|submit|revision|demo-annotation/.test(c.url)),false);assert.match(r.text(),/1 lesson saved/);
 }finally{r.cleanup();}
});
test('reopening a saved proposal revalidates its PNG and skips the model call',async()=>{
 const first=await setup();let saved:any[]=[];try{await first.r.click(button(first.r,'Extract training'));await flush(first.r,()=>first.r.text().includes('Implexa suggests: avoid this'));saved=Object.entries(first.r.window.localStorage);}finally{first.r.cleanup();}
 const second=await setup({initialJournal:saved});try{await second.r.click(button(second.r,'Extract training'));await flush(second.r,()=>second.r.text().includes('Implexa suggests: avoid this'));assert.equal(second.calls.filter(c=>c.url.includes('teaching-suggestion')).length,0);assert.ok(second.nativeCalls.length>=1);}finally{second.r.cleanup();}
});
test('mismatched evidence and unsupported example relations cannot become teaching',async()=>{
 for(const options of [{native:{...context,binding:{...binding,artifactSha256:sha('other')}}},{reply:{...suggestion,scopeSuggestion:{...suggestion.scopeSuggestion,relation:'contrast'}}}]){
  const {r,calls}=await setup(options);try{await r.click(button(r,'Extract training'));await flush(r,()=>!!r.document.querySelector('[role="alert"]')||r.text().includes('needs its category'));assert.equal(button(r,'Apply selected lesson'),undefined);assert.equal(calls.some(c=>c.url.includes('operation=apply')),false);}finally{r.cleanup();}
 }
});
test('an interrupted extraction is not silently re-sent after reopening',async()=>{
 const {r,calls,props}=await setup({providerFails:true});try{await r.click(button(r,'Extract training'));await flush(r,()=>!!r.document.querySelector('[role="alert"]'));await r.rerender({...props,requests:null});await r.rerender(props);await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('Drafting was interrupted'));assert.equal(calls.filter(c=>c.url.includes('teaching-suggestion')).length,1);}finally{r.cleanup();}
});
test('uncertain Apply retries the exact same receipt identity and cannot change its fields',async()=>{
 const {r,calls,applied}=await setup({applyFails:true});try{await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('Implexa suggests: avoid this'));await r.click(button(r,'Apply selected lesson'));await r.click(button(r,'Apply these lessons as shown'));await flush(r,()=>!!button(r,'Confirm pending Apply'));await r.click(button(r,'Confirm pending Apply'));await flush(r,()=>applied.length===1);const writes=calls.filter(c=>c.url.includes('operation=apply'));assert.equal(writes.length,2);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(writes[0].init.headers['Idempotency-Key'],writes[1].init.headers['Idempotency-Key']);}finally{r.cleanup();}
});

test('owner can correct the example relation without rewriting the model proposal',async()=>{
 const {r,calls,applied}=await setup();try{
  await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('Implexa suggests: avoid this'));
  await r.click(button(r,'Review'));
  const selector=r.document.querySelector('[aria-label="How to use this example"]') as HTMLSelectElement;
  await r.act(()=>{selector.value='accepted';selector.dispatchEvent(new r.window.Event('change',{bubbles:true}));});
  assert.match(r.text(),/Implexa suggested: avoid this example. You changed it to: keep this example/);assert.match(r.text(),/Your choice: keep this/);
  const stored=JSON.parse(Object.values(r.window.localStorage)[0] as string);assert.equal(stored.suggestion.scopeSuggestion.relation,'rejected');assert.equal(stored.ownerRelationOverride,'accepted');
  await r.click(button(r,'Apply selected lesson'));assert.match(r.text(),/Your choice: keep this/);await r.click(button(r,'Apply these lessons as shown'));await flush(r,()=>applied.length===1);
  assert.equal(calls.find(c=>c.url.includes('operation=apply')).body.relation,'accepted');
 }finally{r.cleanup();}
});
test('a late frame read from the previous note cannot draft into a newly selected request',async()=>{
 let resolveNative!:(v:any)=>void;const pending=new Promise(resolve=>resolveNative=resolve),calls:any[]=[];
 const props={sessionId:U(1),currentVersionId:U(2),ownerId:U(11),slug:'video-studio',requests:[{issue,artifact}],onClose:()=>{},onApplied:()=>{},onScopeCheck:async()=>{}};
 const r=await render('../training/[slug]/run-mark-training.tsx',props,{bridge:{trainingReviewMarkContractVersion:'1',trainingLocal:async()=>pending},fetch:async(url:any)=>{calls.push(String(url));return {ok:true,json:async()=>({ok:true,sourceId:U(5)})} as Response;}});
 try{await r.act(()=>{Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});Object.assign(r.window,{TextEncoder});});await r.click(button(r,'Extract training'));await flush(r,()=>calls.length===1);
  await r.rerender({...props,requests:[{issue:{...issue,id:U(12),body:'A different note'},artifact}]});await r.act(()=>resolveNative(context));
  assert.equal(calls.some(url=>url.includes('teaching-suggestion')),false);assert.equal(r.text().includes('Your agent will learn'),false);assert.equal(button(r,'Apply selected lesson'),undefined);
 }finally{r.cleanup();}
});

async function setupBatch({quotaOnce=false,applyFailure=false,unknownMiddle=false,third=false,offscreen=false}={}){
 const requests=[{issue,artifact},{issue:{...issue,id:U(12),body:'Keep meaningful context quiet around the main takeaway.'},artifact},...(third?[{issue:{...issue,id:U(13),body:'Use motion to unfold the explanation.'},artifact}]:[])];
 const calls:any[]=[],nativeCalls:any[]=[],applied:any[]=[];let quotaUsed=false,applyFailed=false;
 const r=await render('../training/[slug]/run-mark-training.tsx',{sessionId:U(1),currentVersionId:U(2),ownerId:U(11),slug:'video-studio',requests,onClose:()=>{},onApplied:()=>{applied.push(true);},onScopeCheck:async()=>{}},{bridge:{trainingReviewMarkContractVersion:'1',trainingLocal:async(operation:string,args:any)=>{nativeCalls.push({operation,args});const selected=requests.find(item=>item.issue.id===args.issueId)!;return {...context,feedback:selected.issue.body,binding:{...binding,issueId:selected.issue.id,issueDigest:sha(selected.issue.body),evidenceId:selected.issue.id},evidence:{...context.evidence,evidenceId:selected.issue.id}};}},fetch:async(url:any,init:any)=>{const body=init?.body?JSON.parse(init.body):null;calls.push({url:String(url),body,init});if(String(url).includes('operation=source'))return {ok:true,json:async()=>({ok:true,sourceId:U(5)})} as Response;
  if(String(url).includes('teaching-suggestion')){if(quotaOnce&&body.issueId===U(12)&&!quotaUsed){quotaUsed=true;return {ok:false,json:async()=>({ok:false,reason:'teaching_suggestion_rate_limited',retryAfter:60})} as Response;}if(unknownMiddle&&body.issueId===U(12))throw Error('response lost');return {ok:true,json:async()=>({...suggestion,binding:Object.fromEntries(Object.keys(binding).map(key=>[key,body[key]])),fields:{...fields,why:body.issueId===issue.id?fields.why:'Give the main takeaway clear emphasis.'}})} as Response;}
  if(String(url).includes('operation=apply')){if(applyFailure&&body.issueId===U(12)&&!applyFailed){applyFailed=true;return {ok:false,json:async()=>({ok:false,reason:'unavailable'})} as Response;}return {ok:true,json:async()=>({...receipt,recordId:body.issueId,recordDigest:sha(body.issueId)})} as Response;}throw Error('unexpectedroute');}});
 await r.act(()=>{Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});Object.assign(r.window,{TextEncoder});if(offscreen)Object.assign(r.window,{IntersectionObserver:class{observe(){}disconnect(){}}});});
 return {r,requests,calls,nativeCalls,applied};
}
test('Done teaching drafts two notes separately and applies them through one shared review summary',async()=>{
 const {r,calls,applied}=await setupBatch();try{
  assert.match(r.text(),/Extract training from 2 notes/);await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('2 selected')&&r.text().includes('ready to review'));
  const drafts=calls.filter(call=>call.url.includes('teaching-suggestion'));assert.equal(drafts.length,2);assert.deepEqual(drafts.map(call=>call.body.issueId),[issue.id,U(12)]);assert.equal(drafts.every(call=>typeof call.body.image==='string'&&!Array.isArray(call.body.image)),true);
  assert.equal(calls.some(call=>call.url.includes('operation=apply')),false);await r.click(button(r,'Apply 2 selected lessons'));assert.equal(r.document.querySelectorAll('[role="dialog"]').length,1);assert.match(r.text(),/Suggested by Implexa/);
  await r.click(button(r,'Apply these lessons as shown'));await flush(r,()=>applied.length===1);assert.equal(calls.filter(call=>call.url.includes('operation=apply')).length,2);assert.match(r.text(),/2 lessons saved/);
  assert.equal(calls.some(call=>/accept|submit|revision|demo-annotation/.test(call.url)),false);
 }finally{r.cleanup();}
});
test('rate-limited batch preserves the first proposal and resumes only its unfinished note',async()=>{
 const {r,calls}=await setupBatch({quotaOnce:true});try{await r.click(button(r,'Extract training'));await flush(r,()=>!!button(r,'Resume extraction'));assert.match(r.text(),/Try again in 60 seconds/);assert.equal(calls.filter(call=>call.url.includes('teaching-suggestion')).length,2);assert.equal(calls.some(call=>call.url.includes('operation=apply')),false);
  await r.click(button(r,'Resume extraction'));await flush(r,()=>r.text().includes('2 selected')&&r.text().includes('ready to review'));const drafts=calls.filter(call=>call.url.includes('teaching-suggestion'));assert.equal(drafts.filter(call=>call.body.issueId===issue.id).length,1);assert.equal(drafts.filter(call=>call.body.issueId===U(12)).length,2);
 }finally{r.cleanup();}
});
test('partial batch Apply keeps successful teachings and retries only the uncertain exact write',async()=>{
 const {r,calls,applied}=await setupBatch({applyFailure:true});try{await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('2 selected')&&r.text().includes('ready to review'));await r.click(button(r,'Apply 2 selected lessons'));await r.click(button(r,'Apply these lessons as shown'));await flush(r,()=>!!button(r,'Confirm pending Apply'));assert.match(r.text(),/1 of 2 selected lessons confirmed saved/);assert.equal(applied.length,1);
  await r.click(button(r,'Confirm pending Apply'));await flush(r,()=>applied.length===2);const writes=calls.filter(call=>call.url.includes('operation=apply'));assert.equal(writes.filter(call=>call.body.issueId===issue.id).length,1);const retries=writes.filter(call=>call.body.issueId===U(12));assert.equal(retries.length,2);assert.deepEqual(retries[0].body,retries[1].body);assert.equal(retries[0].init.headers['Idempotency-Key'],retries[1].init.headers['Idempotency-Key']);
 }finally{r.cleanup();}
});
test('unknown middle response is held while a later saved note can be resumed without repeating it',async()=>{
 const {r,calls}=await setupBatch({unknownMiddle:true,third:true});try{await r.click(button(r,'Extract training'));await flush(r,()=>!!button(r,'Resume extraction'));await r.click(button(r,'Resume extraction'));await flush(r,()=>r.text().includes('2 selected')&&r.text().includes('ready to review'));assert.equal(calls.filter(call=>call.url.includes('teaching-suggestion')&&call.body.issueId===U(12)).length,1);assert.match(r.text(),/Needs clarification \(1\)/);assert.equal(calls.filter(call=>call.url.includes('teaching-suggestion')&&call.body.issueId===U(13)).length,1);
 }finally{r.cleanup();}
});
test('batch journals keep only context and guidance and offscreen cards do not retain PNGs',async()=>{
 const {r,nativeCalls}=await setupBatch({offscreen:true});try{await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('2 selected')&&r.text().includes('ready to review'));assert.equal(nativeCalls.length,2);assert.equal(r.document.querySelectorAll('img').length,0);const stored=Object.values(r.window.localStorage).join('');assert.doesNotMatch(stored,/data:image|base64/);assert.match(stored,/evidenceSha256/);
 }finally{r.cleanup();}
});
test('a changed owner classification invalidates the frozen batch summary before any write',async()=>{
 const {r,calls}=await setupBatch();try{await r.click(button(r,'Extract training'));await flush(r,()=>r.text().includes('2 selected')&&r.text().includes('ready to review'));await r.click([...r.document.querySelectorAll('button')].find(button=>button.textContent==='Review')!);await r.click(button(r,'Apply 2 selected lessons'));const selector=r.document.querySelector('[aria-label="How to use this example"]') as HTMLSelectElement;await r.act(()=>{selector.value='accepted';selector.dispatchEvent(new r.window.Event('change',{bubbles:true}));});assert.equal(button(r,'Apply these lessons as shown').disabled,true);assert.match(r.text(),/A selected lesson changed/);assert.equal(calls.some(call=>call.url.includes('operation=apply')),false);
 }finally{r.cleanup();}
});
