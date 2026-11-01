import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../../lib/test/render.ts';
import {guidedTrainingChanges,type GuidedTrainingChanges} from '../../../../lib/guided-training-changes.ts';
import {readFileSync} from 'node:fs';
import {managerTrainingRunPreflight} from '../../../../lib/manager-training-run-preflight.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
const value=():GuidedTrainingChanges=>({ok:true,contractVersion:'guided-training-changes.v1',binding:{sessionId:id(1),agentFamilyId:id(2),workflowVersionId:id(3),snapshotDigest:H},
 policy:{policyId:null,policyDigest:null,revision:0,enabled:false},feedback:[{eventId:id(4),eventDigest:H,text:'Let the location image explain the contrast. What about the music?',analysisStatus:'answered',outcome:'partly',reason:'The visual preference is saved; the music question needs an answer.',uncoveredText:['What about the music?'],recordIds:[id(5)]}],
 records:[{recordId:id(5),recordDigest:H,summary:'Use imagery to explain the relationship.',state:'candidate',included:true,admissionOrigin:'standing_policy',category:'taste',sourceKind:'trainer_feedback',policyReceiptId:id(8),policyReceiptDigest:H,sourceEventId:id(4),sourceEventDigest:H,model:'claude-haiku-5-5'}],
 test:{snapshotDigest:null,scope:null,status:'not_run',runId:null,qualityScore:null,gaps:[],canTest:true},publication:{canPublish:false,reason:'Test the exact update first.',servedSnapshotDigest:null}});
const expected={sessionId:id(1),workflowVersionId:id(3)};
test('actual snapshot SQL DTOs pass the Dashboard unchanged, while a removed candidate stays stale and unqualified',()=>{
 const v=JSON.parse(readFileSync(new URL('../../../../lib/__fixtures__/training-snapshot-sql.v1.json',import.meta.url),'utf8'));
 assert.equal(v.synthetic,true);assert.equal(v.gate,'training-snapshot-actual-read');
 assert.equal(guidedTrainingChanges(v.read,{sessionId:v.read.binding.sessionId,workflowVersionId:v.read.binding.workflowVersionId}),true);
 assert.equal(v.read.test.status,'stale');assert.equal(v.read.activation.canActivate,false);assert.equal(v.read.publication.canPublish,false);
 const binding={testPreparationId:v.preparation.testPreparationId,preparationDigest:v.preparation.preparationDigest};
 assert.equal(managerTrainingRunPreflight(v.preflight,v.preparation.workflowVersionId,binding).state,'ready');
 assert.notEqual(managerTrainingRunPreflight(v.preflight,v.preparation.workflowVersionId,{...binding,preparationDigest:'f'.repeat(64)}).state,'ready');
});
test('the actual SQL read projection passes unchanged, including unavailable history and non-admitted conversions',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../../../../lib/__fixtures__/guided-training-changes-sql.v1.json',import.meta.url),'utf8'));
 assert.equal(fixture.provenance.capturedWithoutTranslation,true);const v=fixture.result;
 assert.equal(guidedTrainingChanges(v,{sessionId:v.binding.sessionId,workflowVersionId:v.binding.workflowVersionId}),true);
 assert.ok(v.feedback.some((f:any)=>f.analysisStatus==='unavailable'&&f.text===null&&f.outcome==='added'));
 assert.ok(v.records.some((r:any)=>r.state==='suggested'&&!r.included));
 assert.equal(v.test.canTest,false,'inert B1 cannot claim a test capability');
 assert.equal(v.publication.canPublish,false);
});
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
 v.publication.proposedSnapshotDigest=H;v.publication.qualifyingSnapshotDigest=H;v.publication.qualifyingTestRequestId=id(9);v.publication.qualifyingRunId=id(10);assert.equal(guidedTrainingChanges(v,expected),true,'identical effective public material may reuse a private test');
 v.test.snapshotDigest='b'.repeat(64);assert.equal(guidedTrainingChanges(v,expected),true,'public proof is independent from the displayed private test');
 v.publication.qualifyingSnapshotDigest='b'.repeat(64);assert.equal(guidedTrainingChanges(v,expected),false);
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
test('an existing image teaching opens its original evidence instead of sending an unsupported text edit',async t=>{
 const v=value();v.records[0].sourceKind='legacy_evidence';v.records[0].sourceEventId=null;v.records[0].sourceEventDigest=null;
 const {r,calls}=await setup(t,v);assert.equal(r.queryByText('Change in chat'),null);
 await r.click(r.getByText('Review original example'));assert.equal(calls[0][0],'edit');assert.equal(calls[0][1].recordId,id(5));
});

