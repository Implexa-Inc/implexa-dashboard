'use client';

import {useEffect,useRef,useState} from 'react';
import {annotationGapPage,type AnnotationGapAnalysis,type AnnotationGapPage} from '@/lib/training-teaching-draft';
import ImproveAgent from '../../_components/improve-agent';
import {TrainingDialog} from './training-workspace';

/** Canonical annotation results survive taste acceptance and the local extraction journal. */
export default function TrainingOperatingChanges({sessionId,versionId,slug,refreshKey,disabled=false}:{sessionId:string;versionId:string;slug:string;refreshKey:number;disabled?:boolean}){
 const [page,setPage]=useState<AnnotationGapPage|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [review,setReview]=useState<AnnotationGapAnalysis|null>(null);
 const identity=`${sessionId}:${versionId}`,current=useRef(identity),sequence=useRef(0);current.current=identity;
 async function load(append=false,signal?:AbortSignal){
  const captured=identity,read=++sequence.current;setBusy(true);
  const cursor=append?page?.nextCursor:null;
  const q=new URLSearchParams({sessionId,limit:'20',...(cursor||{})});
  try{const response=await fetch(`/api/agent-training/annotation-gap-edit?${q}`,{cache:'no-store',signal});const value=await response.json();
   if(signal?.aborted||current.current!==captured||sequence.current!==read)return;
   if(!response.ok||!annotationGapPage(value,versionId))throw Error('Agent improvement suggestions could not be loaded.');
   setPage(previous=>append&&previous?{...value,analyses:[...previous.analyses,...value.analyses.filter(a=>!previous.analyses.some(b=>b.analysisRequest.requestEventId===a.analysisRequest.requestEventId))]}:value);setError('');
  }catch{if(!signal?.aborted&&current.current===captured&&sequence.current===read)setError('Agent improvement suggestions could not be loaded. Your feedback is saved.');}
  finally{if(current.current===captured&&sequence.current===read)setBusy(false);}
 }
 useEffect(()=>{setPage(null);setReview(null);setError('');const controller=new AbortController();void load(false,controller.signal);return()=>controller.abort();},[identity,refreshKey]);
 async function dismiss(a:AnnotationGapAnalysis){
  const r=a.result;if(!r||busy||disabled)return;const captured=identity;setBusy(true);
  try{const response=await fetch(`/api/agent-training/annotation-gap-edit?sessionId=${encodeURIComponent(sessionId)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'dismiss',analysisResultEventId:r.analysisReceipt.resultEventId,analysisResultDigest:r.analysisReceipt.resultDigest})});const value=await response.json();
   if(current.current!==captured)return;if(!response.ok||value?.ok!==true||value.application!=='dismissed')throw Error();await load();
  }catch{if(current.current===captured)setError('Could not confirm dismissal. Refresh suggestions before trying again.');}
  finally{if(current.current===captured)setBusy(false);}
 }
 const visible=page?.analyses.filter(a=>a.outcome!=='answered'||!['dismissed','not_applicable'].includes(a.edit.state)&&a.result?.operatingGap?.status!=='present')||[];
 if(!visible.length&&!error&&!page?.nextCursor)return null;
 const r=review?.result,target=r?.analysisReceipt.target;
 return <section className="space-y-3" aria-label="Suggested agent improvements">
  <h3 className="text-base font-medium">Suggested agent improvements</h3>
  {visible.map(a=>{const g=a.result?.operatingGap,queued=a.edit.state==='queued',available=a.edit.state==='available';return <article className="rounded-xl border border-ink-700 p-4 space-y-2" key={a.analysisRequest.requestEventId}>
   <h4 className="font-medium">{queued?'Agent update queued':g?.kind==='tool'?'Tool capability to review':g?.status==='suggested'?'Update an agent step':a.outcome==='pending'?'Checking your agent setup':'Agent setup needs another look'}</h4>
   {g?.genericDelta&&<p className="text-sm whitespace-pre-wrap">{g.genericDelta}</p>}
   <p className="text-xs text-ink-400">{queued?'The current version stays active until the update succeeds.':g?.kind==='tool'?'This needs a tool and method review before it can be added.':available?'Your feedback suggests a setup change as well as training. Review it before applying.':a.edit.state==='stale'?'The agent has changed. Analyze feedback against its current setup before editing.':a.outcome==='pending'?'Refresh to check the saved result. No new analysis will start.':'Your feedback is saved. Reopen the example to review or retry its analysis.'}</p>
   <div className="flex gap-3">
    {available&&<button className="btn-outline" disabled={busy||disabled} onClick={()=>setReview(a)}>Review agent update</button>}
    {!queued&&a.result&&<button className="text-xs text-ink-400" disabled={busy||disabled} onClick={()=>void dismiss(a)}>Dismiss suggestion</button>}
   </div>
  </article>;})}
  {error&&<p role="status" className="text-sm text-amber-400">{error}</p>}
  <button disabled={busy||disabled} onClick={()=>void load()} className="text-xs text-ink-400">Refresh suggestions</button>
  {page?.nextCursor&&<button disabled={busy||disabled} onClick={()=>void load(true)} className="text-xs text-ink-400 ml-3">More suggestions</button>}
  <TrainingDialog open={!!r&&!!target} title="Review agent update" onClose={()=>setReview(null)}>
   {r&&target&&<ImproveAgent key={r.analysisReceipt.resultEventId} bare slug={slug} initialNote={r.operatingGap?.genericDelta||''} statusUnavailable={disabled}
    annotationBinding={{sessionId,analysisResultEventId:r.analysisReceipt.resultEventId,analysisResultDigest:r.analysisReceipt.resultDigest,expectedActiveVersionId:versionId,stepOrder:target.stepOrder,stepDigest:target.stepDigest}}
    onQueued={()=>void load()}/>}
  </TrainingDialog>
 </section>;
}
