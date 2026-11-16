import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extractFeedbackTeaching,extractionProgressFor,checkpointExtraction,retryFeedbackDraft,savedDirectFeedback,savedFeedbackMatches,type FeedbackExtractionProgress,type FeedbackDraftRequest} from './training-feedback-extraction.ts';
const id='11111111-1111-4111-8111-111111111111',record='22222222-2222-4222-8222-222222222222';
const sha='a'.repeat(64),source={sourceId:id,token:'native-token',metadata:{sha256:sha,durationMs:1000}};
const image='data:image/png;base64,'+Buffer.alloc(40,1).toString('base64');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const fields={chosen:'In this example, the route is a wall of text.',why:'Prefer a spatial explanation when geography matters.',process:'Applies when location explains the comparison.',desiredBehavior:'Explain the relationship visually, with a map when useful.'};
function setup({nullScope=false,linkFails=false,wrongBinding=false,insufficient=false,rawAnnotation='Show the location on a map, rather than listing names.',timeMs=1000}={}){
 const calls:any[]=[],progress:FeedbackExtractionProgress={key:id};let links=0;
 const run=(recovered=progress,checkpoint=()=>{},newDraftRequest?:FeedbackDraftRequest)=>extractFeedbackTeaching({source,timeMs,rawAnnotation,versionId:id,retentionUntil:'2027-11-11T00:00:00.000Z',progress:recovered,checkpoint,newDraftRequest,
  check:async()=>{calls.push(['check']);},call:async(op,args:any)=>{calls.push([op,args]);if(op==='preview')return {ok:true,image};if(op==='annotate')return {ok:true,recordId:record,recordDigest:sha};throw Error('Unexpected writer');},
  send:async(op,body:any,key)=>{calls.push([op,body,key]);
   if(op==='annotation'&&body.action==='save'){const {action,expectedActiveVersionId,...annotation}=body;return {ok:true,contractVersion:'training-demo-annotation.v1',annotationId:id,annotationDigest:sha,annotation:{...annotation,contractVersion:'training-demo-annotation.v1',targetVersionId:expectedActiveVersionId}};}
   if(op==='annotation'){if(linkFails&&++links===1)throw Error('lost link response');return {ok:true,contractVersion:'training-demo-link.v1',annotationId:id,annotationDigest:sha,recordId:record,recordDigest:sha,linkReceiptId:id};}
   const {mode,includeScope,image,consent,...binding}=body;
   return {ok:true,requestId:id,contractVersion:'training-teaching-suggestion.v6',model:'claude-haiku-5-5',status:insufficient?'insufficient':'suggested',fields:insufficient?null:fields,reason:insufficient?'Please explain what you prefer.':'',scopeSuggestion:nullScope||insufficient?null:{property:'narrative_visual_alignment',relation:'rejected'},binding:{...binding,sourceId:wrongBinding?record:binding.sourceId,feedbackSha256:hash(rawAnnotation)},sources:{chosen:'observed_frame',why:'trainer_preference',process:'transferable_guidance',desiredBehavior:'transferable_guidance'}};
  }});
 return {run,calls,progress};
}
test('Done teaching saves raw note before model, derives existing scope, links one native draft, and never accepts',async()=>{
 const {run,calls,progress}=setup();const value=await run();assert.equal(value.status,'drafted');assert.equal(progress.linked,true);
 assert.equal(calls.find(c=>c[0]==='preview')[1].timeMs,999);
 assert.ok(calls.findIndex(c=>c[0]==='annotation'&&c[1].action==='save')<calls.findIndex(c=>c[0]==='suggestion'));
 const saved=calls.find(c=>c[0]==='annotate')[1];assert.deepEqual(saved.decision,fields);assert.equal(saved.content.relation,'rejected');assert.deepEqual(saved.content.applicability.stages,['planning','build','preview','qa','revision']);
 assert.equal(calls.some(c=>['accept','activate','revise_workflow'].includes(c[0])),false);
 assert.equal(calls.filter(c=>c[0]==='suggestion').length,1);
});
test('uncertain link resumes exact annotation, suggestion and draft without duplicating model or writer',async()=>{
 const {run,calls,progress}=setup({linkFails:true});await assert.rejects(run(),/lost link/);assert.ok(progress.record);assert.equal(progress.linked,undefined);
 await run();assert.equal(progress.linked,true);assert.equal(calls.filter(c=>c[0]==='annotate').length,1);assert.equal(calls.filter(c=>c[0]==='suggestion').length,1);assert.equal(calls.filter(c=>c[0]==='annotation'&&c[1].action==='save').length,1);
});
test('ambiguous scope and insufficient feedback stay held, without a fabricated default category or native draft',async()=>{
 for(const mode of [{nullScope:true},{insufficient:true}]){const {run,calls}=setup(mode);assert.equal((await run()).status,'held');assert.equal(calls.some(c=>c[0]==='annotate'),false);}
});
test('mismatched reply cannot create a draft; original raw annotation remains saved',async()=>{
 const {run,calls,progress}=setup({wrongBinding:true});await assert.rejects(run(),/did not match/);assert.ok(progress.annotation);assert.equal(calls.some(c=>c[0]==='annotate'),false);
});

