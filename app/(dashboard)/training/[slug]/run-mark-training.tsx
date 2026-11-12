'use client';

import {useEffect,useRef,useState} from 'react';
import Modal from '../../_components/modal';
import TrainingDraftBundle from './training-draft-bundle';
import type {ReviewArtifact,ReviewIssue} from '@/lib/review';
import {deriveTrainingStages,type TrainingPropertyCode} from '@/lib/training-local-ingress';
import {teachingDigest,TEACHING_FIELDS,type TeachingFields} from '@/lib/training-teaching-draft';
import {guidedTrainingChanges} from '@/lib/guided-training-changes';
import {reviewMarkApplied,reviewMarkContext,reviewMarkFrame,reviewMarkSuggestion,sameReviewMarkBinding,type ReviewMarkContext,type ReviewMarkSuggestion} from '@/lib/training-review-mark';

type Request={issue:ReviewIssue;artifact:ReviewArtifact};
type Journal={version:1;sourceId?:string;phase:'prepared'|'drafting'|'ready'|'applying'|'applied';context?:ReviewMarkContext;suggestion?:ReviewMarkSuggestion;
 fields?:TeachingFields;retentionUntil?:string;applyKey?:string;receipt?:{recordId:string;recordDigest:string}};
const PREFIX='implexa:review-mark-draft:v1:';
const fieldLabels={chosen:'Example details',why:'General judgment',process:'Applies when',desiredBehavior:'For new work'};
function readJournal(key:string):Journal{
 const raw=window.localStorage.getItem(key);if(!raw)return {version:1,phase:'prepared'};
 try{const value=JSON.parse(raw);if(value.version===1&&['prepared','drafting','ready','applying','applied'].includes(value.phase))return value;}catch{}
 throw Error('This saved proposal needs recovery. Your original teaching note is preserved.');
}
function writeJournal(key:string,value:Journal){
 const json=JSON.stringify(value);if(json.length>20000)throw Error('This proposal could not be saved for recovery.');
 try{window.localStorage.setItem(key,json);}catch{throw Error('Implexa could not save this proposal for recovery. Your original note stays saved.');}
}
function failure(value:any){
 if(value?.reason==='teaching_suggestion_rate_limited')return `Drafting is busy. Try again in ${Number.isSafeInteger(value.retryAfter)?value.retryAfter:60} seconds. Your note is saved.`;
 if(value?.reason==='idempotency_key_conflict')return 'A different proposal is already saved for this note. Review it before applying again.';
 return 'This teaching could not be confirmed. Your original note and any saved training are preserved.';
}

