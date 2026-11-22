import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const owner='90000000-0000-4000-8000-000000000001',family='90000000-0000-4000-8000-000000000002';
const fixtureRoot=resolve(root,'lib/test/fixtures/training-owner-context');
const fixture=(name:string)=>JSON.parse(readFileSync(resolve(fixtureRoot,name+'.json'),'utf8'));
const catalog=fixture('owner-catalog'),healthy=fixture('agent-detail'),failedDetail=fixture('agent-detail-unavailable'),failedCatalog=fixture('owner-catalog-unavailable'),hiddenCatalog=fixture('owner-catalog-hidden');
const card=catalog.body.workflows[0],version=healthy.body.workflow.workflow_version_id;
let ownedResponse:any,detailResponse:any;
const reads:string[]=[];
const link=()=>null,host=()=>null,picker=()=>null,unavailable=()=>null;
// Execute the real server pages and their real catalog/detail readers. Only the
// auth/framework/UI boundary is stubbed; fetch returns deterministic failures.
function page(entry:string){
 const built=buildSync({entryPoints:[resolve(root,entry)],absWorkingDir:root,bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',external:['@/lib/supabase/server','@/lib/review','./training-route-host','../_components/training-agent-picker']});
 const module={exports:{}};
 const load=(name:string)=>{
  if(name==='@/lib/supabase/server')return {createClient:()=>({auth:{getUser:async()=>({data:{user:{id:owner}}}),getSession:async()=>({data:{session:{user:{id:owner},access_token:'synthetic-session'}}})}})};
  if(name==='next/navigation')return {redirect:(url:string)=>{throw Error('redirect:'+url);},notFound:()=>{throw Error('not found');}};
  if(name==='next/link')return {__esModule:true,default:link};
  if(name==='../_components/training-agent-picker')return {__esModule:true,default:picker,TrainingFeedUnavailable:unavailable};
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
async function run(fn:()=>Promise<any>,owned:unknown,detail:unknown=failedDetail){
 ownedResponse=owned;detailResponse=detail;reads.length=0;
 const original=globalThis.fetch;
 globalThis.fetch=(async(url,init)=>{
  const path=new URL(String(url)).pathname;reads.push(path);
  assert.deepEqual(init?.headers,{authorization:'Bearer synthetic-session'});
  if(path==='/api/v2/me/workflows'&&ownedResponse.throwName)throw Object.assign(new Error('Synthetic transport failure'),{name:ownedResponse.throwName});
  if(path==='/api/v2/me/workflows')return {ok:ownedResponse.status>=200&&ownedResponse.status<300,status:ownedResponse.status,json:async()=>ownedResponse.body};
  if(path==='/api/v2/me/agents/owned/detail')return {ok:detailResponse.status>=200&&detailResponse.status<300,status:detailResponse.status,json:async()=>detailResponse.body};
  throw Error('Unexpected fetch '+path);
 }) as typeof fetch;
 try{return await fn();}finally{globalThis.fetch=original;}
}
test('the HTTP boundary fixtures are pinned actual route-handler output, not hand-built envelopes',()=>{
 const provenance=fixture('provenance');assert.equal(provenance.backendCommit,'bb3b3f63dd13eb15b39f1f3cff6aec48f1561c41');
 assert.ok(provenance.entryPoints.includes('GET /api/v2/me/agents/:slug/detail'));
 assert.ok(provenance.entryPoints.includes('GET /api/v2/me/workflows'));
 assert.equal(provenance.networkForbiddenByThrowingFetch,true);
 for(const entry of provenance.fixtureFiles)assert.equal(createHash('sha256').update(readFileSync(resolve(fixtureRoot,entry.file))).digest('hex'),entry.sha256);
 assert.equal(failedDetail.status,503);assert.equal(failedCatalog.status,200);assert.equal(failedCatalog.body.ok,false);
});
test('both real Train pages preserve owner family identity on an actual 503 detail envelope without enabling edits/runs',async()=>{
 for(const invoke of pages){
  const result=await run(invoke,catalog);
  assert.equal(result.type,host);assert.equal(result.props.value.familyId,family);
  assert.equal(result.props.value.ownerId,owner);assert.equal(result.props.value.runContext.statusUnavailable,true);
  assert.equal(result.props.value.runContext.workflowVersionId,null);
  assert.equal(reads.filter(path=>path==='/api/v2/me/workflows').length,1);
  assert.equal(reads.filter(path=>path.endsWith('/detail')).length,1);
 }
});
test('a library outage or hidden agent preserves main Train using only the existing positive exact owner proof',async()=>{
 for(const library of [failedCatalog,hiddenCatalog]){
  const result=await run(pages[0],library,healthy);assert.equal(result.type,host);assert.equal(result.props.value.familyId,family);assert.equal(result.props.value.runContext.workflowVersionId,version);assert.equal(result.props.value.runContext.statusUnavailable,false);
  assert.equal((await run(pages[1],library,healthy)).type,'main','the annotation-page existing ownership gate remains unchanged');
 }
});
test('false or unavailable owner proof does not turn visible optional details into a coaching family',async()=>{
 for(const name of ['agent-detail-owner-false','agent-detail-owner-unknown']){
  const producer=fixture(name);const result=await run(pages[0],failedCatalog,producer);assert.equal(result.type,host);assert.equal(result.props.value.familyId,undefined);assert.equal(result.props.value.runContext.workflowVersionId,version,'ordinary detail display posture is retained; it grants no teaching authority');
 }
});
test('malformed or ambiguous catalog bindings cannot fall back to otherwise positive detail ownership',async()=>{
 for(const workflows of [[{...card,workflow_id:'not-a-uuid'}],[card,{...card,workflow_id:owner}]]){
  const mutated=structuredClone(catalog);mutated.body.workflows=workflows;
  const main=await run(pages[0],mutated,healthy);assert.equal(main.type,host);assert.equal(main.props.value.familyId,undefined);assert.equal(main.props.value.runContext.statusUnavailable,true);
  assert.equal((await run(pages[1],mutated,healthy)).type,'main');
 }
});
test('a mismatched optional detail cannot lend its version/actions/runs to the verified catalog family',async()=>{
 const wrong=structuredClone(healthy);wrong.body.workflow.id=owner;
 for(const invoke of pages){const result=await run(invoke,catalog,wrong);assert.equal(result.type,host);assert.equal(result.props.value.familyId,family);assert.equal(result.props.value.runContext.workflowVersionId,null);assert.equal(result.props.value.runContext.statusUnavailable,true);}
});
test('network/timeout catalog failures preserve positive detail ownership, and detail404 keeps verified catalog identity',async()=>{
 for(const name of ['TimeoutError','TypeError']){
  const original=globalThis.fetch;const normal=run;
  // A throwing catalog transport is injected inside this same real reader path.
  const response={...failedCatalog,throwName:name};const result=await normal(pages[0],response,healthy);assert.equal(result.props.value.familyId,family);assert.equal(globalThis.fetch,original);
 }
 const notFound=fixture('agent-detail-not-found');for(const invoke of pages){const result=await run(invoke,catalog,notFound);assert.equal(result.props.value.familyId,family);assert.equal(result.props.value.runContext.statusUnavailable,true);}
});
test('matching healthy detail and installation preferences keep their existing version/action paths',async()=>{
 for(const invoke of pages){const result=await run(invoke,catalog,healthy);assert.equal(result.type,host);assert.equal(result.props.value.runContext.workflowVersionId,version);assert.equal(result.props.value.runContext.statusUnavailable,false);}
 const result=await run(()=>train({params:{slug:'owned'},searchParams:{installationId:family}}),failedCatalog);
 assert.equal(result.type,host);assert.equal(result.props.value.installationId,family);assert.equal(result.props.value.familyId,undefined);assert.equal(result.props.value.runContext,undefined);assert.deepEqual(reads,[]);
});

const coachList=page('app/(dashboard)/training/page.tsx');
function findContents(element:any,type?:any):any{if(type?element?.type===type:element?.type?.name==='CoachContents')return element;for(const child of [element?.props?.children].flat(Infinity)){const found=child&&typeof child==='object'?findContents(child,type):null;if(found)return found;}return null;}
test('real Coach server page renders the owner catalog without issuing or awaiting the heavy summary',async()=>{
 for(const source of [catalog,failedCatalog]){
  const result=await run(async()=>{const shell=await coachList({});const contents=findContents(shell);assert.ok(contents);return contents.type(contents.props);},source);
  if(source===catalog){const list=findContents(result,picker);assert.ok(list);assert.equal(list.props.loadSummary,true);assert.equal(list.props.owned[0].workflow_id,family);assert.equal(list.props.summary,undefined);}
  else assert.equal(result.type,unavailable);
  assert.deepEqual(reads,['/api/v2/me/workflows'],'the only blocking data request is the existing owner catalog');
 }
});

test('a fresh server catalog read gives the count loader a fresh lifecycle even if agent identities are unchanged',async()=>{
 const invoke=async()=>{const shell=await coachList({}),contents=findContents(shell);return findContents(await contents.type(contents.props),picker);};
 const first=await run(invoke,catalog),second=await run(invoke,catalog);assert.equal(first.key,second.key);assert.equal(first.key,owner);assert.notEqual(first.props.countsReadKey,second.props.countsReadKey);assert.equal(first.props.summary,undefined);assert.equal(second.props.summary,undefined);
});
