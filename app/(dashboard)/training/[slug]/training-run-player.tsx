'use client';

import {useEffect,useState,type ReactNode} from 'react';
import ReviewRoom,{type ReviewRoomProps} from '../../_components/review-room';
import type {ReviewArtifact,ReviewIssue} from '@/lib/review';

/** Same Review Room player and issue writer, without the operational report page. */
export default function TrainingRunPlayer({slug,runId,ownerId,onTeach,onDirtyChange,renderVoiceNote}:{
  slug:string;runId:string;ownerId?:string;onTeach:(issue:ReviewIssue,artifact:ReviewArtifact)=>void;
  onDirtyChange:(dirty:boolean)=>void;renderVoiceNote?:ReviewRoomProps['renderVoiceNote'];
}){
  const [review,setReview]=useState<ReviewRoomProps|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setReview(null);setError('');
    void (async()=>{try{
      const response=await fetch(`/api/agent-training/run-review?${new URLSearchParams({slug,runId})}`,{cache:'no-store',signal:controller.signal});
      const value=await response.json();if(controller.signal.aborted)return;
      if(!response.ok||value.ok!==true||value.contractVersion!=='training-run-review.v1'||value.review?.runId!==runId||value.review?.trainingSlug!==slug)
        throw Error('This result could not be opened. Your saved feedback is unchanged.');
      setReview(value.review);
    }catch(caught){if(!controller.signal.aborted)setError(caught instanceof Error?caught.message:'Result unavailable.');}})();
    return()=>controller.abort();
  },[slug,runId,retry]);
  return <section id="training-run-player" aria-label="Teach from a result" className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-medium">What would you improve?</h2><span className="text-xs text-ink-500">Recent result</span></div>
    {error?<div role="alert" className="rounded-xl border border-amber-800 p-4 text-sm text-ink-300">{error}<button type="button" className="ml-3 underline" onClick={()=>setRetry(value=>value+1)}>Try again</button></div>
      :review?<ReviewRoom key={runId} {...review} trainingMode trainingOwnerId={ownerId} onTeachIssue={onTeach} onDirtyChange={onDirtyChange} renderVoiceNote={renderVoiceNote}/>
      :<p role="status" className="py-12 text-center text-sm text-ink-400">Opening your result…</p>}
  </section>;
}
