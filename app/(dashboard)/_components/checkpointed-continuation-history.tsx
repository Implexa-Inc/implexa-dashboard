'use client';

import {useRef,useState} from 'react';
import Modal from './modal';
import {createClient} from '@/lib/supabase/client';
import {requestCheckpointRecovery,resumeCheckpointRecovery} from '@/lib/review-preview';

export type CheckpointedContinuationItem = {
  kind?: 'owner_preview' | 'owner_compose_revision';
  destinationRequestId?: string;
  destinationRequestStatus?: string;
  checkpointId: string;
  checkpointDigest: string;
  intentId: string;
  requestId: string;
  sourceAttemptId: string;
  sourceFence: number;
  continuationAttemptId: string | null;
  continuationFence: number | null;
  continuationNumber: number | null;
  lastCompletedStage: number;
  nextStage: number;
  materializationState: 'verified' | 'refused' | 'pending';
  attemptLifecycleState: 'process_ended' | 'process_started' | 'ended_before_process_start' | 'attempt_opened' | 'pending_attempt';
  materializationDigest: string | null;
  attemptExitClassification: string | null;
};

export type CheckpointedContinuationHistory =
  | { status: 'available'; items: CheckpointedContinuationItem[] }
  | { status: 'unavailable'; reason: string };

const short = (value: string | null) => value ? `${value.slice(0, 8)}…` : 'pending';
const materializationState = (value: CheckpointedContinuationItem['materializationState']) => ({
  verified: 'Preserved files verified',
  refused: 'Preserved-file verification refused',
  pending: 'Preserved-file verification pending',
}[value]);
const attemptState = (value: CheckpointedContinuationItem['attemptLifecycleState']) => ({
  process_ended: 'Continuation process ended',
  process_started: 'Continuation process started',
  ended_before_process_start: 'Continuation ended before process start',
  attempt_opened: 'Continuation attempt opened',
  pending_attempt: 'Waiting for the continuation attempt',
}[value]);