/** One marked run frame through canonical prior-work teaching. Never result acceptance. */
export default function RunMarkTraining({sessionId,currentVersionId,ownerId,slug,request,onClose,onApplied,onScopeCheck}:{
 sessionId:string;currentVersionId:string;ownerId:string;slug:string;request:Request|null;
 onClose:()=>void;onApplied:()=>void|Promise<void>;onScopeCheck:()=>void|Promise<void>;
}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[journal,setJournal]=useState<Journal|null>(null),[image,setImage]=useState(''),[editing,setEditing]=useState(false),[note,setNote]=useState('');
 const active=useRef(''),generation=useRef(0),flight=useRef(false),journalKey=useRef('');
 const identity=JSON.stringify({ownerId,sessionId,currentVersionId,slug,issueId:request?.issue.id,body:request?.issue.body,anchor:request?.issue.anchor,artifactId:request?.artifact.id,sha256:request?.artifact.sha256});
 active.current=identity;
 useEffect(()=>{generation.current++;setBusy(false);setError('');setJournal(null);setImage('');setEditing(false);setNote('');journalKey.current='';},[identity]);
 async function checked(expected:string){if(active.current!==expected)throw Error('The selected teaching changed.');await onScopeCheck();if(active.current!==expected)throw Error('The selected teaching changed.');}
 async function post(operation:'source'|'apply',body:unknown,key?:string){
  const response=await fetch(`/api/agent-training/review-mark?${new URLSearchParams({sessionId,operation})}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok||value.ok!==true)throw Error(failure(value));return value;
 }
 async function extract(){
  if(!request||flight.current)return;
  const selected=request,expected=identity,epoch=generation.current;
  if(selected.issue.artifactId!==selected.artifact.id||selected.issue.runId!==selected.artifact.runId||selected.issue.status==='dismissed'||selected.artifact.status!=='validated'||!selected.artifact.sha256)return;
  flight.current=true;setBusy(true);setError('');setNote('');
  try{
   await checked(expected);
   const fingerprint=await teachingDigest(new TextEncoder().encode(expected)),key=`${PREFIX}${ownerId}:${sessionId}:${currentVersionId}:${fingerprint}`;
   const saved=readJournal(key);journalKey.current=key;
   if(!saved.sourceId){const source=await post('source',{runId:selected.issue.runId,artifactId:selected.artifact.id});await checked(expected);
    if(typeof source.sourceId!=='string')throw Error('The original result could not be linked for teaching.');saved.sourceId=source.sourceId;writeJournal(key,saved);}
   const bridge=(window as unknown as {implexaDesktop?:{trainingReviewMarkContractVersion?:string;trainingLocal:(operation:string,args:unknown)=>Promise<any>}}).implexaDesktop;
   if(!bridge?.trainingLocal||bridge.trainingReviewMarkContractVersion!=='1')throw Error('Open Training in an updated Implexa Desktop to use the saved frame.');
   const native=await bridge.trainingLocal('readReviewMarkEvidence',{sessionId,sourceId:saved.sourceId,reviewSessionId:selected.issue.sessionId,issueId:selected.issue.id,expectedOwnerId:ownerId});
   await checked(expected);
   const expectedContext={sourceId:saved.sourceId!,reviewSessionId:selected.issue.sessionId,issueId:selected.issue.id,versionId:currentVersionId,runId:selected.issue.runId,artifactId:selected.artifact.id,artifactSha256:selected.artifact.sha256,feedback:selected.issue.body};
   const nativeImage=native?.image;
   if(native?.contractVersion!=='training-review-mark-evidence.v1'||!reviewMarkContext(native,expectedContext)||await teachingDigest(reviewMarkFrame(nativeImage,native.evidence))!==native.evidence.sha256)throw Error('The saved frame or teaching note changed. Reopen the note before extracting training.');
   if(saved.context&&!sameReviewMarkBinding(native.binding,saved.context.binding))throw Error('This note has changed since its proposal was saved. Reopen its current version.');
   const context:ReviewMarkContext={ok:true,contractVersion:native.contractVersion,binding:native.binding,evidence:native.evidence,feedback:native.feedback,source:native.source};saved.context=context;setImage(nativeImage);
   if(saved.phase==='drafting')throw Error('Drafting was interrupted before its response was saved. Your original note remains available. Review existing training before requesting another proposal.');
   if(saved.suggestion){if(!reviewMarkSuggestion(saved.suggestion,native.binding))throw Error('The saved proposal does not match this note.');}
   else{
    saved.phase='drafting';writeJournal(key,saved);
    const response=await fetch(`/api/agent-training/teaching-suggestion?${new URLSearchParams({sessionId,operation:'review-mark'})}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...native.binding,mode:'review-mark',image:nativeImage,consent:true})});
    const value=await response.json();await checked(expected);
    if(!response.ok||value.ok!==true){if(value.reason==='teaching_suggestion_rate_limited'){saved.phase='prepared';writeJournal(key,saved);}throw Error(failure(value));}
    if(!reviewMarkSuggestion(value,native.binding))throw Error('The proposed lesson did not match this note and frame.');
    saved.suggestion=value;saved.fields=value.fields||undefined;saved.phase='ready';
    const retention=new Date();retention.setUTCFullYear(retention.getUTCFullYear()+1);retention.setUTCMilliseconds(0);saved.retentionUntil=retention.toISOString();writeJournal(key,saved);
   }
   if(saved.phase==='applied'){
    const response=await fetch(`/api/agent-training/changes?sessionId=${encodeURIComponent(sessionId)}`,{cache:'no-store'}),current=await response.json();await checked(expected);
    if(!response.ok||!guidedTrainingChanges(current,{sessionId,workflowVersionId:currentVersionId})||!saved.receipt||!current.records.some(record=>record.recordId===saved.receipt!.recordId&&record.recordDigest===saved.receipt!.recordDigest&&record.included))throw Error('This lesson’s current saved status could not be confirmed. Open saved training before applying anything else.');
   }
   if(active.current===expected&&generation.current===epoch){setJournal({...saved});if(saved.phase==='applied')setNote('This lesson is saved. Test the update before making it live.');}
  }catch(caught){if(active.current===expected&&generation.current===epoch)setError(caught instanceof Error?caught.message:'Teaching unavailable.');}
  finally{flight.current=false;if(active.current===expected&&generation.current===epoch)setBusy(false);}
 }
 async function apply(){
  if(!journal?.context||!journal.suggestion?.scopeSuggestion||!journal.fields||flight.current||!['ready','applying'].includes(journal.phase))return;
  const saved=journal,scope=journal.suggestion.scopeSuggestion,expected=identity,epoch=generation.current;
  if(!['accepted','rejected'].includes(scope.relation))return;
  flight.current=true;setBusy(true);setError('');
  try{
   await checked(expected);
   const fields=saved.fields!;
   if(TEACHING_FIELDS.some(field=>!fields[field].trim()||fields[field].length>400))throw Error('Keep each teaching field between 1 and 400 characters.');
   const body={...saved.context!.binding,fields,property:scope.property,relation:scope.relation,stages:deriveTrainingStages(scope.property as TrainingPropertyCode),retentionUntil:saved.retentionUntil,consent:true};
   const applyKey=await teachingDigest(new TextEncoder().encode(JSON.stringify(body)));
   if(saved.applyKey&&saved.applyKey!==applyKey)throw Error('A previous Apply is awaiting confirmation. Retry its unchanged proposal.');
   const next={...saved,phase:'applying' as const,applyKey};writeJournal(journalKey.current,next);setJournal(next);
   const result=await post('apply',body,`review-mark:${applyKey}`);await checked(expected);
   if(!reviewMarkApplied(result))throw Error('The saved teaching could not be confirmed. Retry this exact proposal.');
   const completed={...next,phase:'applied' as const,receipt:{recordId:result.recordId,recordDigest:result.recordDigest}};writeJournal(journalKey.current,completed);setJournal(completed);setNote('Your lesson is saved. Test this update before making it live.');await onApplied();
  }catch(caught){if(active.current===expected&&generation.current===epoch)setError(caught instanceof Error?caught.message:'Teaching could not be confirmed.');}
  finally{flight.current=false;if(active.current===expected&&generation.current===epoch)setBusy(false);}
 }
 const proposal=journal?.suggestion,scope=proposal?.scopeSuggestion,fields=journal?.fields,supported=scope&&['accepted','rejected'].includes(scope.relation);
 const close=()=>{if(!busy)onClose();};
 return <Modal open={!!request} onClose={close} title={journal?'Review this lesson':'Extract training from this note?'} maxWidth="max-w-3xl">
  {!journal&&<><p className="text-sm leading-6 text-ink-300">Implexa will use your saved note and its marked frame to suggest a reusable lesson.</p><details className="mt-3 text-xs leading-5 text-ink-500"><summary className="cursor-pointer">What gets analyzed</summary><p className="mt-2">This note and its saved image go to Claude Haiku 5.5. Applying a lesson approves this example for training; it leaves the video’s acceptance and revision unchanged.</p></details><button type="button" className="btn-primary mt-5" disabled={busy} onClick={()=>void extract()}>{busy?'Finding the lesson…':'Extract training'}</button></>}
  {journal?.phase==='applied'?<p role="status" className="text-sm leading-6 text-ink-200">{note}</p>:journal&&proposal?.status==='suggested'&&fields&&scope&&supported?<>
   {editing&&<div className="mb-4 grid gap-3 rounded-xl border border-ink-700 p-4">{TEACHING_FIELDS.map(field=><label key={field} className="text-xs text-ink-400">{fieldLabels[field]}<textarea className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm text-ink-100" value={fields[field]} maxLength={400} disabled={busy||journal.phase==='applying'} onChange={event=>{const next={...journal,fields:{...fields,[field]:event.target.value}};writeJournal(journalKey.current,next);setJournal(next);}}/></label>)}</div>}
   <TrainingDraftBundle drafts={[{id:request!.issue.id,digest:JSON.stringify(fields),judgment:fields.why,appliesWhen:fields.process,example:fields.chosen,category:scope.property.replaceAll('_',' '),relation:scope.relation,renderEvidence:<img src={image} alt="Exact marked result used for this lesson" className="max-h-40 max-w-[75%] rounded-lg object-contain"/>}]} busy={busy} onApply={()=>void apply()} onEdit={()=>setEditing(value=>!value)}/>
  </>:journal&&<p role="status" className="text-sm leading-6 text-ink-300">{proposal?.reason||(!supported?'This example needs its category or use clarified before it can be applied. Edit the saved note, then extract the lesson again.':'Review this teaching before applying.')}</p>}
  {error&&<p role="alert" className="mt-4 text-sm leading-6 text-amber-300">{error}</p>}
  {journal?.phase==='applying'&&!busy&&<button type="button" className="mt-4 text-sm text-brand-400" onClick={()=>void apply()}>Confirm the same Apply</button>}
 </Modal>;
}