test('creation-note import shows exact saved private text and requires an explicit source-only action',async t=>{
 const v=value();v.creationImports=[{buildRequestId:id(11),replyId:id(12),replyDigest:H,noteCount:2,notes:['Prefer quieter captions.','Give the main point emphasis.'],importedNoteIndices:[0]}];
 assert.equal(guidedTrainingChanges(v,expected),true);
 const calls:any[]=[],r=await render('../training/[slug]/training-changes.tsx',{value:v,onPolicy:()=>{},onForce:()=>{},onEdit:()=>{},onRecord:()=>{},onTest:()=>{},onPublish:()=>{},onImport:(...args:any[])=>calls.push(args)});t.after(()=>r.cleanup());
 assert.match(r.text(),/Give the main point emphasis/);assert.doesNotMatch(r.text(),/Prefer quieter captions/);assert.equal(calls.length,0);
 await r.click(r.getByText('Import this private note'));assert.equal(calls[0][0].buildRequestId,id(11));assert.equal(calls[0][1],1);
 assert.match(r.text(),/does not accept a learning/);
 v.creationImports[0].importedNoteIndices=[8];assert.equal(guidedTrainingChanges(v,expected),false);
});

test('privacy withdrawal is separate from candidate removal and opens a confirmation without changing anything',async t=>{
 const calls:any[]=[],r=await render('../training/[slug]/training-changes.tsx',{value:value(),onPolicy:()=>{},onForce:()=>{},onEdit:()=>{},onRecord:()=>{},onTest:()=>{},onPublish:()=>{},onWithdraw:(target:any)=>calls.push(target)});t.after(()=>r.cleanup());
 assert.match(r.text(),/Added by your standing policy/);assert.match(r.text(),/policy receipt/);
 await r.click(r.getByText('Original feedback'));await r.click(r.getByText('Withdraw this feedback from future use'));
 assert.equal(calls.length,0);assert.match(r.text(),/not removal from one candidate/);assert.match(r.text(),/does not erase/);
 await r.click(r.getByText('Withdraw feedback'));assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{eventId:id(4),eventDigest:H}]);
});

test('activation uses a real matching request and explicit click, without imposing a new quality threshold',async t=>{
 const v=value();v.test={...v.test,status:'delivered',scope:'private_candidate',snapshotDigest:H,requestId:id(20),runId:id(21),qualityScore:60};
 v.activation={canActivate:true,reason:null,servedSnapshotDigest:'b'.repeat(64),withdrawnSinceTest:1,testRequestId:id(20)};
 assert.equal(guidedTrainingChanges(v,expected),true,'a fresh matching test may replace old served training with withdrawn items');
 const calls:any[]=[],r=await render('../training/[slug]/training-changes.tsx',{value:v,onPolicy:()=>{},onForce:()=>{},onEdit:()=>{},onRecord:()=>{},onTest:()=>{},onPublish:()=>{},onActivate:(...args:any[])=>calls.push(args)});t.after(()=>r.cleanup());
 assert.equal(calls.length,0);assert.match(r.text(),/Quality: 60\/100/);await r.click(r.getByText('Use this tested update'));assert.deepEqual(calls,[[H,id(20)]]);
 v.activation.testRequestId=id(22);assert.equal(guidedTrainingChanges(v,expected),false);
 v.activation.testRequestId=id(20);v.test.status='running';assert.equal(guidedTrainingChanges(v,expected),false);
});
test('pre-test guidance shows executor and real budget limits without claiming all eligible text was delivered',async t=>{
 const v=value();v.selectionCoverage={maxStandingReferences:2,eligibleTextByStage:[{stage:'build',count:5}]};
 v.activation={canActivate:false,reason:'training_delivered_test_required',servedSnapshotDigest:H,withdrawnSinceTest:0,stoppedSinceTest:1,testRequestId:null};
 assert.equal(guidedTrainingChanges(v,expected),true);const {r}=await setup(t,v);
 assert.match(r.text(),/requires the Codex executor/);assert.match(r.text(),/At most 2 stage-start references, across text and images/);
 assert.match(r.text(),/build: 5 eligible text teachings/);assert.match(r.text(),/Earlier-running tasks keep their frozen taste/);
 assert.doesNotMatch(r.text(),/5 (?:text )?teachings (?:were )?delivered/);
 (v.selectionCoverage as any).maxStandingReferences=3;assert.equal(guidedTrainingChanges(v,expected),false);
});


test('learning rows show a concise saved sentence while keeping the complete original on expand',async t=>{
 const v=value();v.records[0].summary='Use imagery to explain the relationship. Specific fonts, colors and positions remain optional.';
 const {r,calls}=await setup(t,v);const row=r.document.querySelector('[aria-label="Your private training update"] details.group')!;
 assert.match(row.querySelector('summary')?.textContent||'',/Use imagery to explain the relationship/);assert.doesNotMatch(row.querySelector('summary')?.textContent||'',/Specific fonts/);
 assert.match(row.textContent||'',/Specific fonts, colors and positions remain optional/);assert.equal(calls.length,0);
});
