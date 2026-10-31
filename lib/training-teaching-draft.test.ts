import test from 'node:test';
import assert from 'node:assert/strict';
import { teachingSuggestion, teachingDigest, teachingFrame, teachingFailure, recordingAgentSuggestion } from './training-teaching-draft.ts';
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
