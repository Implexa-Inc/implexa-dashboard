'use client';

import {useEffect,useRef,useState} from 'react';
import Modal from '../../_components/modal';
import TrainingDraftBundle from './training-draft-bundle';
import type {ReviewArtifact,ReviewIssue} from '@/lib/review';
import {deriveTrainingStages,type TrainingPropertyCode} from '@/lib/training-local-ingress';
import {teachingDigest,TEACHING_FIELDS,type TeachingFields} from '@/lib/training-teaching-draft';
import {guidedTrainingChanges} from '@/lib/guided-training-changes';
import {reviewMarkApplied,reviewMarkContext,reviewMarkFrame,reviewMarkSuggestion,sameReviewMarkBinding,type ReviewMarkContext,type ReviewMarkSuggestion} from '@/lib/training-review-mark';

export type RunMarkRequest={issue:ReviewIssue;artifact:ReviewArtifact};
type Journal={version:1;sourceId?:string;phase:'prepared'|'drafting'|'ready'|'applying'|'applied';context?:ReviewMarkContext;suggestion?:ReviewMarkSuggestion;
 ownerRelationOverride?:'accepted'|'rejected';fields?:TeachingFields;retentionUntil?:string;applyKey?:string;receipt?:{recordId:string;recordDigest:string}};
type Proposal={request:RunMarkRequest;key:string;journal:Journal;error?:string};
const PREFIX='implexa:review-mark-draft:v1:';
const fieldLabels={chosen:'Example details',why:'General judgment',process:'Applies when',desiredBehavior:'For new work'};
const noteIdentity=(ownerId:string,sessionId:string,currentVersionId:string,slug:string,request:RunMarkRequest)=>JSON.stringify({ownerId,sessionId,currentVersionId,slug,issueId:request.issue.id,body:request.issue.body,anchor:request.issue.anchor,artifactId:request.artifact.id,sha256:request.artifact.sha256});
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
 if(value?.reason==='teaching_suggestion_rate_limited')return `Drafting is busy. Try again in ${Number.isSafeInteger(value.retryAfter)?value.retryAfter:60} seconds. Your notes are saved.`;
 if(value?.reason==='idempotency_key_conflict')return 'A different proposal is already saved for this note. Review it before applying again.';
 return 'This teaching could not be confirmed. Your original note and any saved training are preserved.';
}
const supported=(entry:Proposal)=>entry.journal.suggestion?.status==='suggested'&&!!entry.journal.fields&&!!entry.journal.suggestion.scopeSuggestion&&['accepted','rejected'].includes(entry.journal.suggestion.scopeSuggestion.relation);
const effectiveRelation=(entry:Proposal)=>entry.journal.ownerRelationOverride||entry.journal.suggestion?.scopeSuggestion?.relation||'';
const relationText=(value:string)=>value==='accepted'?'keep this example':value==='rejected'?'avoid this example':value;