test('reload resumes the persisted suggestion and native identity without another model call',async()=>{
 const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>{values.set(k,v);}};
 const fingerprint='b'.repeat(64),scope=`owner:session:version`;
 let progress=extractionProgressFor(storage,scope,fingerprint);
 assert.match(progress.key,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 const {run,calls}=setup({linkFails:true});
 await assert.rejects(run(progress,()=>checkpointExtraction(storage,scope,progress)),/lost link/);
 progress=extractionProgressFor(storage,scope,fingerprint);
 await run(progress,()=>checkpointExtraction(storage,scope,progress));
 assert.equal(calls.filter(c=>c[0]==='suggestion').length,1);
 assert.equal(calls.filter(c=>c[0]==='annotate').length,1);
 assert.equal(progress.linked,true);
});
test('an interrupted provider call cannot silently re-run after losing the page map',async()=>{
 const {run,calls,progress}=setup();progress.suggestionStarted=true;
 await assert.rejects(run(),/interrupted while drafting/);
 assert.equal(calls.some(c=>c[0]==='suggestion'||c[0]==='annotate'),false);
});

test('a pre-provider checkpoint failure is retryable because no model was invoked',async()=>{
 const {run,calls,progress}=setup();let checkpoints=0;
 await assert.rejects(run(progress,()=>{if(++checkpoints===2)throw Error('local storage quota');}),/local storage quota/);
 assert.equal(calls.filter(call=>call[0]==='suggestion').length,0);
 assert.notEqual(progress.suggestionStarted,true,'only an actual provider attempt may become uncertain');
 await run(progress);assert.equal(calls.filter(call=>call[0]==='suggestion').length,1);assert.equal(progress.linked,true);
});

