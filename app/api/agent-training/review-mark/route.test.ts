import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
const S='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222',A='33333333-3333-4333-8333-333333333333';
const code=buildSync({entryPoints:[fileURLToPath(new URL('./route.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['next/server','@/lib/supabase/server'],alias:{'@/lib/trainer-questions':fileURLToPath(new URL('../../../../lib/trainer-questions.ts',import.meta.url))}}).outputFiles[0].text;
function proxy(signedIn=true){const calls:any[]=[],module={exports:{} as any};runInNewContext(code,{module,exports:module.exports,process:{env:{}},URL,URLSearchParams,AbortSignal,TextDecoder,Uint8Array,
 require:(name:string)=>name==='next/server'?{NextResponse:{json:(value:any,init:any={})=>({value,status:init.status||200,headers:init.headers})}}:name==='@/lib/supabase/server'?{createClient:()=>({auth:{getSession:async()=>({data:{session:signedIn?{access_token:'server-token'}:null}})}})}:assert.fail(name),
 fetch:async(url:string,init:any)=>{calls.push({url,init});return {status:200,json:async()=>({ok:true})};}});return {...module.exports,calls};}
const req=(operation:string,body:any,key?:string)=>new Request(`https://app.test/api/agent-training/review-mark?sessionId=${S}&operation=${operation}`,{method:'POST',headers:{Authorization:'Bearer forged',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
test('source attach is ids-only and Apply forwards only the existing owner-authenticated route',async()=>{
 const p=proxy();assert.equal((await p.POST(req('source',{runId:R,artifactId:A}))).status,200);assert.equal(p.calls[0].url,`https://core.implexa.ai/api/v2/agent-training/sessions/${S}/sources`);assert.equal(p.calls[0].init.headers.authorization,'Bearer server-token');
 assert.deepEqual(JSON.parse(p.calls[0].init.body),{runId:R,artifactId:A});assert.equal(p.calls[0].init.headers['Idempotency-Key'],undefined);
 assert.equal((await p.POST(req('apply',{issueId:R},'stable-mark-key'))).status,200);assert.equal(p.calls[1].url,`https://core.implexa.ai/api/v2/agent-training/sessions/${S}/review-mark`);assert.equal(p.calls[1].init.headers['Idempotency-Key'],'stable-mark-key');
 assert.equal(p.calls.every((c:any)=>!c.url.includes('/accept')&&!c.url.includes('/submit')),true);
});
test('context is a no-store bounded read over exact identities',async()=>{
 const p=proxy(),response=await p.GET(new Request(`https://app.test/api/agent-training/review-mark?sessionId=${S}&sourceId=${A}&reviewSessionId=${S}&issueId=${R}`));
 assert.equal(response.status,200);assert.equal(p.calls[0].init.method,'GET');assert.equal(p.calls[0].init.body,undefined);assert.match(p.calls[0].url,/\/review-mark\?sourceId=/);assert.equal(response.headers['Cache-Control'],'no-store');
});
test('anonymous, arbitrary-route, derived-source and oversized requests do not forward',async()=>{
 const anonymous=proxy(false);assert.equal((await anonymous.POST(req('source',{runId:R,artifactId:A}))).status,401);assert.equal(anonymous.calls.length,0);
 for(const [operation,body,key] of [['delete',{},'stable-key'],['source',{runId:R,artifactId:A,sourceRole:'same_agent_prior_work'},undefined],['apply',{},undefined]] as const){const p=proxy();assert.equal((await p.POST(req(operation,body,key))).status,400);assert.equal(p.calls.length,0);}
 const large=proxy();assert.equal((await large.POST(req('apply',{text:'x'.repeat(16001)},'stable-key'))).status,413);assert.equal(large.calls.length,0);
 const ambiguous=proxy();assert.equal((await ambiguous.GET(new Request(`https://app.test/api/agent-training/review-mark?sessionId=${S}&sourceId=${A}&sourceId=${R}&reviewSessionId=${S}&issueId=${R}`))).status,400);assert.equal(ambiguous.calls.length,0);
});
