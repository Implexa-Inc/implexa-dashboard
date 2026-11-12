import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const record=()=>JSON.parse(readFileSync(new URL('../../../../lib/__fixtures__/training-review-mark-record.v1.json',import.meta.url),'utf8'));
const S='00000000-0000-4000-8000-000000000010',R=record().recordId,H=record().recordDigest;
const code=buildSync({entryPoints:[fileURLToPath(new URL('./route.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['next/server','@/lib/supabase/server'],alias:{'@/lib/trainer-questions':fileURLToPath(new URL('../../../../lib/trainer-questions.ts',import.meta.url)),'@/lib/training-review-mark':fileURLToPath(new URL('../../../../lib/training-review-mark.ts',import.meta.url))}}).outputFiles[0].text;
function proxy({signedIn=true,status=200,body=record(),large=false,offline=false,writeStatus=200,writeBody={ok:true,created:true,recordId:R,eventId:'00000000-0000-4000-8000-000000000020',action:'discard'}}={}){const calls:any[]=[],module={exports:{} as any};runInNewContext(code,{module,exports:module.exports,process:{env:{}},URL,URLSearchParams,AbortSignal,TextDecoder,Uint8Array,
 require:(name:string)=>name==='next/server'?{NextResponse:{json:(value:any,init:any={})=>({value,status:init.status||200,headers:init.headers})}}:name==='@/lib/supabase/server'?{createClient:()=>({auth:{getSession:async()=>({data:{session:signedIn?{access_token:'server-token'}:null}})}})}:assert.fail(name),
 fetch:async(url:string,init:any)=>{calls.push({url,init});if(offline)throw Error('private transport detail');if(init.method==='POST')return new Response(JSON.stringify(writeBody),{status:writeStatus});return new Response(large?'x'.repeat(33000):JSON.stringify(body),{status});}});return {...module.exports,calls};}
const request=(extra='')=>new Request(`https://app.test/api/agent-training/review-mark-record?sessionId=${S}&recordId=${R}&expectedRecordDigest=${H}${extra}`,{headers:{Authorization:'Bearer forged'}});
test('saved teaching read uses server auth, exact record digest and the existing owner-only endpoint',async()=>{
 const p=proxy(),response=await p.GET(request());assert.equal(response.status,200);assert.equal(response.value.sourceMark.body,record().sourceMark.body);assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(typeof p.POST,'function');
 assert.equal(p.calls.length,1);assert.equal(p.calls[0].url,`https://core.implexa.ai/api/v2/agent-training/sessions/${S}/review-mark-record?recordId=${R}&expectedRecordDigest=${H}`);assert.equal(p.calls[0].init.headers.authorization,'Bearer server-token');assert.equal(p.calls[0].init.method,'GET');assert.equal(p.calls[0].init.body,undefined);
});
test('foreign, stale and withdrawn reader refusals carry no saved-note prose',async()=>{
 for(const [status,reason] of [[404,'training_review_record_not_found'],[409,'teaching_changed'],[409,'training_review_record_unavailable']] as const){const p=proxy({status,body:{ok:false,reason,sourceMark:{body:'must not leak'}} as any}),response=await p.GET(request());assert.equal(response.status,status);assert.equal(response.value.reason,reason);assert.equal(response.value.sourceMark,undefined);}
});
test('reader rejects anonymous/ambiguous scope and bounds malformed or unavailable responses',async()=>{
 const anon=proxy({signedIn:false});assert.equal((await anon.GET(request())).status,401);assert.equal(anon.calls.length,0);
 for(const extra of [`&recordId=${R}`,'&ownerId=foreign',`&expectedRecordDigest=${H}`]){const p=proxy();assert.equal((await p.GET(request(extra))).status,400);assert.equal(p.calls.length,0);}
 for(const p of [proxy({body:{...record(),recordDigest:'b'.repeat(64)}}),proxy({large:true}),proxy({offline:true})]){const response=await p.GET(request());assert.equal(response.status,503);assert.equal(response.value.sourceMark,undefined);assert.doesNotMatch(JSON.stringify(response),/private transport detail/);}
});

const discard=(body:any={action:'discard',recordId:R,expectedRecordDigest:H},key='saved-teaching-discard-123',extra='')=>new Request(`https://app.test/api/agent-training/review-mark-record?sessionId=${S}${extra}`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key,authorization:'Bearer forged'},body:JSON.stringify(body)});
test('withdraw derives the original session server-side and forwards only existing discard with the same intent key',async()=>{
 const p=proxy(),response=await p.POST(discard());assert.equal(response.status,200);assert.equal(response.value.action,'discard');assert.equal(response.value.recordId,R);assert.equal(p.calls.length,2);
 assert.match(p.calls[0].url,new RegExp(`/sessions/${S}/review-mark-record`));const write=p.calls[1];assert.equal(write.url,`https://core.implexa.ai/api/v2/agent-training/sessions/${record().trainingSessionId}/competence/${R}/discard`);assert.equal(write.init.headers.authorization,'Bearer server-token');assert.equal(write.init.headers['Idempotency-Key'],'saved-teaching-discard-123');assert.deepEqual(JSON.parse(write.init.body),{expectedDigest:H});
 await p.POST(discard());assert.equal(p.calls[3].init.headers['Idempotency-Key'],write.init.headers['Idempotency-Key']);
});
test('withdraw rejects supplied origin, arbitrary operations, foreign/stale scope and invalid intent keys before mutation',async()=>{
 const anon=proxy({signedIn:false});assert.equal((await anon.POST(discard())).status,401);assert.equal(anon.calls.length,0);
 for(const request of [discard({action:'discard',recordId:R,expectedRecordDigest:H,trainingSessionId:record().trainingSessionId}),discard({action:'activate',recordId:R,expectedRecordDigest:H}),discard(undefined,'short'),discard(undefined,'commit:forbidden-key'),discard(undefined,undefined,'&origin=foreign'),discard(undefined,undefined,`&sessionId=${S}`)]){const p=proxy();assert.equal((await p.POST(request)).status,400);assert.equal(p.calls.length,0);}
 for(const reason of ['teaching_changed','training_review_record_not_found']){const p=proxy({status:409,body:{ok:false,reason} as any}),response=await p.POST(discard());assert.equal(response.status,409);assert.equal(p.calls.length,1);assert.equal(p.calls[0].init.method,'GET');}
});
test('withdraw returns no guessed success for invalid receipt or transport failure',async()=>{
 for(const p of [proxy({writeBody:{ok:true,created:true,recordId:'foreign',eventId:R,action:'discard'}}),proxy({offline:true}),proxy({writeStatus:409,writeBody:{ok:false,reason:'idempotency_key_conflict',sourceMark:{body:'private'}} as any})]){
  const response=await p.POST(discard());assert.ok([409,503].includes(response.status));assert.equal(response.value.ok,false);assert.equal(response.value.sourceMark,undefined);assert.doesNotMatch(JSON.stringify(response),/private transport detail/);
 }
});
