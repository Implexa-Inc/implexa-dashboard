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
 const missing=renderToStaticMarkup(React.createElement(Card,{review:{status:'unavailable',preparationId:null,assessment:null}}));
 assert.match(missing,/Taste fit: unavailable/);assert.equal(missing.includes('passed'),false);
});
