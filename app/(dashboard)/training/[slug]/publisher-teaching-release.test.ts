import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {render} from '../../../../lib/test/render.ts';
import {trainingPublicationPreview,type GuidedTrainingChanges,type TrainingPublicationPreview} from '../../../../lib/guided-training-changes.ts';
const U=(n:number)=>`24000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const VERSION=U(1),RECORD=U(2),DIGEST='a'.repeat(64);
const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmO0AAAAASUVORK5CYII=';
const bytes=Buffer.from(IMAGE.slice(22),'base64'),SHA=createHash('sha256').update(bytes).digest('hex');
const projection={recordId:RECORD,recordDigest:DIGEST,relation:'accepted',properties:['layout_variety'],summary:'Explain the relationship visually.',mustNotCopy:['source labels'],attribution:null,
 derivative:{evidenceId:U(3),sha256:SHA,anchorDigest:'b'.repeat(64),mediaType:'image/png',sizeBytes:bytes.length,width:1,height:1}};
const stored={storageId:U(4),recordId:RECORD,recordDigest:DIGEST,evidenceId:U(3),sha256:SHA,sizeBytes:bytes.length,width:1,height:1,
 consentReceiptDigest:'c'.repeat(64),retentionUntil:'2030-01-01T00:00:00Z',storedAt:'2026-10-28T00:00:00Z',uploadExpiresAt:null,withdrawnAt:null,deletedAt:null};
const item={recordId:RECORD,recordDigest:DIGEST,sessionId:U(5),localSourceId:U(6),baseVersionId:U(7),sourceMachineId:'publisher-machine',projection,
 decision:{chosen:'Spatial comparison',why:'Explains the relationship',process:'Use a fresh visual',desiredBehavior:'Adapt to new content'},eligible:true,storage:stored,release:null as any};
const candidateState=():GuidedTrainingChanges=>({ok:true,contractVersion:'guided-training-changes.v1',binding:{sessionId:U(5),agentFamilyId:U(9),workflowVersionId:VERSION,snapshotDigest:DIGEST},
 policy:{policyId:null,policyDigest:null,revision:0,enabled:false},feedback:[],records:[{recordId:RECORD,recordDigest:DIGEST,summary:'Explain the relationship visually.',state:'candidate',included:true,
 admissionOrigin:'owner_candidate',category:'taste',sourceKind:'trainer_feedback',sourceEventId:U(10),sourceEventDigest:DIGEST,policyReceiptId:null,policyReceiptDigest:null,model:'claude-haiku-5-5'}],
 test:{scope:null,snapshotDigest:null,status:'not_run',runId:null,qualityScore:null,gaps:[],canTest:true},publication:{canPrepare:true,canPublish:false,reason:null,servedSnapshotDigest:null}});
const publicationPreview=(canPublish=false):TrainingPublicationPreview=>({ok:true,contractVersion:'training-publication-preview.v1',publicationPreparationId:U(20),preparationDigest:'b'.repeat(64),sessionId:U(5),workflowVersionId:VERSION,
 candidateSnapshotDigest:DIGEST,snapshotDigest:'c'.repeat(64),definition:{name:'Video agent',description:'A playable video and editable project.'},
 publicationDelta:{publishedSnapshotDigest:'e'.repeat(64),definitionChanged:false,changes:[{recordId:RECORD,change:'added'},{recordId:U(29),change:'removed'}]},
 records:[{recordId:RECORD,recordDigest:DIGEST,relation:'accepted',properties:['layout_variety'],summary:'Explain the relationship visually.',mustNotCopy:['source marks'],attribution:null,deliveryMode:'standing',
 derivative:{kind:'text_guidance',sha256:'d'.repeat(64),sizeBytes:220,mediaType:'application/json'}}],
 qualifyingTestRequestId:canPublish?U(21):null,qualifyingRunId:canPublish?U(22):null,qualifyingSnapshotDigest:canPublish?'c'.repeat(64):null,canPublish,reason:canPublish?null:'publication_test_required'});
test('actual PostgreSQL publication preview passes unchanged after genuine synthetic delivery, while a different subset remains unqualified',()=>{
 const v=JSON.parse(readFileSync(new URL('../../../../lib/__fixtures__/training-publication-sql.v1.json',import.meta.url),'utf8'));
 assert.equal(v.synthetic,true);assert.equal(v.gate,'training-publication-actual-delivery');
 const expected={sessionId:v.preview.sessionId,workflowVersionId:v.preview.workflowVersionId,snapshotDigest:v.preview.candidateSnapshotDigest,
  records:v.preview.records.map((r:any)=>({recordId:r.recordId,recordDigest:r.recordDigest,summary:r.summary,included:true}))} as any;
 assert.equal(trainingPublicationPreview(v.preview,expected),true);
 assert.equal(v.preview.canPublish,true);assert.equal(v.published.published,true);assert.equal(v.empty.canPublish,false);
 assert.equal(trainingPublicationPreview(v.empty,{...expected,records:[]}),true);
});
test('public preview guard binds the explicit selection and qualifying material, independently from a private test label',()=>{
 const v=publicationPreview(true),state=candidateState(),expected={sessionId:U(5),workflowVersionId:VERSION,snapshotDigest:DIGEST,records:state.records};
 assert.equal(trainingPublicationPreview(v,expected),true);
 for(const change of [(x:any)=>x.records[0].recordDigest='f'.repeat(64),(x:any)=>x.records[0].summary='Different guidance',
  (x:any)=>x.qualifyingSnapshotDigest='f'.repeat(64),(x:any)=>x.qualifyingRunId=null,(x:any)=>x.records[0].derivative.kind='unknown',
  (x:any)=>delete x.publicationDelta,(x:any)=>x.publicationDelta.changes=[],(x:any)=>x.publicationDelta.changes[0].change='removed']){
  const bad=structuredClone(v);change(bad);assert.equal(trainingPublicationPreview(bad,expected),false);
 }
});
async function snapshotReview(t:any,canPublish=false){
 const calls:any[]=[],value=candidateState(),preview=publicationPreview(canPublish);
 const props={open:true,value,onClose:()=>{},onPrepare:async(ids:string[])=>{calls.push(['prepare',ids]);return preview;},onTest:async(p:any)=>{calls.push(['test',p]);},onPublish:async(p:any)=>{calls.push(['publish',p]);return true;}};
 const r=await render('../training/[slug]/publisher-teaching-release.tsx',props,{exportName:'GuidedPublicationReview'});t.after(()=>r.cleanup());return {r,calls,props,preview};
}
test('public snapshot review is passive, starts with no selected private teaching and introduces no blank writing field',async t=>{
 const {r,calls}=await snapshotReview(t);assert.equal(calls.length,0);assert.equal(r.document.querySelectorAll('textarea,input[type=text]').length,0);
 assert.equal((r.document.querySelector('input[type=checkbox]') as HTMLInputElement).checked,false);
 await r.click(r.document.querySelector('input[type=checkbox]')!);await r.click(r.getByText('Prepare exact public preview'));
 assert.match(r.text(),/1 added · 1 removed/);assert.match(r.text(),/removed teachings will be absent/);assert.match(r.text(),/public definition stays the same/);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['prepare',[RECORD]]);
 assert.equal((r.getByText('Publish tested public version') as HTMLButtonElement).disabled,true);
 await r.click(r.getByText('Test this public version'));assert.equal(calls[1][0],'test');assert.equal(calls[1][1].snapshotDigest,'c'.repeat(64));
});
test('publishing an exactly matched public snapshot still needs explicit unchecked batch consent',async t=>{
 const {r,calls,preview}=await snapshotReview(t,true);await r.click(r.document.querySelector('input[type=checkbox]')!);await r.click(r.getByText('Prepare exact public preview'));
 const publish=r.getByText('Publish tested public version') as HTMLButtonElement;assert.equal(publish.disabled,true);assert.match(r.text(),/Customers need Codex and Implexa Desktop 0.4.160/);
 const boxes=r.document.querySelectorAll('input[type=checkbox]');assert.equal((boxes[1] as HTMLInputElement).checked,false);
 await r.click(boxes[1]);await r.click(publish);assert.equal(calls[1][0],'publish');assert.equal(calls[1][1].preparationDigest,preview.preparationDigest);
 assert.equal(calls[1][1].qualifyingTestRequestId,U(21));assert.match(r.text(),/exact tested public version is published/);
});
async function setup(mode='valid'){
 const calls:Array<{kind:string;body:any}>=[];let live=structuredClone(item);
 const bridge={trainingEvidenceStorageContractVersion:'1',trainingLocal:async(kind:string,args:any)=>{
  calls.push({kind,body:args});return kind==='list'?{ok:true,sources:[{sourceId:U(6),token:U(8),decisions:[{recordId:RECORD,recordDigest:DIGEST}]}]}
   :kind==='decisionPreview'?{ok:true,recordId:RECORD,recordDigest:DIGEST,image:mode==='wrong-image'?IMAGE.replace('mO0','nO0'):IMAGE}:{ok:false};}};
 const r=await render('../training/[slug]/publisher-teaching-release.tsx',{slug:'video-agent',versionId:VERSION},{bridge});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 r.window.fetch=(async(_url:any,opts:any={})=>{const body=opts.body?JSON.parse(opts.body):null;calls.push({kind:opts.method||'GET',body});
  const common={ok:true,contractVersion:'publisher-teaching-preview.v1',releaseId:body?.releaseId,releaseDigest:'d'.repeat(64),projection,
   receipt:{workflowVersionId:VERSION,storageId:U(4),retentionUntil:stored.retentionUntil,deliveryMode:'on_question'}};
  if(!body)return {ok:mode!=='foreign',json:async()=>({ok:mode!=='foreign',reason:'not_owned',contractVersion:'publisher-teaching-candidates.v1',workflowVersionId:mode==='stale'?U(99):VERSION,candidates:[live]})};
  if(body.action==='release'){live={...live,release:{releaseId:body.releaseId,releaseDigest:common.releaseDigest,withdrawnAt:null,current:true}};return {ok:true,json:async()=>({...common,released:true})};}
  if(body.action==='withdraw'){live={...live,release:{...live.release,withdrawnAt:'2026-10-28T00:00:01Z',current:false}};return {ok:true,json:async()=>({ok:true,...live.release})};}
  return {ok:true,json:async()=>({...common,released:false})};
 }) as typeof r.window.fetch;
 return {r,calls};
}
test('customer release previews the exact old-session frame, requires separate consent, and can be withdrawn',async()=>{
 const {r,calls}=await setup();try{
  await r.click(r.getByText('Load compatible teaching candidates'));await r.click(r.getByText(`Review teaching ${DIGEST.slice(0,8)}`));
  assert.ok(r.document.querySelector('img'));assert.equal(calls.find(c=>c.kind==='list')?.body.sessionId,U(5),'uses the actual original session, not active training session');
  await r.click(r.getByText('Prepare exact release preview'));
  assert.equal((r.getByText('Release this exact teaching') as HTMLButtonElement).disabled,true);assert.equal(calls.some(c=>c.body?.action==='release'),false);
  await r.click(r.getByText(/I reviewed this exact image and guidance/).closest('label')!.querySelector('input')!);
  await r.click(r.getByText('Release this exact teaching'));
  const submitted=calls.find(c=>c.body?.action==='release')!.body;assert.equal(submitted.previewDigest,'d'.repeat(64));assert.equal(submitted.storageId,U(4));assert.equal(submitted.versionId,VERSION);
  assert.equal(Object.hasOwn(submitted,'ownerId'),false);assert.match(r.text(),/Released for this version/);
  await r.click(r.getByText(`Withdraw release ${DIGEST.slice(0,8)}`));assert.match(r.text(),/Further customer disclosure is withdrawn/);
  assert.equal(calls.some(c=>['accept','annotate','revoke','serverStorage'].includes(c.kind)),false,'release never rewrites or deletes the admitted teaching');
 }finally{r.cleanup();}
});
test('stale version, foreign candidates and mismatched frame never reach release preparation',async()=>{
 for(const mode of ['stale','foreign','wrong-image']){const {r,calls}=await setup(mode);try{
  await r.click(r.getByText('Load compatible teaching candidates'));
  if(mode==='wrong-image')await r.click(r.getByText(`Review teaching ${DIGEST.slice(0,8)}`));
  assert.equal(r.queryByText('Prepare exact release preview'),null,mode);assert.equal(calls.some(c=>c.body?.action==='preview'||c.body?.action==='release'),false,mode);
 }finally{r.cleanup();}}
});

test('a fork permission previews one exact release, requires consent and withdraws independently',async()=>{
 const calls:any[]=[],lineage=U(20),releaseId=U(21);let granted:any=null;
 const r=await render('../training/[slug]/publisher-teaching-release.tsx',{slug:'video-agent',versionId:null,forkPermission:{lineageId:lineage,parentVersionId:VERSION}});
 Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
 r.window.fetch=(async(_url:any,opts:any={})=>{const b=opts.body?JSON.parse(opts.body):null;calls.push(b);
  if(!b)return {ok:true,json:async()=>({ok:true,contractVersion:'publisher-teaching-candidates.v1',workflowVersionId:VERSION,candidates:[{...item,release:{releaseId,releaseDigest:DIGEST,withdrawnAt:null,current:true}}]})};
  if(b.action==='fork_list')return {ok:true,json:async()=>({ok:true,lineageId:lineage,grants:granted?[granted]:[]})};
  if(b.action==='fork_withdraw'){granted={...granted,withdrawn_at:'2030-01-01T00:00:00Z'};return {ok:true,json:async()=>({ok:true,grantId:b.grantId,withdrawnAt:granted.withdrawn_at})};}
  if(b.action==='fork_grant')granted={id:b.grantId,lineage_id:lineage,release_id:releaseId,release_digest:DIGEST,grant_digest:'e'.repeat(64),withdrawn_at:null};
  return {ok:true,json:async()=>({ok:true,granted:b.action==='fork_grant',grantId:b.grantId,grantDigest:'e'.repeat(64),childVersionId:lineage,parentVersionId:VERSION,childName:'Private video fork',recipientId:U(22),receipt:{lineageId:lineage,releaseId,releaseDigest:DIGEST}})};
 }) as typeof r.window.fetch;
 try{
  const input=r.document.querySelector('[aria-label="Fork reference"]')!;
  await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLInputElement.prototype,'value')!.set!.call(input,lineage);input.dispatchEvent(new r.window.Event('input',{bubbles:true}));});
  await r.click(r.getByText('Load compatible teaching candidates'));await r.click(r.getByText(`Review fork permission ${DIGEST.slice(0,8)}`));
  assert.equal((r.getByText('Allow example in this fork') as HTMLButtonElement).disabled,true);assert.equal(calls.some(b=>b?.action==='fork_grant'),false);
  await r.click(r.getByText('Allow this exact released example in this private child.').closest('label')!.querySelector('input')!);
  await r.click(r.getByText('Allow example in this fork'));
  const request=calls.find(b=>b?.action==='fork_grant');assert.equal(request.lineageId,lineage);assert.equal(request.releaseId,releaseId);assert.equal(request.previewDigest,'e'.repeat(64));assert.equal(Object.hasOwn(request,'ownerId'),false);
  await r.click(r.getByText(`Withdraw fork permission ${releaseId.slice(0,8)}`));assert.match(r.text(),/original customer release is unchanged/);
  assert.equal(calls.some(b=>b?.action==='withdraw'),false,'fork withdrawal never withdraws original customer distribution');
  assert.equal((r.getByText(`Review fork permission ${DIGEST.slice(0,8)}`) as HTMLButtonElement).disabled,true,'a replacement permission cannot revive old frozen contexts');
 }finally{r.cleanup();}
});

test('compatible-version scope requires its own exact preview and publisher confirmation',async()=>{
 const calls:any[]=[],lineage=U(30),releaseId=U(31),grantId=U(32),scopeDigest='f'.repeat(64);
 let grant:any={id:grantId,lineage_id:lineage,release_id:releaseId,release_digest:DIGEST,grant_digest:'e'.repeat(64),withdrawn_at:null,successor_scope_digest:null};
 const r=await render('../training/[slug]/publisher-teaching-release.tsx',{slug:'video-agent',versionId:VERSION,forkPermission:{lineageId:lineage,parentVersionId:VERSION}});
 const scope=(confirmed:boolean)=>({ok:true,scopeConfirmed:confirmed,scopeDigest,scope:'compatible_successors',grantId,childVersionId:lineage,parentVersionId:VERSION,recipientId:U(33),childName:'Private fork',
  receipt:{contractVersion:'agent-fork-successor-scope.v1',scope:'compatible_successors',grantDigest:grant.grant_digest,lineageId:lineage,releaseId,releaseDigest:DIGEST}});
 r.window.fetch=(async(_url:any,opts:any)=>{const b=JSON.parse(opts.body);calls.push(b);
  if(b.action==='fork_list')return {ok:true,json:async()=>({ok:true,lineageId:lineage,grants:[grant]})};
  if(b.action==='fork_scope_confirm'){grant={...grant,successor_scope_digest:scopeDigest,successor_scope_confirmed_at:'2026-10-29T20:00:00Z'};return {ok:true,json:async()=>scope(true)};}
  return {ok:true,json:async()=>scope(false)};
 }) as typeof r.window.fetch;
 try{
  await r.click(r.getByText('Load fork permissions'));
  await r.click(r.getByText(`Review compatible versions ${releaseId.slice(0,8)}`));
  assert.equal((r.getByText('Allow compatible versions') as HTMLButtonElement).disabled,true);
  assert.equal(calls.some(b=>b.action==='fork_scope_confirm'),false,'preview is not approval');
  await r.click(r.getByText('Allow this example in this private fork and its compatible future versions.').closest('label')!.querySelector('input')!);
  await r.click(r.getByText('Allow compatible versions'));
  const sent=calls.find(b=>b.action==='fork_scope_confirm');assert.equal(sent.previewDigest,scopeDigest);assert.equal(sent.grantId,grantId);assert.equal(sent.lineageId,lineage);assert.equal(Object.hasOwn(sent,'ownerId'),false);
  assert.match(r.text(),/permitted for this fork and compatible versions/);
  assert.equal(r.queryByText(`Review compatible versions ${releaseId.slice(0,8)}`),null);
 }finally{r.cleanup();}
});
