import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {annotationAnalysis,annotationGapPage,scopedTeachingSuggestion} from './training-teaching-draft.ts';
export const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
export function suggestion(){return {ok:true,contractVersion:'training-teaching-suggestion.v7',model:'claude-haiku-5-5',requestId:id(1),
 binding:{sourceId:id(2),sourceSha256:H,timeMs:0,frameSha256:H,expectedActiveVersionId:id(3),feedbackSha256:H,annotationId:id(4),annotationDigest:H},
 status:'insufficient',fields:null,reason:'No visual taste preference was stated.',scopeSuggestion:null,
 sources:{chosen:'observed_frame',why:'trainer_preference',process:'transferable_guidance',desiredBehavior:'transferable_guidance'},
 operatingGap:{status:'suggested',kind:'procedure',stepOrder:4,capability:null,evidenceExcerpt:'Do not require an external prompt file.',privateRationale:'Private trainer reasoning',genericDelta:'Author and review the media prompt within the Build step.'},
 analysisReceipt:{requestEventId:id(5),requestDigest:H,resultEventId:id(6),resultDigest:H,attemptOrdinal:1,setupDigest:H,setupState:'complete',target:{stepOrder:4,stepDigest:H,methods:[]},usage:{status:'unknown',inputTokens:null,outputTokens:null}}};}
export function page(){const result=suggestion();return {ok:true,contractVersion:'training-annotation-gap-list.v1',analyses:[{annotation:{annotationId:result.binding.annotationId,annotationDigest:result.binding.annotationDigest},retry:{state:'none',availableAt:null},analysisRequest:{requestEventId:id(5),requestDigest:H,attemptOrdinal:1},outcome:'answered',reason:null,result,edit:{state:'available',review:null,requestId:null,requestStatus:null,reviewedNote:null}}],nextCursor:null};}
test('v7 independently retains operating proposal when taste is insufficient; v6 stays exact',()=>{
 const s=suggestion();assert.equal(annotationAnalysis(s,s.binding),true);assert.equal(scopedTeachingSuggestion(s,s.binding),false);
 const {operatingGap,analysisReceipt,...taste}=s;assert.equal(scopedTeachingSuggestion({...taste,contractVersion:'training-teaching-suggestion.v6'},s.binding),true);
 assert.equal(annotationGapPage(page(),id(3)),true);
});
test('wrong source, uncertain setup or result linkage cannot enable a reviewed edit',()=>{
 const s=suggestion();assert.equal(annotationAnalysis(s,{...s.binding,sourceId:id(99)}),false);
 for(const mutate of [(v:any)=>v.analysisReceipt.target.stepOrder=3,(v:any)=>v.analysisReceipt.setupState='incomplete',(v:any)=>v.extra='unknown',(v:any)=>v.analysisReceipt.usage.inputTokens=5]){
  const value=suggestion();mutate(value);assert.equal(annotationAnalysis(value,value.binding),false);
 }
 const p=page();p.analyses[0].analysisRequest.requestDigest='b'.repeat(64);assert.equal(annotationGapPage(p,id(3)),false);
 assert.equal(annotationGapPage(page(),id(99)),false);
});
test('tool review, present and incomplete outcomes are valid without granting a tool or inventing a step',()=>{
 for(const status of ['incomplete','unsupported']){const s:any=suggestion();s.operatingGap.status=status;s.operatingGap.genericDelta='';s.operatingGap.stepOrder=null;s.analysisReceipt.target=null;s.analysisReceipt.setupState='incomplete';assert.equal(annotationAnalysis(s,s.binding),true);}
 const present:any=suggestion();present.operatingGap.status='present';present.operatingGap.genericDelta='';assert.equal(annotationAnalysis(present,present.binding),true);
 const s:any=suggestion();s.operatingGap.kind='tool';s.operatingGap.capability='presenter_background_removal';assert.equal(annotationAnalysis(s,s.binding),true);
});

test('unmodified real SQL/service producer response and persisted list row pass the Dashboard consumer',()=>{
 const bytes=readFileSync(new URL('../test/fixtures/annotation-operating-gap-producer.v2.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'289bd544eb4192541c7accb148a83b2469ae3f2cace9227f361730557e0cc284');
 const f=JSON.parse(bytes.toString());assert.equal(f.provenance.synthetic,true);assert.equal(annotationAnalysis(f.response,f.response.binding),true);
 for(const row of [f.listRow,f.reviewedUnqueuedRow,f.pendingRow])assert.equal(annotationGapPage({ok:true,contractVersion:'training-annotation-gap-list.v1',analyses:[row],nextCursor:null},f.response.binding.expectedActiveVersionId),true);
});
