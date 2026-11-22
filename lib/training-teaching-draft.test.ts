import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import { savedRecordingAgentProposal, teachingSuggestion, teachingDigest, teachingFrame, teachingFailure, recordingAgentSuggestion, annotationGapPage, annotationAnalysis, scopedTeachingSuggestion, recordingLocatorCapability } from './training-teaching-draft.ts';
const binding = { sourceId:'source',sourceSha256:'a'.repeat(64),timeMs:0,frameSha256:'b'.repeat(64),questionReceiptId:'question',
  questionReceiptDigest:'c'.repeat(64),expectedActiveVersionId:'version',feedbackSha256:'d'.repeat(64) };
const value = { requestId:'11111111-1111-4111-8111-111111111111',ok:true,contractVersion:'training-teaching-suggestion.v2',model:'claude-haiku-5-5',binding,
  status:'suggested',fields:{chosen:'Observed visual',why:'Trainer preference',process:'Adapt the visual principle',desiredBehavior:'A transferable explanation'},reason:'',
  sources:{chosen:'observed_frame',why:'trainer_preference',process:'transferable_guidance',desiredBehavior:'transferable_guidance'} };
test('recording capability suggestion stays separate from teaching and requires exact source/version evidence',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const expected={sourceId:id,sourceSha256:'a'.repeat(64),targetVersionId:id,excerptId:id,excerptDigest:'b'.repeat(64),
  frames:[0,500,999].map(timeMs=>({timeMs,frameSha256:'c'.repeat(64)}))};
 const proposal={ok:true,contractVersion:'training-recording-agent-suggestion.v1',requestId:id,model:'claude-haiku-5-5',status:'suggested',
  capability:'web_reference_research',frameIndex:0,reason:'',limitations:['Image generation unverified.'],suggestionId:id,suggestionDigest:'d'.repeat(64),
  proposedChange:'Generic capability instruction',application:'not_applied',methodSelection:'pending_existing_binder',binding:expected};
 assert.equal(recordingAgentSuggestion(proposal,expected),true);
 const background={...proposal,capability:'presenter_background_removal'};
 assert.equal(recordingAgentSuggestion(background,expected,'presenter_background_removal'),true);
 const imageVideo={...proposal,capability:'higgsfield_image_to_video'};
 assert.equal(recordingAgentSuggestion(imageVideo,expected,'higgsfield_image_to_video'),true);
 assert.equal(recordingAgentSuggestion({...imageVideo,methodSelection:'agent_change_required'},expected,'higgsfield_image_to_video'),true);
 assert.equal(recordingAgentSuggestion({...background,methodSelection:'agent_change_required'},expected,'presenter_background_removal'),false,'new-step handoff cannot replace an existing VEED method');
 assert.equal(recordingAgentSuggestion(imageVideo,expected,'presenter_background_removal'),false,'Higgsfield does not replace the selected VEED method');
 assert.equal(recordingAgentSuggestion(background,expected,'higgsfield_image_to_video'),false,'VEED is not evidence for an image-to-video demonstration');
 assert.equal(recordingAgentSuggestion(background,expected),false,'another capability cannot replace the selected research proposal');
 assert.equal(recordingAgentSuggestion(proposal,expected,'presenter_background_removal'),false,'research cannot masquerade as the selected VEED proposal');
 for(const patch of [{capability:'higgsfield'},{application:'applied'},{methodSelection:'ranked_top'},{fields:value.fields},
  {model:'other'},{frameIndex:3},{binding:{...expected,targetVersionId:'other'}},{limitations:['x'.repeat(201)]}])
  assert.equal(recordingAgentSuggestion({...proposal,...patch},expected),false);
});
test('every suggestion identity and field limit is checked without inventing evidence or clipping text',async()=>{
  assert.equal(teachingSuggestion(value,binding),true);
  for(const key of Object.keys(binding)) assert.equal(teachingSuggestion({...value,binding:{...binding,[key]:'different'}},binding),false,key);
  for(const patch of [{model:'other'}, {model:'claude-haiku-4-5-20251001'}, {model:'claude-haiku-5-5-extra'}, {authority:true}, {fields:{...value.fields,chosen:'x'.repeat(401)}},
    {sources:{...value.sources,process:'observed_frame'}}, {status:'insufficient',fields:value.fields,reason:'unclear'}]) assert.equal(teachingSuggestion({...value,...patch},binding),false);
  assert.equal(teachingSuggestion({...value,status:'insufficient',fields:null,reason:'The feedback needs clarification.'},binding),true);
  assert.equal(await teachingDigest(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.throws(()=>teachingFrame('https://host/private-frame.png'));
  assert.throws(()=>teachingFrame('data:image/png;base64,'+'A'.repeat(2800000)));
});


test('only allowlisted failure codes and validated correlation ids reach the UI',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 assert.match(teachingFailure({reason:'teaching_suggestion_provider_refused',requestId:id},503),/declined this request/);
 assert.match(teachingFailure({reason:'teaching_suggestion_provider_auth',requestId:id},503),/provider rejected its credentials/);
 assert.match(teachingFailure({reason:'teaching_suggestion_scope_question',requestId:id},503),/recorded question could not be read/);
 assert.match(teachingFailure({reason:'teaching_suggestion_scope_question',requestId:id},503),/HTTP 503.*reference 11111111/);
 for(const reason of ['private raw text','__proto__','constructor']){
  const message=teachingFailure({reason,error:'sensitive raw provider failure',requestId:'secret-value'},503);
  assert.doesNotMatch(message,/private raw text|secret-value|sensitive raw provider failure|undefined/);
 }
});


test('demo replies bind the saved annotation and cannot masquerade as recorded-question replies',()=>{
 const {questionReceiptId,questionReceiptDigest,...base}=binding; const expected={...base,annotationId:'annotation',annotationDigest:'e'.repeat(64)};
 const reply={...value,contractVersion:'training-teaching-suggestion.v3',binding:expected};
 assert.equal(teachingSuggestion(reply,expected),true);assert.equal(teachingSuggestion({...reply,contractVersion:'training-teaching-suggestion.v2'},expected),false);
 for(const key of Object.keys(expected))assert.equal(teachingSuggestion({...reply,binding:{...expected,[key]:'wrong'}},expected),false,key);
 assert.equal(teachingSuggestion({...reply,binding:{...expected,questionReceiptId}},expected),false);
});

test('recording v4 keeps inferred preference distinct and binds every offered frame and durable suggestion',async()=>{
 const {recordingSuggestion}=await import('./training-teaching-draft.ts');
 const id='11111111-1111-4111-8111-111111111111';
 const binding={sourceId:id,sourceSha256:'a'.repeat(64),targetVersionId:id,excerptId:id,excerptDigest:'b'.repeat(64),frames:[0,500,999].map(timeMs=>({timeMs,frameSha256:'c'.repeat(64)}))};
 const reply={...value,contractVersion:'training-teaching-suggestion.v4',binding,frameIndex:1,suggestionId:id,suggestionDigest:'d'.repeat(64),sources:{...value.sources,why:'inferred_from_recognized_narration'}};
 assert.equal(recordingSuggestion(reply,binding),true);
 for(const patch of [{frameIndex:3},{sources:value.sources},{suggestionId:'unbound'},{binding:{...binding,frames:[...binding.frames].reverse()}},{binding:{...binding,excerptDigest:'e'.repeat(64)}}])assert.equal(recordingSuggestion({...reply,...patch},binding),false);
});


test('analysis recovery requires the result version to match its saved original scope pin',()=>{
 const f=JSON.parse(readFileSync(new URL('../test/fixtures/annotation-operating-gap-producer.v2.json',import.meta.url),'utf8'));
 const page={ok:true,contractVersion:'training-annotation-gap-list.v1',analyses:[structuredClone(f.listRow)],nextCursor:null},row=page.analyses[0],version=row.result.binding.expectedActiveVersionId;
 assert.equal(annotationGapPage(page,version),true);
 row.directionScopeContract='training-direction-scope.v1';assert.equal(annotationGapPage(page,version),false,'pinned recovery cannot downgrade to v7');
 row.result={...row.result,contractVersion:'training-teaching-suggestion.v9',creativeDirections:null};assert.equal(annotationGapPage(page,version),true);
 delete row.directionScopeContract;assert.equal(annotationGapPage(page,version),false,'v9 cannot masquerade as an old general request');
});
test('direction-aware insufficient replies require null scope and preserve their actual clarification reason',()=>{
 const f=JSON.parse(readFileSync(new URL('../test/fixtures/annotation-operating-gap-producer.v2.json',import.meta.url),'utf8'));
 const v9={...f.response,contractVersion:'training-teaching-suggestion.v9',status:'insufficient',fields:null,scopeSuggestion:null,reason:'The note needs a clearer preference.',creativeDirections:null};
 assert.equal(annotationAnalysis(v9,v9.binding),true);
 for(const creativeDirections of [[],['Balanced']])assert.equal(annotationAnalysis({...v9,creativeDirections},v9.binding),false);
 const {operatingGap,analysisReceipt,...v8}=v9;v8.contractVersion='training-teaching-suggestion.v8';
 assert.equal(scopedTeachingSuggestion(v8,v8.binding),true);
 assert.equal(scopedTeachingSuggestion({...v8,creativeDirections:[]},v8.binding),false);
});


test('actual backend direction producer responses pass the unchanged exact Dashboard binding and scope decoders',()=>{
 const f=JSON.parse(readFileSync(new URL('../test/fixtures/training-direction-scope-producer.v1.json',import.meta.url),'utf8'));
 const {demonstration:d,annotation:a,list:l,pending:p}=f;
 assert.equal(scopedTeachingSuggestion(d,d.binding),true);
 assert.equal(annotationAnalysis(a,a.binding),true);
 assert.equal(annotationGapPage(l,a.binding.expectedActiveVersionId),true);
 assert.equal(annotationGapPage({...l,analyses:[p]},a.binding.expectedActiveVersionId),true);
 assert.equal(annotationAnalysis({...a,binding:{...a.binding,directionScopeContract:'training-direction-scope.v1'}},a.binding),false,'a producer must not inflate the legacy exact frame binding');
 const downgraded=structuredClone(l);delete downgraded.analyses[0].directionScopeContract;
 assert.equal(annotationGapPage(downgraded,a.binding.expectedActiveVersionId),false,'a scoped result cannot appear as an unqualified general analysis');
});


test('automatic tool location must name a supported capability before the exact draft assessment',()=>{
 assert.deepEqual(recordingLocatorCapability({status:'located',capability:'higgsfield_image_to_video'},'auto'),{ok:true,capability:'higgsfield_image_to_video'});
 assert.deepEqual(recordingLocatorCapability({status:'located'},'web_reference_research'),{ok:true,capability:'web_reference_research'},'existing explicit locator keeps its shape');
 assert.deepEqual(recordingLocatorCapability({status:'insufficient',capability:null},'auto'),{ok:true,capability:null});
 for(const capability of [undefined,null,'higgsfield','unknown','auto'])assert.deepEqual(recordingLocatorCapability({status:'located',capability},'auto'),{ok:false});
 assert.deepEqual(recordingLocatorCapability({status:'insufficient',capability:'higgsfield_image_to_video'},'auto'),{ok:false});
 assert.deepEqual(recordingLocatorCapability({status:'located',capability:'presenter_background_removal'},'higgsfield_image_to_video'),{ok:false});
});

test('actual Higgsfield producer supports automatic discovery, both method paths and annotation recovery',()=>{
 const f=JSON.parse(readFileSync(new URL('../test/fixtures/training-higgsfield-producer.v1.json',import.meta.url),'utf8'));
 assert.equal(f.provenance.synthetic,true);assert.equal(f.provenance.model,false);
 const annotation=f.results.find((r:any)=>r.gate==='training-higgsfield-annotation-producer');
 assert.equal(annotationAnalysis(annotation.result,annotation.result.binding),true);
 assert.equal(annotationGapPage(annotation.list,annotation.result.binding.expectedActiveVersionId),true);
 assert.equal(annotation.list.analyses[0].edit.state,'blocked');
 for(const state of ['available','reviewed_unqueued']){
  const bypass=structuredClone(annotation.list);bypass.analyses[0].edit.state=state;
  assert.equal(annotationGapPage(bypass,annotation.result.binding.expectedActiveVersionId),false,'a tool finding cannot bypass the recorded capability update review');
 }
 const recording=f.results.find((r:any)=>r.gate==='training-higgsfield-actual-producer');
 assert.deepEqual(recordingLocatorCapability(recording.located,'auto'),{ok:true,capability:'higgsfield_image_to_video'});
 assert.deepEqual(recordingLocatorCapability(recording.explicit,'higgsfield_image_to_video'),{ok:true,capability:'higgsfield_image_to_video'});
 assert.equal(recordingAgentSuggestion(recording.proposal,recording.proposal.binding,'higgsfield_image_to_video'),true);
 assert.equal(recording.proposal.methodSelection,'agent_change_required');
 const existing=f.results.find((r:any)=>r.gate==='training-higgsfield-existing-step-producer');
 assert.equal(recordingAgentSuggestion(existing.proposal,existing.proposal.binding,'higgsfield_image_to_video'),true);
 assert.equal(existing.proposal.methodSelection,'pending_existing_binder');
 for(const entry of [recording,existing]){
  const changed=structuredClone(entry.proposal);changed.binding.targetVersionId='wrong-version';
  assert.equal(recordingAgentSuggestion(changed,entry.proposal.binding,'higgsfield_image_to_video'),false);
 }
});

test('saved proposal decoder binds the selected receipt without inventing model request metadata',()=>{
 const id='11111111-1111-4111-8111-111111111111',digest='a'.repeat(64),expected={sessionId:id,versionId:id,id,digest};
 const proposal={suggestionId:id,suggestionDigest:digest,capability:'web_reference_research',limitations:[],proposedChange:'Search references.',methodSelection:'pending_existing_binder',binding:{sourceId:id,sourceSha256:digest,targetVersionId:id,excerptId:id,excerptDigest:digest,frames:[0,1,2].map(timeMs=>({timeMs,frameSha256:digest}))}};
 const v={ok:true,contractVersion:'training-saved-recording-agent.v1',sessionId:id,proposal};assert.equal(savedRecordingAgentProposal(v,expected),true);
 for(const bad of [{...v,requestId:id},{...v,proposal:{...proposal,suggestionDigest:'b'.repeat(64)}},{...v,proposal:{...proposal,binding:{...proposal.binding,targetVersionId:'22222222-2222-4222-8222-222222222222'}}}])assert.equal(savedRecordingAgentProposal(bad,expected),false);
});