test('a confirmed request for another draft preserves saved annotation and native identity',async()=>{
 const {run,calls,progress}=setup({wrongBinding:true});progress.fingerprint='b'.repeat(64);
 await assert.rejects(run(),/did not match/);
 const before=structuredClone(progress),request=retryFeedbackDraft(progress,progress.fingerprint!);
 assert.deepEqual(progress,before,'confirmation itself does not mutate the journal');assert.equal(request.annotationDigest,progress.annotation!.annotationDigest);
 const resumed=setup();await resumed.run(progress,()=>{},request);
 assert.equal(resumed.calls.filter(c=>c[0]==='annotation'&&c[1].action==='save').length,0);
 assert.equal(resumed.calls.filter(c=>c[0]==='suggestion').length,1);
 assert.equal(resumed.calls.filter(c=>c[0]==='annotate').length,1);
 assert.equal(calls.filter(c=>c[0]==='suggestion').length,1);assert.equal(progress.linked,true);
 assert.equal(progress.draftingRetries,1);assert.equal(progress.priorDraftOutcome,'unconfirmed');assert.equal(progress.key,before.key);
});
test('failed retry checkpoint leaves the interrupted journal and provider untouched',async()=>{
 const {run,calls,progress}=setup({wrongBinding:true});progress.fingerprint='b'.repeat(64);
 await assert.rejects(run(),/did not match/);const request=retryFeedbackDraft(progress,progress.fingerprint!);
 await assert.rejects(run(progress,()=>{throw Error('quota');},request),/quota/);
 assert.equal(progress.suggestionStarted,true);assert.equal(progress.draftingRetries,undefined);
 await assert.rejects(run(),/interrupted while drafting/);assert.equal(calls.filter(c=>c[0]==='suggestion').length,1);
});
test('new-draft recovery refuses different notes and completed, missing or malformed recovery state',()=>{
 const fingerprint='b'.repeat(64),base:FeedbackExtractionProgress={key:id,fingerprint,suggestionStarted:true,annotation:{} as any};
 for(const patch of [{fingerprint:'c'.repeat(64)},{annotation:undefined},{suggestionStarted:false},{suggestion:{} as any},{record:{recordId:record,recordDigest:sha}},{linked:true},{draftingRetries:-1},{draftingRetries:1.5}]){
  assert.throws(()=>retryFeedbackDraft({...base,...patch},fingerprint),/not waiting/);
 }
});
test('a stale single-use request cannot send after the annotation identity changes',async()=>{
 const {run,calls,progress}=setup({wrongBinding:true});progress.fingerprint='b'.repeat(64);
 await assert.rejects(run(),/did not match/);const request=retryFeedbackDraft(progress,progress.fingerprint!);
 progress.annotation={...progress.annotation!,annotationDigest:'c'.repeat(64)};
 await assert.rejects(run(progress,()=>{},request),/interrupted while drafting/);
 assert.equal(calls.filter(c=>c[0]==='suggestion').length,1);assert.equal(progress.suggestionStarted,true);
});

test('new-draft confirmation does not survive a changed frame or revoked scope',async()=>{
 for(const mode of ['frame','scope']){
  const {run,calls,progress}=setup({wrongBinding:true});progress.fingerprint='b'.repeat(64);
  await assert.rejects(run(),/did not match/);const request=retryFeedbackDraft(progress,progress.fingerprint!);
  await assert.rejects(extractFeedbackTeaching({source,timeMs:999,rawAnnotation:'Show the location on a map, rather than listing names.',versionId:id,retentionUntil:'2027-11-11',progress,newDraftRequest:request,
   check:async()=>{if(mode==='scope')throw Error('scope changed');},call:async()=>({ok:true,image:'data:image/png;base64,'+Buffer.alloc(40,2).toString('base64')}),send:async()=>assert.fail('changed evidence must not send')}),mode==='scope'?/scope changed/:/no longer matches/);
  assert.equal(progress.suggestionStarted,true);assert.equal(progress.draftingRetries,undefined);assert.equal(calls.filter(c=>c[0]==='suggestion').length,1);
 }
});

