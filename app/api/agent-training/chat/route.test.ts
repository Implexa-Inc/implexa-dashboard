import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const SESSION='11111111-1111-4111-8111-111111111111',SOURCE='22222222-2222-4222-8222-222222222222';
const code=buildSync({entryPoints:[fileURLToPath(new URL('./route.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,
 external:['next/server','@/lib/supabase/server'],alias:{'@/lib/trainer-questions':fileURLToPath(new URL('../../../../lib/trainer-questions.ts',import.meta.url))}}).outputFiles[0].text;
function proxy(signedIn:boolean|null=true,offline=false,decodeError=false){
 const calls:any[]=[],diagnostics:any[]=[],module={exports:{} as any};runInNewContext(code,{module,exports:module.exports,process:{env:{}},URL,AbortSignal,TextDecoder,Uint8Array,
  console:{info:(event:string,detail:unknown)=>diagnostics.push({event,detail}),warn:(event:string,detail:unknown)=>diagnostics.push({event,detail})},
  require:(name:string)=>name==='next/server'?{NextResponse:{json:(value:unknown,init:any={})=>({value,status:init.status||200,headers:init.headers})}}
   :name==='@/lib/supabase/server'?{createClient:()=>({auth:{getSession:async()=>{if(signedIn===null)throw Error('private auth failure');return {data:{session:signedIn?{access_token:'server-session'}:null}};}}})}:assert.fail(name),
  fetch:async(url:string,init:any)=>{calls.push({url,init});if(offline)throw Error('private upstream data');return {status:200,json:async()=>{if(decodeError)throw Error('private response body');return {ok:true};}};}});
 return {...module.exports,calls,diagnostics};
}
test('failed chat reads distinguish transport from decoding without logging server credentials or response bodies',async()=>{
 for(const decodeError of [false,true]){
  const p=proxy(true,!decodeError,decodeError),r=await p.GET(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}`));
  assert.equal(r.status,503);assert.equal(r.value.reason,'training_chat_unavailable');assert.equal(p.calls.length,1);
  assert.equal(p.diagnostics.length,1);assert.equal(p.diagnostics[0].detail.phase,decodeError?'decode':'fetch');
  assert.equal(p.diagnostics[0].detail.upstreamStatus,decodeError?200:null);
  assert.equal(p.diagnostics[0].detail.deadlineExpired,false);assert.equal(p.diagnostics[0].detail.callerAborted,false);
  assert.doesNotMatch(JSON.stringify(p.diagnostics),/private|server-session|authorization|sessionId|Bearer/);
 }
});
test('auth read diagnostics preserve the original rejection and do not forward credentials',async()=>{
 const p=proxy(null);
 await assert.rejects(p.GET(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}`)),/private auth failure/);
 assert.equal(p.calls.length,0);assert.equal(p.diagnostics.length,1);
 assert.equal(p.diagnostics[0].detail.phase,'auth');assert.equal(p.diagnostics[0].detail.outcome,'exception');
 assert.doesNotMatch(JSON.stringify(p.diagnostics),/private|server-session|authorization|sessionId|Bearer/);
});
test('chat proxy forwards only server credentials and exact session/source routes',async()=>{
 const p=proxy();await p.GET(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}&sourceId=${SOURCE}`));
 assert.equal(p.calls[0].url,`https://core.implexa.ai/api/v2/agent-training/sessions/${SESSION}/chat?sourceId=${SOURCE}`);
 assert.equal(p.calls[0].init.headers.authorization,'Bearer server-session');
 const r=await p.POST(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}`,{method:'POST',body:'{"message":"hello"}'}));
 assert.equal(p.calls[1].init.method,'POST');assert.equal(r.headers['Cache-Control'],'no-store');
});
test('unauthorized, target-forged and oversized chat requests never reach backend',async()=>{
 const p=proxy(false);assert.equal((await p.GET(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}`))).status,401);assert.equal(p.calls.length,0);
 for(const q of [`sessionId=${SESSION}&ownerId=foreign`,`sessionId=${SESSION}&url=https://elsewhere.test`]){
  const f=proxy();assert.equal((await f.GET(new Request(`https://dashboard.test/api/agent-training/chat?${q}`))).status,400);assert.equal(f.calls.length,0);
 }
 const big=proxy();assert.equal((await big.POST(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}`,{method:'POST',body:'x'.repeat(16001)}))).status,413);assert.equal(big.calls.length,0);
});
test('ambiguous forwarding failures are typed and never automatically retried',async()=>{
 const p=proxy(true,true);const r=await p.POST(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}`,{method:'POST',body:'{}'}));
 assert.equal(r.status,503);assert.equal(r.value.reason,'training_chat_response_unconfirmed');assert.equal(p.calls.length,1);assert.doesNotMatch(JSON.stringify(r),/private upstream/);
});


test('direction-aware discovery reaches the existing backend unchanged and rejects ambiguous pins',async()=>{
 const p=proxy();await p.GET(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}&sourceId=${SOURCE}&directionScopeContract=training-direction-scope.v1`));
 assert.match(p.calls[0].url,/sourceId=.*&directionScopeContract=training-direction-scope.v1$/);
 for(const suffix of ['directionScopeContract=unknown','directionScopeContract=training-direction-scope.v1&directionScopeContract=training-direction-scope.v1']){const bad=proxy();assert.equal((await bad.GET(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}&${suffix}`))).status,400);assert.equal(bad.calls.length,0);}
 const body={directionScopeContract:'training-direction-scope.v1',message:'For the cinematic direction only.'};await p.POST(new Request(`https://dashboard.test/api/agent-training/chat?sessionId=${SESSION}`,{method:'POST',body:JSON.stringify(body)}));assert.deepEqual(JSON.parse(p.calls[1].init.body),body);
});