export default function CheckpointedContinuationHistoryCard({ history,runId }:
  { history: CheckpointedContinuationHistory;runId?:string }) {
  const inFlight=useRef(false);
  const [recovery,setRecovery]=useState<CheckpointedContinuationItem|null>(null),[decision,setDecision]=useState<string|null>(null),
    [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function inspect(item:CheckpointedContinuationItem){
    if(!runId||!item.continuationAttemptId||inFlight.current)return;inFlight.current=true;
    setRecovery(item);setDecision(null);setMessage('Checking the exact interrupted continuation…');setBusy(true);
    try{const r=await requestCheckpointRecovery(runId,item.requestId,item.continuationAttemptId) as {ok?:boolean;runId?:string;requestId?:string;launchAttemptId?:string;decisionDigest?:string;disclosure?:string;error?:string};
      if(r.ok!==true||r.runId!==runId||r.requestId!==item.requestId||r.launchAttemptId!==item.continuationAttemptId
        ||!r.decisionDigest||!/^[a-f0-9]{64}$/.test(r.decisionDigest)
        ||r.disclosure!=='Server-fenced; local actions between bind and retirement are unverified.')
        setMessage(r.error==='update_required'?'Update Tukido on the machine holding this work, then check again. No retry is confirmed.'
          :'Recovery could not be verified here. Use the current Desktop on the machine holding this work; no retry is confirmed.');
      else{setDecision(r.decisionDigest);setMessage('The earlier attempt was refused before launch. Any earlier local actions remain unverified.');}
    }finally{inFlight.current=false;setBusy(false);}
  }
  async function resume(){
    if(!runId||!recovery?.continuationAttemptId||!decision||inFlight.current)return;inFlight.current=true;setBusy(true);
    try{const {data:{session}}=await createClient().auth.getSession();if(!session?.access_token)throw Error('session');
      const r=await resumeCheckpointRecovery(runId,recovery.requestId,recovery.continuationAttemptId,decision,session.access_token) as {ok?:boolean;continuationRequestId?:string;historical?:unknown};
      setDecision(null);setMessage(r.ok===true&&r.continuationRequestId===recovery.requestId&&typeof r.historical==='boolean'
        ?r.historical?'Recovery was recorded earlier; refresh to read current progress.'
          :'Continuation queued from the preserved checkpoint with its remaining allowance. Refresh to follow its progress.'
        :'Recovery was not confirmed. Refresh to read the current state before trying again; do not start a separate run.');
    }catch{setDecision(null);setMessage('The owner session could not be verified. No recovery is confirmed.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  if (history.status === 'available' && history.items.length === 0) return null;
  if (history.status === 'unavailable') {
    return <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <p className="text-reading font-medium text-ink-100">Continuation history could not be checked</p>
      <p className="mt-1 text-secondary text-ink-400">The run itself is unchanged. Refresh to check its preserved-work history again.</p>
    </div>;
  }
  return <><section className="mb-6 rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-4" aria-label="Checkpointed continuation history">
    <h2 className="text-ui font-semibold text-ink-100">Preserved-work continuations</h2>
    <p className="mt-1 text-reading text-ink-400">Technical continuations normally resume automatically; they do not need your input. A refused prelaunch can require the owner recovery below. Preview continuation requires the owner’s exact approval. This shows past approval and durable attempt state—not new permission or delivered video. Desktop verifies preserved files locally before launch.</p>
    <ol className="mt-3 space-y-3">
      {history.items.map((item) => <li key={item.intentId} className="rounded-md border border-ink-800 bg-ink-950/40 p-3 text-secondary">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-300">
          <span className="font-medium text-ink-100">{item.kind==='owner_preview'?'Preview approval used':item.kind==='owner_compose_revision'?'Compose revision authorized':`Continuation ${item.continuationNumber}`}</span>
          <span>step {item.lastCompletedStage} → {item.nextStage}</span>
          <span>{materializationState(item.materializationState)}</span>
          <span>{attemptState(item.attemptLifecycleState)}</span>
          {item.kind==='owner_preview'&&item.destinationRequestStatus==='cancelled'&&<span>Queued Master continuation cancelled; approval remains consumed.</span>}
          {item.kind==='owner_compose_revision'&&<span>Fresh Compose and Preview required; this is not Master approval.</span>}
        </div>
        <div className="mt-2 grid gap-1 font-mono text-micro text-ink-500 sm:grid-cols-2">
          <span title={item.checkpointDigest}>checkpoint {short(item.checkpointId)}</span>
          <span title={item.requestId}>request {short(item.requestId)}</span>
          <span>fence {item.sourceFence} → {item.continuationFence??'pending'}{item.kind?' (new request)':''}</span>
          {item.destinationRequestId&&<span title={item.destinationRequestId}>destination {short(item.destinationRequestId)}</span>}
          <span title={item.sourceAttemptId}>source {short(item.sourceAttemptId)}</span>
          <span title={item.continuationAttemptId || undefined}>continuation {short(item.continuationAttemptId)}</span>
          {item.materializationDigest && <span title={item.materializationDigest}>materialization {short(item.materializationDigest)}</span>}
        </div>
        {runId&&!item.kind&&item.continuationAttemptId&&item.materializationState==='verified'&&item.attemptLifecycleState==='attempt_opened'
          &&<button type="button" className="btn-outline mt-2 px-3 py-2" disabled={busy} onClick={()=>void inspect(item)}>Review continuation recovery</button>}
        {item.attemptExitClassification && <p className="mt-2 text-state-needs">Attempt exit: {item.attemptExitClassification}</p>}
      </li>)}
    </ol>
  </section>
  <Modal open={!!recovery} onClose={()=>{if(!busy)setRecovery(null);}} title="Recover interrupted continuation">
    <p className="text-secondary">{message}</p>
    {decision&&<><p className="mt-3 text-secondary">Desktop will verify the preserved files and check for an active local executor. Recovery keeps the same run, checkpoint, deadline and media allowance. Past local effects are not verified by this check.</p>
      <button type="button" className="btn-primary mt-4 px-4 py-2" disabled={busy} onClick={()=>void resume()}>Recover this continuation</button></>}
  </Modal></>;
}
