import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectRunArtifacts, withOwnerExportProvenance, resultSurface } from '../../../lib/run-artifact-projection.ts';
import { parseReviewPacketResponse } from '../../../lib/review.ts';
import { render } from '../../../lib/test/render.ts';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Actual SQL writer + SELECT output from the existing full-schema/Desktop
// preparation producer, not an approximated successful API response.
const fixture=JSON.parse(readFileSync(new URL('../../../lib/test/fixtures/owner-export-postgres.json',import.meta.url),'utf8'));

for(const finished of [false,true])test(`owner export retains truthful provenance and exact Open path (finished=${finished})`,async()=>{
  const projected=projectRunArtifacts(fixture.artifacts);
  const artifacts=withOwnerExportProvenance(projected.verified,fixture.run.run_close_reason);
  const opened:string[]=[];
  const view=await render('verified-artifacts.tsx',{artifacts,finished},{bridge:{openPath:async(p:string)=>{opened.push(p);return{ok:true};}}});
  try{
    assert.match(view.text(),/Verified by an owner-authorized operator/);
    assert.match(view.text(),/interrupted execution remains ungraded/);
    assert.doesNotMatch(view.text(),/Checked on this Mac by Tukido/);
    assert.equal(artifacts[0].role,'other','display provenance grants no final-output authority');
    const files=view.queryByText(/View files \(/);if(files)await view.click(files);
    await view.click(view.getByText('Open'));
    assert.deepEqual(opened,[fixture.artifacts[0].validated_path]);
  }finally{view.cleanup();}
});

// Execute the same shared server component used by both real Review routes.
// The integration packet is actual producer output; only auth/framework and
// individual raw DB reads are stubbed, as in training-owner-context.test.ts.
const require=createRequire(import.meta.url);
const reviewRoom=()=>null;
let routePacket:any, fallbackReason:any, fallbackError:any;
const routeReads:Array<{table:string;filters:Array<[string,unknown]>}>=[];
const built=buildSync({entryPoints:[resolve(import.meta.dirname,'review-room-page.tsx')],
  absWorkingDir:resolve(import.meta.dirname,'../../..'),bundle:true,write:false,
  platform:'node',format:'cjs',jsx:'automatic',packages:'external',
  external:['@/lib/supabase/server','@/lib/review','@/lib/agents-home','@/lib/workflow-catalog','./review-room',
    './stage-competence-proof','./stage-manager-proof','./taste-fit-review']});
const serverModule={exports:{}};
const load=(name:string)=>{
  if(name==='next/navigation')return{redirect:(href:string)=>{throw Error('redirect:'+href);},notFound:()=>{throw Error('not-found');}};
  if(name==='next/link')return{__esModule:true,default:()=>null};
  if(name==='@/lib/review')return{getReviewPacket:async()=>routePacket,unavailableSources:()=>[]};
  if(name==='@/lib/agents-home')return{getMyAgents:async()=>({status:'ready',active:[],needsActivation:[],drafts:[]})};
  if(name==='@/lib/workflow-catalog')return{readMyWorkflows:async()=>({status:'ready',workflows:[{slug:fixture.reviewPacket.run.slug,source:'generated'}]})};
  if(name==='@/lib/supabase/server')return{createClient:()=>({
    auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-owner'},access_token:'synthetic-session'}}})},
    from:(table:string)=>{const call={table,filters:[] as Array<[string,unknown]>};routeReads.push(call);
      const query:any={select:()=>query,eq:(key:string,value:unknown)=>{call.filters.push([key,value]);return query;},
        abortSignal:(signal:AbortSignal)=>{assert.ok(signal);return query;},order:()=>query,limit:()=>query,
        maybeSingle:async()=>table==='skill_runs'?{data:fallbackReason===undefined?null:{run_close_reason:fallbackReason},error:fallbackError}:{data:null,error:null}};
      return query;}
  })};
  if(name==='./review-room')return{__esModule:true,default:reviewRoom};
  if(['./stage-competence-proof','./stage-manager-proof','./taste-fit-review'].includes(name))return{__esModule:true,default:()=>null};
  return require(name);
};
new Function('require','module','exports',built.outputFiles[0].text)(load,serverModule,serverModule.exports);
const sharedPage=(serverModule.exports as{default:(props:any)=>Promise<any>}).default;
function containsType(node:any,type:any):boolean{return node?.type===type||[node?.props?.children].flat(Infinity).some(child=>child&&typeof child==='object'&&containsType(child,type));}

test('both direct Review routes redirect actual owner exports before mounting writable review',async()=>{
  routePacket=parseReviewPacketResponse(fixture.reviewPacket,fixture.runRecord.id);
  assert.equal(routePacket.run.closeReason,'owner_verified_export');
  for(const props of [{legacy:true},{trainingSlug:routePacket.run.slug}]){
    routeReads.length=0;
    await assert.rejects(sharedPage({params:{runId:fixture.runRecord.id},...props}),new RegExp('redirect:/runs/'+fixture.runRecord.id));
    assert.deepEqual(routeReads,[],'canonical packet provenance requires no fallback DB read');
  }
});

test('older packets use exact owner-scoped provenance, and failures never mount ReviewRoom',async()=>{
  routePacket=structuredClone(parseReviewPacketResponse(fixture.reviewPacket,fixture.runRecord.id));delete routePacket.run.closeReason;
  for(const props of [{legacy:true},{trainingSlug:routePacket.run.slug}]){
    fallbackReason='owner_verified_export';fallbackError=null;routeReads.length=0;
    await assert.rejects(sharedPage({params:{runId:fixture.runRecord.id},...props}),/redirect:\/runs\//);
    assert.deepEqual(routeReads,[{table:'skill_runs',filters:[['id',fixture.runRecord.id],['user_id','synthetic-owner']]}]);
    fallbackReason=undefined;fallbackError={code:'synthetic-outage'};
    const result=await sharedPage({params:{runId:fixture.runRecord.id},...props});
    assert.equal(result.type,'main');assert.equal(containsType(result,reviewRoom),false);
  }
});

test('explicit legacy-native provenance retains ordinary Review rendering and rejects malformed metadata',async()=>{
  routePacket=structuredClone(parseReviewPacketResponse(fixture.reviewPacket,fixture.runRecord.id));
  // Mutation is a negative/compatibility input, not a successful owner integration fixture.
  routePacket.run.closeReason=null;routeReads.length=0;
  const result=await sharedPage({params:{runId:fixture.runRecord.id}});
  assert.equal(containsType(result,reviewRoom),true);assert.equal(routeReads.some(x=>x.table==='skill_runs'),false);
  const malformed=structuredClone(fixture.reviewPacket);malformed.run.closeReason={unexpected:true};
  assert.equal(parseReviewPacketResponse(malformed,fixture.runRecord.id),null);
});

test('ordinary artifacts retain the native verification wording',async()=>{
  const artifacts=withOwnerExportProvenance(projectRunArtifacts(fixture.artifacts).verified,null);
  const view=await render('verified-artifacts.tsx',{artifacts});
  try{
    assert.match(view.text(),/Checked on this Mac by Tukido/);
    assert.doesNotMatch(view.text(),/owner-authorized operator/);
    assert.equal(artifacts[0].provenance,undefined);
  }finally{view.cleanup();}
});


test('an unavailable provenance read never falls back to native verification copy',async()=>{
  const artifacts=withOwnerExportProvenance(projectRunArtifacts(fixture.artifacts).verified,null,false);
  const view=await render('verified-artifacts.tsx',{artifacts});
  try{
    assert.match(view.text(),/File provenance could not be checked/);
    assert.doesNotMatch(view.text(),/Checked on this Mac|Verified by an owner/);
  }finally{view.cleanup();}
});


test('a real live review packet for owner salvage renders only the private export branch',async()=>{
  const packet=parseReviewPacketResponse(fixture.reviewPacket,fixture.runRecord.id);
  assert.ok(packet?.live,'real producer packet is live despite the absence of an accepted Review session');
  assert.equal(packet.session,null);
  const surface=resultSurface({runId:fixture.runRecord.id,completed:fixture.runRecord.run_state==='completed',
    closeReason:fixture.runRecord.run_close_reason,provenanceAvailable:true,reviewLive:packet.live,reviewRunId:packet.run?.id});
  assert.equal(surface,'owner_export');
  const artifacts=withOwnerExportProvenance(projectRunArtifacts(fixture.artifacts).verified,fixture.runRecord.run_close_reason);
  const opened:string[]=[];
  const view=await render('verified-artifacts.tsx',{artifacts,runId:fixture.runRecord.id,children:fixture.runRecord.output_markdown},
    {exportName:'OwnerRecoveredExport',bridge:{openPath:async(p:string)=>{opened.push(p);return{ok:true};}}});
  try{
    assert.match(view.text(),/Recovery record/);
    assert.doesNotMatch(view.text(),/Ready for your review|Ask for changes|Request changes|Accept result|Agent’s notes/);
    assert.equal(Array.from(view.document.querySelectorAll('button,a')).some(node=>/share|accept|annotate|change/i.test(node.textContent||'')),false);
    const files=view.queryByText(/View files \(/);if(files)await view.click(files);
    await view.click(view.getByText('Open'));assert.deepEqual(opened,[fixture.artifacts[0].validated_path]);
  }finally{view.cleanup();}
  assert.equal(resultSurface({runId:fixture.runRecord.id,completed:true,closeReason:null,provenanceAvailable:false,
    reviewLive:packet.live,reviewRunId:packet.run?.id}),'files','an unavailable reason cannot activate generic Review');
});