async function markedEvidence({ownerId,sessionId,currentVersionId,request,sourceId}:{ownerId:string;sessionId:string;currentVersionId:string;request:RunMarkRequest;sourceId:string}){
 const bridge=(window as unknown as {implexaDesktop?:{trainingReviewMarkContractVersion?:string;trainingLocal:(operation:string,args:unknown)=>Promise<any>}}).implexaDesktop;
 if(!bridge?.trainingLocal||bridge.trainingReviewMarkContractVersion!=='1')throw Error('Open Training in an updated Implexa Desktop to use the saved frames.');
 const native=await bridge.trainingLocal('readReviewMarkEvidence',{sessionId,sourceId,reviewSessionId:request.issue.sessionId,issueId:request.issue.id,expectedOwnerId:ownerId});
 const expected={sourceId,reviewSessionId:request.issue.sessionId,issueId:request.issue.id,versionId:currentVersionId,runId:request.issue.runId,artifactId:request.artifact.id,artifactSha256:request.artifact.sha256||'',feedback:request.issue.body},image=native?.image;
 if(native?.contractVersion!=='training-review-mark-evidence.v1'||!reviewMarkContext(native,expected)||await teachingDigest(reviewMarkFrame(image,native.evidence))!==native.evidence.sha256)throw Error('The saved frame or teaching note changed. Reopen the note before extracting training.');
 const context:ReviewMarkContext={ok:true,contractVersion:native.contractVersion,binding:native.binding,evidence:native.evidence,feedback:native.feedback,source:native.source};
 return {context,image:image as string};
}
let frameQueue:Promise<void>=Promise.resolve();
/** Read the exact saved PNG only while its card/summary is visible; no batch image blob. */
function MarkedEvidenceImage({entry,ownerId,sessionId,currentVersionId}:{entry:Proposal;ownerId:string;sessionId:string;currentVersionId:string}){
 const ref=useRef<HTMLSpanElement|null>(null),[visible,setVisible]=useState(false),[image,setImage]=useState(''),[unavailable,setUnavailable]=useState(false);
 const identity=`${ownerId}:${sessionId}:${currentVersionId}:${entry.journal.context?.binding.evidenceSha256}:${entry.request.issue.id}`;
 useEffect(()=>{if(!ref.current)return;if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}const observer=new IntersectionObserver(items=>setVisible(items.some(item=>item.isIntersecting)),{rootMargin:'100px'});observer.observe(ref.current);return()=>observer.disconnect();},[identity]);
 useEffect(()=>{let live=true;setImage('');setUnavailable(false);if(visible&&entry.journal.sourceId&&entry.journal.context)frameQueue=frameQueue.then(async()=>{if(!live)return;try{
  const result=await markedEvidence({ownerId,sessionId,currentVersionId,request:entry.request,sourceId:entry.journal.sourceId!});if(!sameReviewMarkBinding(result.context.binding,entry.journal.context!.binding))throw Error('changed');if(live)setImage(result.image);
 }catch{if(live)setUnavailable(true);}});return()=>{live=false;};},[visible,identity]);
 return <span ref={ref} className="inline-flex min-h-20 w-36 max-w-[50%] shrink-0 items-center justify-center">{image?<img src={image} alt="Exact marked result used for this lesson" className="max-h-32 rounded-lg object-contain"/>:<span className="text-xs text-ink-500">{unavailable?'Example unavailable':'Loading example…'}</span>}</span>;
}

