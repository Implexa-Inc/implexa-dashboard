import test from 'node:test';
import assert from 'node:assert/strict';
import { PACKET_SOURCE_KEYS, parseReviewPacketResponse } from './review.ts';
const sha='a'.repeat(64);
const packet={ok:true,run:{id:'run',slug:'agent',runState:'succeeded',status:'completed',reviewStatus:null,holdKind:null,startedAt:null},
  lineage:{rootRunId:'run',versions:[{runId:'run',label:'Original',runState:'succeeded',startedAt:null}]},
  artifacts:[{id:'video',runId:'run',relativePath:'out/video.mp4',role:'final_output',status:'validated',sha256:sha}],
  historicalCandidates:[],judgment:null,verification:{receipts:[]},production:null,session:null,reviewArtifacts:[],issues:[],
  sources:{...Object.fromEntries(PACKET_SOURCE_KEYS.map(k=>[k,'ready'])),historical_candidates:'ready',carry_membership:'ready'}};
const assessment={contractVersion:'taste-fit-assessment.v1',status:'assessed',reason:null,fit:'partial',
  referenceSetDigest:'b'.repeat(64),artifactSha256:sha,explanation:'Visible relationship fits partly.',
  gaps:[{timestampMs:1000,observation:'Hierarchy is flat.',suggestion:'Give the main takeaway emphasis.'}]};
test('taste-fit packet is additive, strict and bound to the validated selected video',()=>{
 assert.ok(parseReviewPacketResponse(packet,'run'));
 const withFit={...packet,tasteFit:{status:'ready',preparationId:'preparation',assessment}};
 assert.equal(parseReviewPacketResponse(withFit,'run')?.tasteFit?.assessment?.fit,'partial');
 assert.equal(parseReviewPacketResponse({...packet,tasteFit:{status:'unavailable',preparationId:null,assessment:null}},'run')?.tasteFit?.status,'unavailable');
 for(const mutate of [(p:any)=>p.tasteFit.assessment.artifactSha256='c'.repeat(64),(p:any)=>p.tasteFit.assessment.fit='passed',
  p=>p.tasteFit.assessment.privateExamples=[],(p:any)=>p.tasteFit.assessment.gaps[0].timestampMs=-1,
  p=>p.artifacts[0].status='declared']){
  const bad=structuredClone(withFit);mutate(bad);assert.equal(parseReviewPacketResponse(bad,'run'),null);
 }
 const unavailable={...assessment,status:'unavailable',reason:'reference_authority_unavailable',fit:null,gaps:[]};
 assert.ok(parseReviewPacketResponse({...withFit,tasteFit:{...withFit.tasteFit,assessment:unavailable}},'run'));
 const selection={reason:'pairwise_preferred_revision',comparisonDigest:'c'.repeat(64),uncalibrated:true};
 assert.equal(parseReviewPacketResponse({...withFit,tasteFit:{...withFit.tasteFit,selection}},'run')?.tasteFit?.selection?.reason,selection.reason);
 for(const bad of [{...selection,comparisonDigest:'wrong'},{...selection,uncalibrated:false},{...selection,reason:'passed'},{...selection,privateExamples:[]}])
   assert.equal(parseReviewPacketResponse({...withFit,tasteFit:{...withFit.tasteFit,selection:bad}},'run'),null);
});

test('actual owner card renders weak and unavailable opinions separately from technical acceptance',async()=>{
 const {readFileSync}=await import('node:fs'),ts=await import('typescript'),React=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server'),{createRequire}=await import('node:module');
 const require=createRequire(import.meta.url),mod={exports:{}};
 const source=readFileSync('app/(dashboard)/_components/taste-fit-review.tsx','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports',js)(require,mod,mod.exports);
 const Card=(mod.exports as {default:React.ComponentType<any>}).default;
 const html=renderToStaticMarkup(React.createElement(Card,{review:{status:'ready',preparationId:'p',assessment:{...assessment,fit:'weak'}}}));
 assert.match(html,/Taste fit: weak/);assert.match(html,/Separate from technical checks/);assert.match(html,/Hierarchy is flat/);
 assert.match(html,/does not establish that training caused/);
 const selected=renderToStaticMarkup(React.createElement(Card,{review:{status:'ready',preparationId:'p',assessment,
   selection:{reason:'pairwise_preferred_revision',comparisonDigest:'c'.repeat(64),uncalibrated:true}}}));
 assert.match(selected,/revised video was preferred in both comparison orders within the same grade band/);
 assert.match(selected,/not a higher letter grade/);
 const missing=renderToStaticMarkup(React.createElement(Card,{review:{status:'unavailable',preparationId:null,assessment:null}}));
 assert.match(missing,/Taste fit: unavailable/);assert.equal(missing.includes('passed'),false);
});

test('final quality card shows an integer or not assessed while historical bands remain unchanged',async()=>{
 const {readFileSync}=await import('node:fs'),ts=await import('typescript'),React=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server'),{createRequire}=await import('node:module');
 const require=createRequire(import.meta.url),mod={exports:{}};
 const source=readFileSync('app/(dashboard)/_components/run-judgment-card.tsx','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 const localRequire=(id:string)=>id==='@/lib/judge-repair-state'?{judgeRepairState:()=>({phase:'none'})}
  :id==='next/link'?{default:()=>null}:id==='./judge-feedback-controls'?{default:()=>null}
  :id==='./manager-repair-checkpoint-retry'?{ManagerRepairCheckpointRetry:()=>null}:require(id);
 new Function('require','module','exports',js)(localRequire,mod,mod.exports);
 const Card=(mod.exports as {RunJudgmentCard:React.ComponentType<any>}).RunJudgmentCard;
 const grade={contractVersion:'creative-grade.v2',overallScore:82,overallBand:'B',summary:'Clear visual explanation.',
  relativePath:'out/video.mp4',artifactSha256:sha,rubricDigest:sha,calibration:'uncalibrated',
  dimensions:[{id:'visual_explanation',score:82,band:'B',explanation:'A useful visual.',gaps:[]}],
  coverage:{durationMs:1000,timestampsMs:[0,990],limitations:'Still images only.',continuousPlaybackVerified:false}};
 const render=(g:any)=>renderToStaticMarkup(React.createElement(Card,{judgment:{verdict:'pass',summary:'Delivered.',creative_grade:g}}));
 const html=render(grade);assert.match(html,/Quality 82\/100/);assert.match(html,/visual explanation.*82\/100/);
 assert.match(html,/One model review, not calibrated/);assert.match(html,/Technical delivery reviewed/);
 assert.doesNotMatch(html,/Creative grade: B|— B/);
 const missing=render({...grade,overallScore:null,overallBand:'unassessed',dimensions:[{...grade.dimensions[0],score:null,band:'unassessed'}]});
 assert.match(missing,/Quality not assessed/);assert.doesNotMatch(missing,/Quality 0\/100/);
 assert.match(render({...grade,overallScore:0}),/Quality 0\/100/,'zero is a real score, not missing');
 assert.match(render({...grade,contractVersion:'creative-grade.v1'}),/Creative grade: B/);
});
