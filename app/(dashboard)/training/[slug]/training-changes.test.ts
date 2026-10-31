import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../../lib/test/render.ts';
import {guidedTrainingChanges,type GuidedTrainingChanges} from '../../../../lib/guided-training-changes.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
const value=():GuidedTrainingChanges=>({ok:true,contractVersion:'guided-training-changes.v1',binding:{sessionId:id(1),agentFamilyId:id(2),workflowVersionId:id(3),snapshotDigest:H},
 policy:{policyId:null,policyDigest:null,revision:0,enabled:false},feedback:[{eventId:id(4),eventDigest:H,text:'Let the location image explain the contrast. What about the music?',analysisStatus:'answered',outcome:'partly',reason:'The visual preference is saved; the music question needs an answer.',uncoveredText:['What about the music?'],recordIds:[id(5)]}],
 records:[{recordId:id(5),recordDigest:H,summary:'Use imagery to explain the relationship.',state:'candidate',included:true,admissionOrigin:'standing_policy',category:'taste',sourceKind:'trainer_feedback',policyReceiptId:id(8),policyReceiptDigest:H,sourceEventId:id(4),sourceEventDigest:H,model:'claude-haiku-5-5'}],
 test:{snapshotDigest:null,scope:null,status:'not_run',runId:null,qualityScore:null,gaps:[],canTest:true},publication:{canPublish:false,reason:'Test the exact update first.',servedSnapshotDigest:null}});
const expected={sessionId:id(1),workflowVersionId:id(3)};
test('coverage requires actual source-bound saved records; unavailable analysis is not a successful no-match',()=>{
 assert.equal(guidedTrainingChanges(value(),expected),true);
 for(const mutate of [(v:any)=>v.feedback[0].recordIds=[],(v:any)=>v.records[0].sourceEventDigest='b'.repeat(64),(v:any)=>v.feedback[0].analysisStatus='unavailable']){
  const v=value();mutate(v);assert.equal(guidedTrainingChanges(v,expected),false);
 }
 const pending=value();pending.feedback[0]={...pending.feedback[0],outcome:'not_analysed',analysisStatus:'pending',recordIds:[]};assert.equal(guidedTrainingChanges(pending,expected),true);
});
test('delivered alone and a private-only test cannot make a different public snapshot publishable',()=>{
 const v=value();v.publication.canPublish=true;assert.equal(guidedTrainingChanges(v,expected),false);
 v.test={...v.test,status:'delivered',scope:'private_candidate',runId:id(9),snapshotDigest:H};assert.equal(guidedTrainingChanges(v,expected),false);
 v.publication.proposedSnapshotDigest=H;assert.equal(guidedTrainingChanges(v,expected),true,'identical effective public material may reuse a private test');
 v.test.snapshotDigest='b'.repeat(64);assert.equal(guidedTrainingChanges(v,expected),false);
});
async function setup(t:any,v=value()){
 const calls:any[]=[],props={value:v,onPolicy:(...a:any[])=>calls.push(['policy',...a]),onForce:(a:any)=>calls.push(['force',a]),onEdit:(a:any)=>calls.push(['edit',a]),onRecord:(...a:any[])=>calls.push(['record',...a]),onTest:(a:any)=>calls.push(['test',a]),onPublish:(a:any)=>calls.push(['publish',a])};
 const r=await render('../training/[slug]/training-changes.tsx',props);t.after(()=>r.cleanup());return {r,calls};
}
test('opening coverage is passive and uses no blank field; ordinary inclusion is not labelled human acceptance or application proof',async t=>{
 const {r,calls}=await setup(t);assert.equal(calls.length,0);assert.equal(r.document.querySelectorAll('textarea,input[type=text]').length,0);
 assert.match(r.text(),/Included in this private candidate/);assert.doesNotMatch(r.text(),/Previously accepted by you/);assert.equal((r.getByText('Review publication') as HTMLButtonElement).disabled,true);
 await r.click(r.getByText('Not converted'));assert.match(r.text(),/What about the music/);await r.click(r.getByText('Use as learning'));
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['force',{eventId:id(4),eventDigest:H}]]);
});
test('policy opt-in requires an unchecked explicit action and carries the exact current revision; no test starts implicitly',async t=>{
 const {r,calls}=await setup(t);const b=r.getByText('Enable private automatic inclusion') as HTMLButtonElement;assert.equal(b.disabled,true);
 const c=r.document.querySelector('input[type=checkbox]') as HTMLInputElement;assert.equal(c.checked,false);await r.click(c);await r.click(b);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['policy',true,{policyId:null,policyDigest:null,revision:0,enabled:false}]]);
});
test('record editing, retirement and test target exact displayed identities; quality remains unknown without a grade',async t=>{
 const v=value(),{r,calls}=await setup(t,v);await r.click(r.getByText('Change in chat'));await r.click(r.getByText('Remove from this candidate'));await r.click(r.getByText('Run with updates'));
 assert.equal(calls[0][1].recordDigest,H);assert.equal(calls[1][2],'remove');assert.deepEqual(calls[2],['test',H]);assert.doesNotMatch(r.text(),/Quality: /);
});