test('reload discovery uses the real producer journal and exact upload scope without writes',async()=>{
 const ownerId=id,sessionId=id,versionId=id,timeMs=0;
 const rawAnnotation=JSON.stringify({role:'trainer_commentary',sourceKind:'upload',sourceId:id,timeMs,spatial:{geometry:{kind:'point',x:0.2,y:0.3,width:null,height:null},sourceFrame:{visualWidth:1,visualHeight:1}},feedback:'Explain the actual relationship.'});
 const fingerprint=hash(JSON.stringify({id:sessionId,version:versionId,sourceId:id,sourceSha256:sha,rawAnnotation,frameTime:timeMs}));
 const values=new Map<string,string>(),storage={get length(){return values.size;},key:(i:number)=>[...values.keys()][i]||null,getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>{values.set(k,v);}};
 const progress=extractionProgressFor(storage,`${ownerId}:${sessionId}:${versionId}`,fingerprint),{run}=setup({wrongBinding:true,rawAnnotation,timeMs});
 await assert.rejects(run(progress,()=>checkpointExtraction(storage,`${ownerId}:${sessionId}:${versionId}`,progress)),/did not match/);
 const snapshot=[...values];const {notes,unreadableCount}=await savedDirectFeedback(storage,{ownerId,sessionId,versionId,sources:[source]});assert.equal(unreadableCount,0);
 assert.equal(notes.length,1);assert.equal(notes[0].annotation.rawAnnotation,rawAnnotation);assert.equal(notes[0].feedback,'Explain the actual relationship.');assert.equal(notes[0].fingerprint,fingerprint);assert.deepEqual(notes[0].spatial,JSON.parse(rawAnnotation).spatial);
 assert.equal(savedFeedbackMatches(notes[0],source,0,versionId),true);
 assert.equal(savedFeedbackMatches(notes[0],null,0,versionId),false);
 assert.equal(savedFeedbackMatches(notes[0],{...source,sourceId:record},0,versionId),false);
 assert.equal(savedFeedbackMatches(notes[0],{...source,metadata:{...source.metadata,sha256:'c'.repeat(64)}},0,versionId),false);
 assert.equal(savedFeedbackMatches(notes[0],source,1,versionId),false);
 assert.equal(savedFeedbackMatches(notes[0],source,0,record),false);
 assert.deepEqual([...values],snapshot,'discovery cannot reset or rewrite the journal');
 for(const patch of [{ownerId:record},{sessionId:record},{versionId:record},{sources:[{...source,sourceId:record}]},{sources:[{...source,metadata:{...source.metadata,sha256:'c'.repeat(64)}}]}]){
  assert.deepEqual((await savedDirectFeedback(storage,{ownerId,sessionId,versionId,sources:[source],...patch})).notes,[]);
 }
 progress.linked=true;checkpointExtraction(storage,`${ownerId}:${sessionId}:${versionId}`,progress);
 assert.deepEqual((await savedDirectFeedback(storage,{ownerId,sessionId,versionId,sources:[source]})).notes,[],'completed drafts stay in normal review');
 const originalKey=[...values.keys()][0];values.set(originalKey,'not-json');
 const broken=await savedDirectFeedback(storage,{ownerId,sessionId,versionId,sources:[source]});assert.deepEqual(broken.notes,[]);assert.equal(broken.unreadableCount,1);assert.equal(values.get(originalKey),'not-json');
});

test('ordinary annotation opts into one combined analysis; a procedure-only result survives insufficient taste and replay',async()=>{
 const progress:FeedbackExtractionProgress={key:id};const calls:any[]=[];
 const run=()=>extractFeedbackTeaching({source,timeMs:0,rawAnnotation:'Keep the media prompt self-contained in the agent.',versionId:id,retentionUntil:'2027-11-11T00:00:00.000Z',progress,analyzeSetup:true,check:async()=>{},
  call:async(op)=>{calls.push(op);if(op==='preview')return {ok:true,image};throw Error('No taste draft should be created');},
  send:async(op,body:any)=>{calls.push({op,body});if(op==='annotation'){const {action,expectedActiveVersionId,...annotation}=body;return {ok:true,contractVersion:'training-demo-annotation.v1',annotationId:id,annotationDigest:sha,annotation:{...annotation,contractVersion:'training-demo-annotation.v1',targetVersionId:expectedActiveVersionId}};}
   const {mode,includeScope,image,consent,analysis,...binding}=body;
   assert.deepEqual(analysis,{contractVersion:'training-annotation-analysis-request.v1',consentVersion:'training-annotation-taste-and-setup.v1',retryOf:null});
   return {ok:true,requestId:id,contractVersion:'training-teaching-suggestion.v7',model:'claude-haiku-5-5',status:'insufficient',fields:null,reason:'A procedure change, rather than a visual preference.',scopeSuggestion:null,binding:{...binding,feedbackSha256:hash('Keep the media prompt self-contained in the agent.')},
    sources:{chosen:'observed_frame',why:'trainer_preference',process:'transferable_guidance',desiredBehavior:'transferable_guidance'},
    operatingGap:{status:'suggested',kind:'procedure',stepOrder:4,capability:null,evidenceExcerpt:'Keep the media prompt self-contained',privateRationale:'The step needs prompt authoring.',genericDelta:'Author and review media prompts within the Build step.'},
    analysisReceipt:{requestEventId:id,requestDigest:sha,resultEventId:record,resultDigest:sha,attemptOrdinal:1,setupDigest:sha,setupState:'complete',target:{stepOrder:4,stepDigest:sha,methods:[]},usage:{status:'observed',inputTokens:500,outputTokens:100}}};}});
 const result=await run();assert.equal(result.status,'held');assert.equal(result.suggestion.contractVersion,'training-teaching-suggestion.v7');
 assert.ok('operatingGap' in result.suggestion&&result.suggestion.operatingGap?.genericDelta);await run();
 assert.equal(calls.filter(c=>c.op==='suggestion').length,1);assert.equal(calls.includes('annotate'),false);assert.equal(progress.linked,undefined);
});

