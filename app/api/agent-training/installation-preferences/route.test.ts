import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const ID='29000000-0000-4000-8000-000000000001';
const code=buildSync({entryPoints:[fileURLToPath(new URL('./route.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,
 external:['next/server','@/lib/supabase/server'],alias:{'@/lib/trainer-questions':fileURLToPath(new URL('../../../../lib/trainer-questions.ts',import.meta.url))}}).outputFiles[0].text;
function proxy(signedIn=true){
 const calls:any[]=[],module={exports:{} as any};
 runInNewContext(code,{module,exports:module.exports,process:{env:{}},URL,URLSearchParams,AbortSignal,
 require:(name:string)=>name==='next/server'?{NextResponse:{json:(value:unknown,init:any={})=>({value,status:init.status||200,headers:init.headers})}}
 :name==='@/lib/supabase/server'?{createClient:()=>({auth:{getSession:async()=>({data:{session:signedIn?{access_token:'server-session'}:null}})}})}:assert.fail(name),
 fetch:async(url:string,init:any)=>{calls.push({url,init});return {status:200,json:async()=>({ok:true})};}});
 return {...module.exports,calls};
}
test('private preference relay uses server auth and only its bounded context/opener',async()=>{
 const p=proxy(),url=`https://dashboard.test/api/agent-training/installation-preferences?installationId=${ID}`;
 assert.equal((await p.GET(new Request(url))).status,200);
 assert.equal(p.calls[0].url,`https://core.implexa.ai/api/v2/agent-training/installations/${ID}/preferences`);
 assert.equal(p.calls[0].init.headers.authorization,'Bearer server-session');
 assert.equal((await p.POST(new Request(url,{method:'POST',headers:{Authorization:'Bearer forged','Idempotency-Key':'private-intent'},body:JSON.stringify({expectedVersionId:ID})}))).status,200);
 assert.equal(p.calls[1].init.headers.authorization,'Bearer server-session');assert.deepEqual(JSON.parse(p.calls[1].init.body),{expectedVersionId:ID});
 for(const query of [`installationId=${ID}&ownerId=${ID}`,'installationId=../publisher',`installationId=${ID}&sessionId=invalid`]){
  const x=proxy();assert.equal((await x.GET(new Request(`https://dashboard.test/?${query}`))).status,400);assert.equal(x.calls.length,0);
 }
 const x=proxy();assert.equal((await x.POST(new Request(url,{method:'POST',headers:{'Idempotency-Key':'private-intent'},body:JSON.stringify({expectedVersionId:ID,privacyScope:'owner_private'})}))).status,400);assert.equal(x.calls.length,0);
 const noAuth=proxy(false);assert.equal((await noAuth.GET(new Request(url))).status,401);assert.equal(noAuth.calls.length,0);
});
