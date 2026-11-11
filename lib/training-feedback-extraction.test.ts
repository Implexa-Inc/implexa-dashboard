import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extractFeedbackTeaching,type FeedbackExtractionProgress} from './training-feedback-extraction.ts';
const id='11111111-1111-4111-8111-111111111111',record='22222222-2222-4222-8222-222222222222';
const sha='a'.repeat(64),source={sourceId:id,token:'native-token',metadata:{sha256:sha,durationMs:1000}};
const image='data:image/png;base64,'+Buffer.alloc(40,1).toString('base64');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const fields={chosen:'In this example, the route is a wall of text.',why:'Prefer a spatial explanation when geography matters.',process:'Applies when location explains the comparison.',desiredBehavior:'Explain the relationship visually, with a map when useful.'};
function setup({nullScope=false,linkFails=false,wrongBinding=false,insufficient=false}={}){
 const calls:any[]=[],progress:FeedbackExtractionProgress={key:id};let links=0;
 const run=()=>extractFeedbackTeaching({source,timeMs:1000,rawAnnotation:'Show the location on a map, rather than listing names.',versionId:id,retentionUntil:'2027-11-11T00:00:00.000Z',progress,
  check:async()=>{calls.push(['check']);},call:async(op,args:any)=>{calls.push([op,args]);if(op==='preview')return {ok:true,image};if(op==='annotate')return {ok:true,recordId:record,recordDigest:sha};throw Error('Unexpected writer');},
  send:async(op,body:any,key)=>{calls.push([op,body,key]);
   if(op==='annotation'&&body.action==='save'){const {action,expectedActiveVersionId,...annotation}=body;return {ok:true,contractVersion:'training-demo-annotation.v1',annotationId:id,annotationDigest:sha,annotation:{...annotation,contractVersion:'training-demo-annotation.v1',targetVersionId:expectedActiveVersionId}};}
   if(op==='annotation'){if(linkFails&&++links===1)throw Error('lost link response');return {ok:true,contractVersion:'training-demo-link.v1',annotationId:id,annotationDigest:sha,recordId:record,recordDigest:sha,linkReceiptId:id};}
   const {mode,includeScope,image,consent,...binding}=body;
   return {ok:true,requestId:id,contractVersion:'training-teaching-suggestion.v6',model:'claude-haiku-5-5',status:insufficient?'insufficient':'suggested',fields:insufficient?null:fields,reason:insufficient?'Please explain what you prefer.':'',scopeSuggestion:nullScope||insufficient?null:{property:'narrative_visual_alignment',relation:'rejected'},binding:{...binding,sourceId:wrongBinding?record:binding.sourceId,feedbackSha256:hash('Show the location on a map, rather than listing names.')},sources:{chosen:'observed_frame',why:'trainer_preference',process:'transferable_guidance',desiredBehavior:'transferable_guidance'}};
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
