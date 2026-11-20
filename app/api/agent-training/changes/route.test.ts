import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const SESSION='11111111-1111-4111-8111-111111111111';
const code=buildSync({entryPoints:[fileURLToPath(new URL('./route.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,
 external:['next/server','@/lib/supabase/server'],alias:{'@/lib/trainer-questions':fileURLToPath(new URL('../../../../lib/trainer-questions.ts',import.meta.url))}}).outputFiles[0].text;
function proxy(signedIn=true){
 const calls:any[]=[],logs:any[]=[],timers:{at:number;controller:AbortController}[]=[],module={exports:{} as any};
 runInNewContext(code,{module,exports:module.exports,process:{env:{}},URL,TextDecoder,Uint8Array,
  console:{warn:(event:string,detail:unknown)=>logs.push({event,detail})},
  AbortSignal:{any:AbortSignal.any.bind(AbortSignal),timeout:(at:number)=>{const controller=new AbortController();timers.push({at,controller});return controller.signal;}},
  require:(name:string)=>name==='next/server'?{NextResponse:{json:(value:unknown,init:any={})=>({value,status:init.status||200,headers:init.headers})}}
   :name==='@/lib/supabase/server'?{createClient:()=>({auth:{getSession:async()=>({data:{session:signedIn?{access_token:'server-session'}:null}})}})}:assert.fail(name),
  fetch:(url:string,init:any)=>new Promise((resolve,reject)=>{
   const call={url,init,finish:()=>resolve({status:200,json:async()=>({ok:true})}),fail:reject};calls.push(call);
   const abort=()=>reject(new Error('private upstream cancellation detail'));
   if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});
  })});
 return {...module.exports,calls,logs,advance:(to:number)=>{for(const timer of timers)if(timer.at<=to)timer.controller.abort();}};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const request=(operation?:string,signal?:AbortSignal)=>new Request(`https://dashboard.test/api/agent-training/changes?sessionId=${SESSION}${operation?`&operation=${encodeURIComponent(operation)}`:''}`,
 operation?{method:'POST',headers:{'Idempotency-Key':'same-reviewed-intent'},body:'{"selection":"reviewed"}',signal}:{signal});

test('a slow Training read survives the former deadline and remains bounded',async()=>{
 const p=proxy();let settled=false;const response=p.GET(request()).then((value:any)=>{settled=true;return value;});await tick();
 assert.equal(p.calls.length,1);assert.equal(p.maxDuration,65);
 assert.equal(p.calls[0].url,`https://core.implexa.ai/api/v2/agent-training/sessions/${SESSION}/changes`);
 assert.equal(p.calls[0].init.method,'GET');p.advance(54999);await tick();assert.equal(settled,false);
 p.advance(55000);const result=await response;assert.equal(result.status,503);assert.equal(p.calls.length,1);
 assert.equal(result.value.reason,'training_changes_unavailable');assert.doesNotMatch(JSON.stringify(result),/private upstream/);
});
test('full-set preparation, publication and activation have a sixty-second budget',async()=>{
 for(const operation of ['publication/prepare','publication/publish','tests/prepare','activate']){
  const p=proxy();let settled=false;const response=p.POST(request(operation)).then((value:any)=>{settled=true;return value;});await tick();
  assert.equal(p.calls.length,1);p.advance(35000);await tick();assert.equal(settled,false,operation);
  assert.equal(p.calls[0].url,`https://core.implexa.ai/api/v2/agent-training/sessions/${SESSION}/changes/${operation}`);
  assert.equal(p.calls[0].init.method,'POST');assert.equal(p.maxDuration,65);
  assert.equal(p.calls[0].init.headers['Idempotency-Key'],'same-reviewed-intent');
  assert.equal(p.calls[0].init.headers.authorization,'Bearer server-session');
  assert.equal(p.calls[0].init.body,'{"selection":"reviewed"}');
  p.calls[0].finish();assert.equal((await response).status,200);assert.equal(p.calls.length,1);
  const bounded=proxy();let ended=false;const expiry=bounded.POST(request(operation)).then((value:any)=>{ended=true;return value;});await tick();
  bounded.advance(59999);await tick();assert.equal(ended,false,operation);
  bounded.advance(60000);assert.equal((await expiry).status,503,operation);assert.equal(bounded.calls.length,1);
 }
});
test('ordinary writes retain their existing deadline and never retry after an uncertain response',async()=>{
 for(const operation of ['policy','withdraw','creation-import']){
  const p=proxy();let ended=false;const response=p.POST(request(operation)).then((value:any)=>{ended=true;return value;});await tick();assert.equal(p.calls.length,1);
  p.advance(9999);await tick();assert.equal(ended,false,operation);
  p.advance(10000);assert.equal((await response).status,503,operation);assert.equal(p.calls.length,1);
 }
});
test('record membership can return after the database ceiling but remains bounded and single-shot',async()=>{
 const p=proxy();let ended=false;const response=p.POST(request('records')).then((value:any)=>{ended=true;return value;});await tick();
 p.advance(30000);await tick();assert.equal(ended,false);
 assert.equal(p.calls[0].init.headers['Idempotency-Key'],'same-reviewed-intent');
 assert.equal(p.calls[0].init.body,'{"selection":"reviewed"}');
 p.calls[0].finish();assert.equal((await response).status,200);assert.equal(p.calls.length,1);assert.equal(p.logs.length,0);
 const bounded=proxy();let settled=false;const expiry=bounded.POST(request('records')).then((v:any)=>{settled=true;return v;});await tick();
 bounded.advance(34999);await tick();assert.equal(settled,false);
 bounded.advance(35000);assert.equal((await expiry).status,503);assert.equal(bounded.calls.length,1);
 assert.equal(bounded.logs.length,1);assert.equal(bounded.logs[0].detail.kind,'write');assert.equal(bounded.logs[0].detail.operation,'records');
});
test('proxy failures distinguish reads and writes without logging private request or error content',async()=>{
 for(const operation of [undefined,'records']){
  const p=proxy(),response=operation?p.POST(request(operation)):p.GET(request());await tick();
  p.calls[0].fail(Object.assign(new Error('private upstream response or token'),{name:'TimeoutError'}));
  const result=await response;assert.equal(result.status,503);assert.equal(result.value.reason,'training_changes_unavailable');
  assert.equal(p.calls.length,1);assert.equal(p.logs.length,1);assert.equal(p.logs[0].event,'training_changes_proxy_failure');
  assert.equal(p.logs[0].detail.kind,operation?'write':'read');assert.equal(p.logs[0].detail.operation,operation||'read');
  assert.equal(p.logs[0].detail.errorClass,'TimeoutError');assert.equal(typeof p.logs[0].detail.elapsedMs,'number');
  assert.deepEqual(Object.keys(p.logs[0].detail).sort(),['elapsedMs','errorClass','kind','operation']);
  assert.doesNotMatch(JSON.stringify(p.logs),/private|server-session|same-reviewed-intent|selection|11111111/);
 }
 const other=proxy(),response=other.GET(request());await tick();
 other.calls[0].fail(Object.assign(new Error('secret'),{name:'private custom error name'}));await response;
 assert.equal(other.logs[0].detail.errorClass,'other');assert.doesNotMatch(JSON.stringify(other.logs),/private|secret/);
});
test('caller cancellation still cuts off long requests and invalid targets never reach the backend',async()=>{
 for(const operation of [undefined,'records','publication/prepare']){
  const p=proxy(),controller=new AbortController();const response=operation?p.POST(request(operation,controller.signal)):p.GET(request(undefined,controller.signal));
  await tick();assert.equal(p.calls.length,1);controller.abort();assert.equal((await response).status,503);assert.equal(p.calls.length,1);
 }
 const signedOut=proxy(false);assert.equal((await signedOut.GET(request())).status,401);assert.equal(signedOut.calls.length,0);
 const invalid=proxy();assert.equal((await invalid.GET(new Request(`https://dashboard.test/api/agent-training/changes?sessionId=${SESSION}&ownerId=foreign`))).status,400);
 assert.equal(invalid.calls.length,0);
 const unknown=proxy();assert.equal((await unknown.POST(request('unknown'))).status,400);assert.equal(unknown.calls.length,0);
 const malformed=proxy();assert.equal((await malformed.GET(new Request('https://dashboard.test/api/agent-training/changes?sessionId=bad'))).status,400);assert.equal(malformed.calls.length,0);
});
