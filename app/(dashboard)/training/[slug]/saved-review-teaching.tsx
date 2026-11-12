'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {TrainingDialog as Modal} from './training-workspace';
import {guidedTrainingChanges,type TrainingChangeRecord} from '@/lib/guided-training-changes';
import {trainingReviewMarkRecord,type TrainingReviewMarkRecord} from '@/lib/training-review-mark';

/** Frozen approved history, with the existing explicit withdrawal action only. */
export default function SavedReviewTeaching({sessionId,versionId,target,onClose,slug,onChanged}:{sessionId:string;versionId:string;target:TrainingChangeRecord|null;onClose:()=>void;slug:string;onChanged?:()=>void}){
 const identity=target?`${sessionId}:${versionId}:${target.recordId}:${target.recordDigest}:${target.reviewMark?.acknowledgmentId||''}`:'',latest=useRef(identity);latest.current=identity;
 const [result,setResult]=useState<{identity:string;value:TrainingReviewMarkRecord}|null>(null),[failure,setFailure]=useState<{identity:string;text:string}|null>(null),[retry,setRetry]=useState(0);
 const intents=useRef(new Map<string,string>()),[withdrawals,setWithdrawals]=useState<Record<string,{status:'pending'|'withdrawn'|'unavailable'|'uncertain';text:string}>>({});
 const setWithdrawal=(captured:string,status:'pending'|'withdrawn'|'unavailable'|'uncertain',text:string)=>setWithdrawals(previous=>({...previous,[captured]:{status,text}}));
 async function checkWithdrawal(captured:string,recordId:string,recordDigest:string){
  try{const response=await fetch(`/api/agent-training/changes?${new URLSearchParams({sessionId})}`,{cache:'no-store'}),value=await response.json();
   if(response.ok&&guidedTrainingChanges(value,{sessionId,workflowVersionId:versionId})&&value.records.some(record=>record.recordId===recordId&&record.recordDigest===recordDigest&&['discarded','revoked'].includes(record.state))){
    setWithdrawal(captured,'unavailable','This teaching is no longer usable. Its original feedback is kept in your history.');if(latest.current===captured)onChanged?.();return;
   }
  }catch{}
  setWithdrawal(captured,'uncertain','We could not confirm withdrawal. Refresh its status before making another change.');if(latest.current===captured)onChanged?.();
 }
 async function withdraw(){
  if(!target||!value||intents.current.has(identity))return;const captured=identity,recordId=target.recordId,recordDigest=target.recordDigest,key=crypto.randomUUID();intents.current.set(captured,key);
  setWithdrawal(captured,'pending','Withdrawing this teaching…');
  try{const response=await fetch(`/api/agent-training/review-mark-record?${new URLSearchParams({sessionId})}`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify({action:'discard',recordId,expectedRecordDigest:recordDigest}),cache:'no-store'}),receipt=await response.json();
   if(response.ok&&receipt?.ok===true&&Object.keys(receipt).length===5&&typeof receipt.created==='boolean'&&receipt.recordId===recordId&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(receipt.eventId||'')&&receipt.action==='discard'){
    setWithdrawal(captured,'withdrawn','Teaching withdrawn. Your original feedback stays in your history.');if(latest.current===captured)onChanged?.();return;
   }
  }catch{}
  await checkWithdrawal(captured,recordId,recordDigest);
 }
 useEffect(()=>{
  if(!target){setResult(null);setFailure(null);return;}const controller=new AbortController(),captured=identity;setResult(null);setFailure(null);
  if(!target.reviewMark||target.sourceKind!=='legacy_evidence'){setFailure({identity:captured,text:'This saved teaching is unavailable. Its original history is preserved.'});return;}
  void(async()=>{try{
   const response=await fetch(`/api/agent-training/review-mark-record?${new URLSearchParams({sessionId,recordId:target.recordId,expectedRecordDigest:target.recordDigest})}`,{cache:'no-store',signal:controller.signal});
   const value=await response.json();if(controller.signal.aborted||latest.current!==captured)return;
   if(!response.ok||!trainingReviewMarkRecord(value,{recordId:target.recordId,recordDigest:target.recordDigest})){
    const text=value?.reason==='teaching_changed'?'This teaching changed. Close this panel and review the latest saved lesson.':value?.reason==='training_review_record_not_found'?'This saved teaching is unavailable for this agent.': 'The approved teaching could not be loaded. Your training is unchanged.';
    setFailure({identity:captured,text});return;
   }setResult({identity:captured,value});
  }catch{if(!controller.signal.aborted&&latest.current===captured)setFailure({identity:captured,text:'The approved teaching could not be loaded. Your training is unchanged.'});}})();
  return()=>controller.abort();
 },[identity,retry]);
 const value=result?.identity===identity?result.value:null,error=failure?.identity===identity?failure.text:null;
 const withdrawal=withdrawals[identity];
 const relation:Record<string,string>={accepted:'Keep this',rejected:'Avoid this',contrast:'Use as a contrast',exception:'Use as an exception'};
 return <Modal open={target!==null} onClose={onClose} title="Saved teaching" maxWidth="max-w-2xl">
  {withdrawal?<div role="status" className="space-y-3 text-sm text-ink-300"><p>{withdrawal.text}</p>{withdrawal.status==='uncertain'&&<button type="button" className="underline underline-offset-4" onClick={()=>{if(target){setWithdrawal(identity,'pending','Checking saved status…');void checkWithdrawal(identity,target.recordId,target.recordDigest);}}}>Refresh status</button>}</div>:value?<section className="space-y-5" aria-label="Approved teaching">
   <p className="text-base leading-7 text-ink-100">{value.fields.why}</p>
   <p className="text-xs text-ink-400">{relation[value.relation]} · {value.properties.map(property=>property.replaceAll('_',' ')).join(', ')}</p>
   <div className="text-sm leading-6"><h3 className="font-medium text-ink-200">Applies when</h3><p className="mt-1 text-ink-400">{value.fields.process}</p></div>
   <div className="text-sm leading-6"><h3 className="font-medium text-ink-200">Application to new work</h3><p className="mt-1 text-ink-400">{value.fields.desiredBehavior}</p></div>
   <p className="text-xs text-ink-500">Teaching uses the note as you approved it.</p>
   <details className="text-sm leading-6 text-ink-400"><summary className="cursor-pointer">Original example &amp; feedback</summary><p className="mt-3 whitespace-pre-wrap">{value.fields.chosen}</p><p className="mt-3 text-xs text-ink-500">Original saved {value.sourceMark.purpose==='training'?'training note':'review note'}</p><p className="mt-1 whitespace-pre-wrap">{value.sourceMark.body}</p><p className="mt-3 text-xs text-ink-500">Approved {new Date(value.appliedAt).toLocaleDateString()}</p></details>
   <Link href={`/training/${encodeURIComponent(slug)}/review/${encodeURIComponent(value.runId)}`} className="inline-block text-sm text-ink-300 underline underline-offset-4">View current mark →</Link><p className="text-xs text-ink-500">The current mark may have changed since this teaching was approved.</p>
   <div className="border-t border-ink-800 pt-4"><button type="button" onClick={()=>void withdraw()} className="text-sm text-ink-300 underline underline-offset-4">Withdraw teaching</button><p className="mt-2 text-xs text-ink-500">Stops this teaching from being used. Keeps its original feedback.</p></div>
  </section>:error?<div role="alert" className="space-y-3 text-sm text-ink-300"><p>{error}</p><button type="button" className="underline underline-offset-4" onClick={()=>setRetry(count=>count+1)}>Try again</button></div>:<p role="status" className="py-8 text-sm text-ink-400">Opening your approved teaching…</p>}
 </Modal>;
}
