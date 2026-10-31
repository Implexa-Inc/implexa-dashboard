import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const ID='11111111-1111-4111-8111-111111111111';
const code=buildSync({entryPoints:[fileURLToPath(new URL('./route.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,
 external:['next/server','@/lib/supabase/server'],alias:{'@/lib/trainer-questions':fileURLToPath(new URL('../../../../lib/trainer-questions.ts',import.meta.url))}}).outputFiles[0].text;
function proxy(signed=true,offline=false){const calls:any[]=[],module={exports:{} as any};runInNewContext(code,{module,exports:module.exports,process:{env:{}},URL,AbortSignal,TextDecoder,Uint8Array,
 require:(n:string)=>n==='next/server'?{NextResponse:{json:(value:unknown,init:any={})=>({value,status:init.status||200,headers:init.headers})}}
 :n==='@/lib/supabase/server'?{createClient:()=>({auth:{getSession:async()=>({data:{session:signed?{access_token:'server-session'}:null}})}})}:assert.fail(n),
 fetch:async(url:string,init:any)=>{calls.push({url,init});if(offline)throw Error('private provider detail');return {status:200,json:async()=>({ok:true})};}});return {...module.exports,calls};}
test('creation proxy authenticates the caller and uses fixed source routes without forwarding arbitrary credentials',async()=>{
 const p=proxy();await p.GET(new Request(`https://dashboard.test/api/agents/creation-draft?draftId=${ID}`,{headers:{authorization:'attacker'}}));
 assert.equal(p.calls[0].url,`https://core.implexa.ai/api/v2/agents/creation-draft/${ID}`);assert.equal(p.calls[0].init.headers.authorization,'Bearer server-session');
 const b={draftId:ID,message:'Keep this wording',consent:true};const r=await p.POST(new Request('https://dashboard.test/api/agents/creation-draft',{method:'POST',body:JSON.stringify(b)}));
 assert.deepEqual(JSON.parse(p.calls[1].init.body),b);assert.equal(r.headers['Cache-Control'],'no-store');
});
test('foreign-target query, missing authentication and oversized streamed body never reach the backend',async()=>{
 const absent=proxy(false);assert.equal((await absent.GET(new Request(`https://test.invalid/?draftId=${ID}`))).status,401);assert.equal(absent.calls.length,0);
 for(const q of ['draftId=bad',`draftId=${ID}&ownerId=foreign`]){const p=proxy();assert.equal((await p.GET(new Request(`https://test.invalid/?${q}`))).status,400);assert.equal(p.calls.length,0);}
 const p=proxy();assert.equal((await p.POST(new Request('https://test.invalid/',{method:'POST',body:'x'.repeat(10001)}))).status,413);assert.equal(p.calls.length,0);
});
test('ambiguous API submission refuses without retry or upstream detail disclosure',async()=>{
 const p=proxy(true,true),r=await p.POST(new Request('https://test.invalid/',{method:'POST',body:'{}'}));assert.equal(r.status,503);assert.equal(r.value.reason,'creation_brief_unconfirmed');assert.equal(p.calls.length,1);assert.doesNotMatch(JSON.stringify(r),/private provider/);
});
