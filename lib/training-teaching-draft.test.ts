import test from 'node:test';
import assert from 'node:assert/strict';
import { teachingSuggestion, teachingDigest, teachingFrame } from './training-teaching-draft.ts';
const binding = { sourceId:'source',sourceSha256:'a'.repeat(64),timeMs:0,frameSha256:'b'.repeat(64),questionReceiptId:'question',
  questionReceiptDigest:'c'.repeat(64),expectedActiveVersionId:'version',feedbackSha256:'d'.repeat(64) };
const value = { ok:true,contractVersion:'training-teaching-suggestion.v1',model:'claude-haiku-4-5-20251001',binding,
  status:'suggested',fields:{chosen:'Observed visual',why:'Trainer preference',process:'Adapt the visual principle',desiredBehavior:'A transferable explanation'},reason:'',
  sources:{chosen:'observed_frame',why:'trainer_preference',process:'transferable_guidance',desiredBehavior:'transferable_guidance'} };
test('every suggestion identity and field limit is checked without inventing evidence or clipping text',async()=>{
  assert.equal(teachingSuggestion(value,binding),true);
  for(const key of Object.keys(binding)) assert.equal(teachingSuggestion({...value,binding:{...binding,[key]:'different'}},binding),false,key);
  for(const patch of [{model:'other'}, {authority:true}, {fields:{...value.fields,chosen:'x'.repeat(401)}},
    {sources:{...value.sources,process:'observed_frame'}}, {status:'insufficient',fields:value.fields,reason:'unclear'}]) assert.equal(teachingSuggestion({...value,...patch},binding),false);
  assert.equal(teachingSuggestion({...value,status:'insufficient',fields:null,reason:'The feedback needs clarification.'},binding),true);
  assert.equal(await teachingDigest(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.throws(()=>teachingFrame('https://host/private-frame.png'));
  assert.throws(()=>teachingFrame('data:image/png;base64,'+'A'.repeat(2800000)));
});
