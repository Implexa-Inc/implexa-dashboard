import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trainingReviewMarkRecord} from './training-review-mark.ts';
import {guidedTrainingChanges} from './guided-training-changes.ts';
const record=()=>JSON.parse(readFileSync(new URL('./__fixtures__/training-review-mark-record.v1.json',import.meta.url),'utf8'));
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);

test('approved mark reader binds the exact saved record and rejects invented or unavailable source prose',()=>{
 const value=record(),expected={recordId:value.recordId,recordDigest:value.recordDigest};assert.equal(trainingReviewMarkRecord(value,expected),true);
 for(const change of [(v:any)=>delete v.trainingSessionId,(v:any)=>v.trainingSessionId='bad',(v:any)=>v.recordDigest='b'.repeat(64),(v:any)=>v.availability='withdrawn',(v:any)=>v.fields.why='',(v:any)=>v.sourceMark.purpose='guessed',(v:any)=>v.sourceMark.anchor.observedArtifactId=id(99),(v:any)=>v.sourceMark.anchor.geometry.width=2,(v:any)=>v.nativeToken='secret']){const v=record();change(v);assert.equal(trainingReviewMarkRecord(v,expected),false);}
});

test('guided records accept only the additive exact review-mark pointer and retain old record compatibility',()=>{
 const value:any={ok:true,contractVersion:'guided-training-changes.v1',binding:{sessionId:id(10),agentFamilyId:id(11),workflowVersionId:id(12),snapshotDigest:H},policy:{policyId:null,policyDigest:null,revision:0,enabled:false},feedback:[],records:[{recordId:id(1),recordDigest:H,summary:'An approved lesson.',state:'human_accepted',included:true,admissionOrigin:'human_decision',category:'taste',sourceKind:'legacy_evidence',policyReceiptId:null,policyReceiptDigest:null,sourceEventId:null,sourceEventDigest:null,model:null}],test:{snapshotDigest:null,scope:null,status:'not_run',runId:null,qualityScore:null,gaps:[],canTest:false},publication:{canPublish:false,reason:null,servedSnapshotDigest:null}};
 const expected={sessionId:id(10),workflowVersionId:id(12)};assert.equal(guidedTrainingChanges(value,expected),true);
 value.records[0].reviewMark={acknowledgmentId:id(6)};assert.equal(guidedTrainingChanges(value,expected),true);
 for(const pointer of [null,{},[],{acknowledgmentId:'bad'},{acknowledgmentId:id(6),sourceBody:'extra'}]){value.records[0].reviewMark=pointer;assert.equal(guidedTrainingChanges(value,expected),false);}
 value.records[0].reviewMark={acknowledgmentId:id(6)};Object.assign(value.records[0],{sourceKind:'trainer_feedback',sourceEventId:id(13),sourceEventDigest:H});assert.equal(guidedTrainingChanges(value,expected),false);
});
