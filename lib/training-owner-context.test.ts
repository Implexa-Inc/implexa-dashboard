import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const owner='90000000-0000-4000-8000-000000000001',family='90000000-0000-4000-8000-000000000002';
const card={workflow_id:family,slug:'owned',source:'generated',name:'Owned'};
let ownedResponse:unknown,detailResponse:unknown;
const reads:string[]=[];
const link=()=>null,host=()=>null;
// Execute the real server pages and their real catalog/detail readers. Only the
// auth/framework/UI boundary is stubbed; fetch returns deterministic failures.
function page(entry:string){
 const built=buildSync({entryPoints:[resolve(root,entry)],absWorkingDir:root,bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',external:['@/lib/supabase/server','@/lib/review','./training-route-host']});
 const module={exports:{}};
 const load=(name:string)=>{
  if(name==='@/lib/supabase/server')return {createClient:()=>({auth:{getUser:async()=>({data:{user:{id:owner}}}),getSession:async()=>({data:{session:{user:{id:owner},access_token:'synthetic-session'}}})}})};
  if(name==='next/navigation')return {redirect:(url:string)=>{throw Error('redirect:'+url);},notFound:()=>{throw Error('not found');}};
  if(name==='next/link')return {__esModule:true,default:link};
  if(name==='./training-route-host')return {TrainingRouteConfig:host};
  if(name==='@/lib/review')return {getReviewPacket:()=>{throw Error('Unexpected run read');}};
  return require(name);
 };
 new Function('require','module','exports',built.outputFiles[0].text)(load,module,module.exports);
 return (module.exports as {default:(props:any)=>Promise<any>}).default;
}
const train=page('app/(dashboard)/training/[slug]/page.tsx');
const annotate=page('app/(dashboard)/training/[slug]/training-annotation-page.tsx');
const pages=[()=>train({params:{slug:'owned'}}),()=>annotate({slug:'owned',target:{kind:'image',sourceId:family,sessionId:owner}})];
async function run(fn:()=>Promise<any>,owned:unknown,detail:unknown={ok:false}){
 ownedResponse=owned;detailResponse=detail;reads.length=0;
 const original=globalThis.fetch;
 globalThis.fetch=(async(url,init)=>{
  const path=new URL(String(url)).pathname;reads.push(path);
  assert.deepEqual(init?.headers,{authorization:'Bearer synthetic-session'});
  if(path==='/api/v2/me/workflows')return {ok:true,json:async()=>ownedResponse};
  if(path==='/api/v2/me/agents/owned/detail')return {ok:(detailResponse as any)?.ok===true,status:(detailResponse as any)?.ok?200:503,json:async()=>detailResponse};
  throw Error('Unexpected fetch '+path);
 }) as typeof fetch;
 try{return await fn();}finally{globalThis.fetch=original;}
}
test('both real Train pages preserve owner family identity when the detail read fails, without enabling edits or runs',async()=>{
 for(const invoke of pages){
  const result=await run(invoke,{ok:true,workflows:[card]});
  assert.equal(result.type,host);assert.equal(result.props.value.familyId,family);
  assert.equal(result.props.value.ownerId,owner);assert.equal(result.props.value.runContext.statusUnavailable,true);
  assert.equal(result.props.value.runContext.workflowVersionId,null);
  assert.equal(reads.filter(path=>path==='/api/v2/me/workflows').length,1);
  assert.equal(reads.filter(path=>path.endsWith('/detail')).length,1);
 }
});
test('unreadable, unowned, malformed and ambiguous owner identities never mount the training controller',async()=>{
 for(const workflows of [[],[{...card,source:'community'}],[{...card,workflow_id:'not-a-uuid'}],[card,{...card,workflow_id:owner}]]){
  for(const invoke of pages){const result=await run(invoke,{ok:true,workflows});assert.equal(result.type,'main');assert.equal(result.props.value,undefined);}
 }
 for(const invoke of pages){const result=await run(invoke,{ok:false,workflows:[card]});assert.equal(result.type,'main');}
});
test('a mismatched optional detail cannot lend its version, actions or runs to the verified owner identity',async()=>{
 const wrong={ok:true,workflow:{id:owner,slug:'owned',source:'generated',workflow_version_id:owner},lifecycle:{requests:[],runningRun:false},runs:[]};
 for(const invoke of pages){const result=await run(invoke,{ok:true,workflows:[card]},wrong);assert.equal(result.type,host);assert.equal(result.props.value.familyId,family);assert.equal(result.props.value.runContext.workflowVersionId,null);assert.equal(result.props.value.runContext.statusUnavailable,true);}
});
test('matching healthy detail retains its version and ordinary action status; installation preferences keep their existing path',async()=>{
 const healthy={ok:true,workflow:{id:family,slug:'owned',source:'generated',workflow_version_id:owner},lifecycle:{requests:[],runningRun:false},runs:[]};
 for(const invoke of pages){const result=await run(invoke,{ok:true,workflows:[card]},healthy);assert.equal(result.type,host);assert.equal(result.props.value.runContext.workflowVersionId,owner);assert.equal(result.props.value.runContext.statusUnavailable,false);}
 const result=await run(()=>train({params:{slug:'owned'},searchParams:{installationId:family}}),{ok:false});
 assert.equal(result.type,host);assert.equal(result.props.value.installationId,family);assert.equal(result.props.value.familyId,undefined);assert.equal(result.props.value.runContext,undefined);assert.deepEqual(reads,[]);
});