test('an uncertain result commit never becomes permission to infer again; only a saved failure supplies retryOf',async()=>{
 const rawAnnotation='Improve the internal review procedure.',progress:FeedbackExtractionProgress={key:id,fingerprint:'b'.repeat(64),suggestionStarted:true,analysisContract:'training-teaching-suggestion.v7',
  annotation:{annotationId:id,annotationDigest:sha,rawAnnotation,sourceId:id,sourceSha256:sha,timeMs:0,frameSha256:createHash('sha256').update(Buffer.from(image.slice(22),'base64')).digest('hex'),expectedActiveVersionId:id}};
 let outcome='annotation_analysis_commit_unconfirmed';const requests:any[]=[];
 const run=(newDraftRequest?:FeedbackDraftRequest)=>extractFeedbackTeaching({source,timeMs:0,rawAnnotation,versionId:id,retentionUntil:'2027-11-11T00:00:00.000Z',progress,analyzeSetup:true,newDraftRequest,check:async()=>{},call:async()=>({ok:true,image}),
  send:async(op,body:any)=>{assert.equal(op,'suggestion');requests.push(body.analysis);return {ok:false,unavailable:true,reason:outcome,analysisRequest:{requestEventId:record,requestDigest:sha,attemptOrdinal:1}};}});
 await assert.rejects(run());assert.equal(progress.analysisOutcome,'pending');
 await assert.rejects(run(retryFeedbackDraft(progress,progress.fingerprint!)));assert.equal(requests[1].retryOf,null);
 outcome='teaching_suggestion_provider_timeout';await assert.rejects(run());assert.equal(progress.analysisOutcome,'failed');
 await assert.rejects(run(retryFeedbackDraft(progress,progress.fingerprint!)));assert.deepEqual(requests[3].retryOf,{requestEventId:record,requestDigest:sha});
});

test('an old unconfirmed v6 journal requires the existing explicit retry acknowledgment before v7',async()=>{
 const rawAnnotation='Keep explanatory visuals readable.',progress:FeedbackExtractionProgress={key:id,fingerprint:'b'.repeat(64),suggestionStarted:true,
  annotation:{annotationId:id,annotationDigest:sha,rawAnnotation,sourceId:id,sourceSha256:sha,timeMs:0,frameSha256:createHash('sha256').update(Buffer.from(image.slice(22),'base64')).digest('hex'),expectedActiveVersionId:id}};
 const sent:any[]=[];
 const run=(newDraftRequest?:FeedbackDraftRequest)=>extractFeedbackTeaching({source,timeMs:0,rawAnnotation,versionId:id,retentionUntil:'2027-11-11T00:00:00.000Z',progress,analyzeSetup:true,newDraftRequest,check:async()=>{},call:async()=>({ok:true,image}),send:async(op,body:any)=>{sent.push({op,body});return {ok:false,reason:'annotation_analysis_pending',analysisRequest:{requestEventId:record,requestDigest:sha,attemptOrdinal:1}};}});
 await assert.rejects(run(),/interrupted while drafting/);assert.equal(sent.length,0);assert.equal(progress.analysisContract,undefined);
 await assert.rejects(run(retryFeedbackDraft(progress,progress.fingerprint!)));assert.equal(sent.length,1);assert.equal(progress.analysisContract,'training-teaching-suggestion.v7');assert.equal(sent[0].body.analysis.retryOf,null);
});
