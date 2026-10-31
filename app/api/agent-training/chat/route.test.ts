import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const SESSION='11111111-1111-4111-8111-111111111111',SOURCE='22222222-2222-4222-8222-222222222222';
const code=buildSync({entryPoints:[fileURLToPath(new URL('./route.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,
 external:['next/server','@/lib/supabase/server'],alias:{'@/lib/trainer-questions':fileURLToPath(new URL('../../../../lib/trainer-questions.ts',import.meta.url))}}).outputFiles[0].text;
function proxy(signedIn=true,offline=false){
 const calls:any[]=[],module={exports:{} as any};runInNewContext(code,{module,exports:module.exports,process:{env:{}},URL,AbortSignal,TextDecoder,Uint8Array,
  require:(name:string)=>name==='next/server'?{NextResponse:{json:(value:unknown,init:any={})=>({value,status:init.status||200,headers:init.headers})}}
   :name==='@/lib/supabase/server'?{createClient:()=>({auth:{getSession:async()=>({data:{session:signedIn?{access_token:'server-session'}:null}})}})}:assert.fail(name),
  fetch:async(url:string,init:any)=>{calls.push({url,init});if(offline)throw Error('private upstream data');return {status:200,json:async()=>({ok:true})};}});
 return {...module.exports,calls};
}
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