/** One consent and review bundle over the existing per-mark prior-work writers. */
export default function RunMarkTraining({sessionId,currentVersionId,ownerId,slug,requests,onClose,onApplied,onScopeCheck}:{
 sessionId:string;currentVersionId:string;ownerId:string;slug:string;requests:RunMarkRequest[]|null;
 onClose:()=>void;onApplied:()=>void|Promise<void>;onScopeCheck:()=>void|Promise<void>;
}){
 const proposalRef=useRef<HTMLElement|null>(null),active=useRef(''),generation=useRef(0),flight=useRef(false),pause=useRef(false);
 const [busy,setBusy]=useState(false),[extracting,setExtracting]=useState(false),[error,setError]=useState(''),[entries,setEntries]=useState<Proposal[]>([]),[consented,setConsented]=useState(false),[editingId,setEditingId]=useState<string|null>(null),[note,setNote]=useState(''),[nextIndex,setNextIndex]=useState(0);
 const entriesRef=useRef(entries);entriesRef.current=entries;
 const identity=JSON.stringify({ownerId,sessionId,currentVersionId,slug,notes:requests?.map(request=>noteIdentity(ownerId,sessionId,currentVersionId,slug,request))});active.current=identity;
 function publish(next:Proposal[]){entriesRef.current=next;setEntries(next);}
 function update(entry:Proposal){publish([...entriesRef.current.filter(item=>item.request.issue.id!==entry.request.issue.id),entry]);}
 useEffect(()=>{generation.current++;setBusy(false);setExtracting(false);setError('');publish([]);setConsented(false);setEditingId(null);setNote('');setNextIndex(0);pause.current=false;},[identity]);
 useEffect(()=>{if(!consented||!entries.length)return;proposalRef.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'});proposalRef.current?.focus();},[consented,entries.length]);
 async function checked(expected:string){if(active.current!==expected)throw Error('The selected teaching changed.');await onScopeCheck();if(active.current!==expected)throw Error('The selected teaching changed.');}
 async function post(operation:'source'|'apply',body:unknown,key?:string){
  const response=await fetch(`/api/agent-training/review-mark?${new URLSearchParams({sessionId,operation})}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok||value.ok!==true)throw Error(failure(value));return value;
 }
 async function extractOne(selected:RunMarkRequest,key:string,expected:string):Promise<Proposal>{
  const saved=readJournal(key);
  if(!saved.sourceId){const source=await post('source',{runId:selected.issue.runId,artifactId:selected.artifact.id});await checked(expected);if(typeof source.sourceId!=='string')throw Error('The original result could not be linked for teaching.');saved.sourceId=source.sourceId;writeJournal(key,saved);}
  const {context,image}=await markedEvidence({ownerId,sessionId,currentVersionId,request:selected,sourceId:saved.sourceId!});await checked(expected);
  if(saved.context&&!sameReviewMarkBinding(context.binding,saved.context.binding))throw Error('This note changed since its proposal was saved. Reopen its current version.');saved.context=context;
  if(saved.phase==='drafting')return {request:selected,key,journal:saved,error:'Drafting was interrupted before its response was saved. This note will not be sent again automatically; review it before requesting another proposal.'};
  if(saved.suggestion){if(!reviewMarkSuggestion(saved.suggestion,context.binding))throw Error('The saved proposal does not match this note.');}
  else{
   saved.phase='drafting';writeJournal(key,saved);
   const response=await fetch(`/api/agent-training/teaching-suggestion?${new URLSearchParams({sessionId,operation:'review-mark'})}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...context.binding,mode:'review-mark',image,consent:true})});
   const value=await response.json();await checked(expected);
   if(!response.ok||value.ok!==true){if(value.reason==='teaching_suggestion_rate_limited'){saved.phase='prepared';writeJournal(key,saved);}throw Error(failure(value));}
   if(!reviewMarkSuggestion(value,context.binding))throw Error('The proposed lesson did not match this note and frame.');
   saved.suggestion=value;saved.fields=value.fields||undefined;saved.phase='ready';const retention=new Date();retention.setUTCFullYear(retention.getUTCFullYear()+1);retention.setUTCMilliseconds(0);saved.retentionUntil=retention.toISOString();writeJournal(key,saved);
  }
  if(saved.phase==='applied'){
   const response=await fetch(`/api/agent-training/changes?sessionId=${encodeURIComponent(sessionId)}`,{cache:'no-store'}),current=await response.json();await checked(expected);
   if(!response.ok||!guidedTrainingChanges(current,{sessionId,workflowVersionId:currentVersionId})||!saved.receipt||!current.records.some(record=>record.recordId===saved.receipt!.recordId&&record.recordDigest===saved.receipt!.recordDigest&&record.included))throw Error('This lesson’s current saved status could not be confirmed. Open saved training before applying anything else.');
  }
  return {request:selected,key,journal:saved};
 }
 async function extract(){
  if(!requests?.length||flight.current)return;
  if(new Set(requests.map(request=>request.issue.id)).size!==requests.length||requests.some(selected=>selected.issue.artifactId!==selected.artifact.id||selected.issue.runId!==selected.artifact.runId||selected.issue.status==='dismissed'||selected.artifact.status!=='validated'||!selected.artifact.sha256))return;
  const expected=identity,epoch=generation.current;flight.current=true;pause.current=false;setBusy(true);setExtracting(true);setConsented(true);setError('');
  try{for(let index=nextIndex;index<requests.length;index++){
   await checked(expected);const selected=requests[index],fingerprint=await teachingDigest(new TextEncoder().encode(noteIdentity(ownerId,sessionId,currentVersionId,slug,selected))),key=`${PREFIX}${ownerId}:${sessionId}:${currentVersionId}:${fingerprint}`;
   setNote(`Finding the lesson in note ${index+1} of ${requests.length}…`);
   try{const entry=await extractOne(selected,key,expected);await checked(expected);update(entry);setNextIndex(index+1);}
   catch(caught){if(active.current!==expected)throw caught;let saved:Journal;try{saved=readJournal(key);}catch{saved={version:1,phase:'prepared'};}update({request:selected,key,journal:saved,error:caught instanceof Error?caught.message:'This note could not be analyzed.'});setNextIndex(saved.phase==='drafting'?index+1:index);throw caught;}
   if(pause.current&&index+1<requests.length){setNote('Extraction paused. Your saved notes and proposed lessons are preserved.');return;}
  }setNote('Your proposed lessons are ready to review. Nothing is live yet.');}
  catch(caught){if(active.current===expected&&generation.current===epoch){setError(caught instanceof Error?caught.message:'Teaching unavailable.');setNote('Completed proposals are preserved. Remaining notes can be resumed.');}}
  finally{flight.current=false;if(active.current===expected&&generation.current===epoch){setBusy(false);setExtracting(false);}}
 }
 async function applySelected(ids:string[]){
  if(flight.current||!ids.length||new Set(ids).size!==ids.length)return;
  const selected=ids.map(id=>entriesRef.current.find(entry=>entry.request.issue.id===id));
  if(selected.some(entry=>!entry||!supported(entry)||!['ready','applying'].includes(entry.journal.phase)))return;
  const expected=identity,epoch=generation.current;flight.current=true;setBusy(true);setError('');setNote('Saving selected training…');let completed=0;
  try{for(const entry of selected as Proposal[]){
   await checked(expected);const saved=entry.journal,fields=saved.fields!,scope=saved.suggestion!.scopeSuggestion!,relation=effectiveRelation(entry);
   if(!['accepted','rejected'].includes(relation)||TEACHING_FIELDS.some(field=>!fields[field].trim()||fields[field].length>400))throw Error('Review this example’s use and keep each teaching field between 1 and 400 characters.');
   const body={...saved.context!.binding,fields,property:scope.property,relation,stages:deriveTrainingStages(scope.property as TrainingPropertyCode),retentionUntil:saved.retentionUntil,consent:true},applyKey=await teachingDigest(new TextEncoder().encode(JSON.stringify(body)));
   if(saved.applyKey&&saved.applyKey!==applyKey)throw Error('A previous Apply is awaiting confirmation. Retry its unchanged proposal.');
   const next={...saved,phase:'applying' as const,applyKey};writeJournal(entry.key,next);update({...entry,journal:next});
   const result=await post('apply',body,`review-mark:${applyKey}`);await checked(expected);if(!reviewMarkApplied(result))throw Error('The saved teaching could not be confirmed. Retry this exact proposal.');
   const applied={...next,phase:'applied' as const,receipt:{recordId:result.recordId,recordDigest:result.recordDigest}};writeJournal(entry.key,applied);update({...entry,journal:applied});completed++;
  }setNote(`${completed} lesson${completed===1?'':'s'} saved. Test this update before making it live.`);}
  catch(caught){if(active.current===expected&&generation.current===epoch){setError(caught instanceof Error?caught.message:'Teaching could not be confirmed.');setNote(`${completed} of ${selected.length} selected lessons confirmed saved. Remaining proposals are preserved.`);}}
  finally{if(completed&&active.current===expected)try{await onApplied();}catch{setError('Training was saved, but its refreshed status could not be loaded.');}flight.current=false;if(active.current===expected&&generation.current===epoch)setBusy(false);}
 }
 function edit(entry:Proposal,patch:Partial<Journal>){if(busy||entry.journal.phase==='applying')return;const next={...entry.journal,...patch};writeJournal(entry.key,next);update({...entry,journal:next});}
 const close=()=>{if(!busy)onClose();},pending=entries.filter(entry=>entry.journal.phase!=='applied'&&supported(entry)&&!entry.error),held=entries.filter(entry=>entry.journal.phase!=='applied'&&(!supported(entry)||!!entry.error)),editing=pending.find(entry=>entry.request.issue.id===editingId);
 if(!requests?.length)return null;
 return <>
 <Modal open={!consented} onClose={close} title={requests.length===1?'Extract training from this note?':`Extract training from ${requests.length} notes?`} maxWidth="max-w-3xl">
  <p className="text-sm leading-6 text-ink-300">Implexa will use your saved notes and their marked frames to suggest reusable lessons.</p><details className="mt-3 text-xs leading-5 text-ink-500"><summary className="cursor-pointer">What gets analyzed</summary><p className="mt-2">These {requests.length} saved note{requests.length===1?'':'s'} and one saved image per note go to Claude Haiku 5.5, separately. Applying lessons approves these examples for training; it leaves the video’s acceptance and revision unchanged.</p></details><button type="button" className="btn-primary mt-5" disabled={busy} onClick={()=>void extract()}>Extract training</button>
 </Modal>
 {consented&&<section ref={proposalRef} tabIndex={-1} aria-label="Lessons from your marked result" className="space-y-4 outline-none"><div className="flex justify-end"><button type="button" disabled={busy} onClick={close} className="text-xs text-ink-400 underline">Close proposals</button></div>
  {note&&<p role="status" className="text-sm leading-6 text-ink-300">{note}</p>}
  {editing&&<div className="mb-4 grid gap-3 rounded-xl border border-ink-700 p-4">{editing.journal.ownerRelationOverride&&<p className="text-xs leading-5 text-ink-400">Implexa suggested: {relationText(editing.journal.suggestion!.scopeSuggestion!.relation)}. You changed it to: <strong className="text-ink-200">{relationText(editing.journal.ownerRelationOverride)}</strong>.</p>}<label className="text-xs text-ink-400">How to use this example<select aria-label="How to use this example" value={effectiveRelation(editing)} disabled={busy||editing.journal.phase==='applying'} className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm text-ink-100" onChange={event=>{const value=event.target.value;if(value==='accepted'||value==='rejected')edit(editing,{ownerRelationOverride:value===editing.journal.suggestion!.scopeSuggestion!.relation?undefined:value});}}><option value="accepted">Keep this example</option><option value="rejected">Avoid this example</option></select></label>{TEACHING_FIELDS.map(field=><label key={field} className="text-xs text-ink-400">{fieldLabels[field]}<textarea className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm text-ink-100" value={editing.journal.fields![field]} maxLength={400} disabled={busy||editing.journal.phase==='applying'} onChange={event=>edit(editing,{fields:{...editing.journal.fields!,[field]:event.target.value}})}/></label>)}</div>}
  <TrainingDraftBundle drafts={pending.map(entry=>{const saved=entry.journal,fields=saved.fields!,scope=saved.suggestion!.scopeSuggestion!;return {id:entry.request.issue.id,digest:JSON.stringify({fields,binding:saved.context?.binding}),judgment:fields.why,appliesWhen:fields.process,example:fields.chosen,category:scope.property.replaceAll('_',' '),relation:effectiveRelation(entry),relationOrigin:saved.ownerRelationOverride?'owner' as const:'model' as const,renderEvidence:<MarkedEvidenceImage entry={entry} ownerId={ownerId} sessionId={sessionId} currentVersionId={currentVersionId}/>};})} busy={busy} onApply={ids=>void applySelected(ids)} onEdit={id=>setEditingId(value=>value===id?null:id)}/>
  {held.length>0&&<details className="rounded-xl border border-amber-800/60 p-4 text-sm"><summary className="cursor-pointer">Needs clarification ({held.length})</summary>{held.map(entry=><div key={entry.request.issue.id} className="mt-4 space-y-2"><p>{entry.request.issue.body}</p><p className="text-xs text-ink-400">{entry.error||entry.journal.suggestion?.reason||'This example needs its category or use clarified before it can be applied. Edit its saved note, then extract again.'}</p></div>)}</details>}
  {error&&<p role="alert" className="text-sm leading-6 text-amber-300">{error}</p>}
  {extracting?<button type="button" className="text-xs text-ink-400 underline" onClick={()=>{pause.current=true;}}>Pause after this note</button>:!busy&&nextIndex<requests.length&&<button type="button" className="text-sm text-brand-400" onClick={()=>void extract()}>Resume extraction</button>}
  {!busy&&pending.some(entry=>entry.journal.phase==='applying')&&<button type="button" className="text-sm text-brand-400" onClick={()=>void applySelected(pending.filter(entry=>entry.journal.phase==='applying').map(entry=>entry.request.issue.id))}>Confirm pending Apply</button>}
 </section>}
 </>;
}
