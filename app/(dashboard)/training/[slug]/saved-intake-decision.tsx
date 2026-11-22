'use client';
import {useEffect,useRef,useState} from 'react';
import TrainingIntakePlan,{readIntakePlan,METHOD_CONTRACT,type IntakePlan} from './training-intake-plan';
import type {CoachDecision} from '@/lib/training-coach';
import {UUID} from '@/lib/trainer-questions';

/** Reopens the selected saved proposal through its existing canonical reader/writer. */
export default function SavedIntakeDecision({item,disabled,onChanged,onClose}:{item:CoachDecision;disabled:boolean;onChanged:()=>void;onClose:()=>void}){
 const identity=`${item.sessionId}:${item.versionId}:${item.id}:${item.digest}`,current=useRef(identity);current.current=identity;
 const [plan,setPlan]=useState<IntakePlan|null>(null),[error,setError]=useState('');
 async function request(body:object,signal?:AbortSignal){const response=await fetch(`/api/agent-training/teaching-suggestion?sessionId=${encodeURIComponent(item.sessionId||'')}`,{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});const value=await response.json();if(!response.ok||value?.ok!==true)throw Error('This saved change could not be verified. Refresh suggestions.');return value;}
 useEffect(()=>{const controller=new AbortController(),captured=identity;setPlan(null);setError('');
  if(item.source!=='intake_plan'||!item.sessionId){setError('Open this earlier recording in saved sources to review its original tool proposal.');return;}
  void request({mode:'intake-list',expectedActiveVersionId:item.versionId,consent:true,methodContract:METHOD_CONTRACT},controller.signal).then(value=>{
   if(controller.signal.aborted||current.current!==captured)return;
   const exact=Array.isArray(value.plans)?value.plans.map((v:unknown)=>readIntakePlan(v,item.versionId)).find((p:IntakePlan|null)=>p?.planId===item.id&&p.planDigest===item.digest):null;
   if(!exact)throw Error('This saved change is no longer available for this version.');setPlan(exact);
  }).catch(e=>{if(!controller.signal.aborted&&current.current===captured)setError(e instanceof Error?e.message:'Saved change unavailable.');});return()=>controller.abort();
 },[identity]);
 return error?<p role="alert" className="text-sm text-state-needs">{error}</p>:plan?<TrainingIntakePlan plan={plan} disabled={disabled} onClose={onClose} onQueue={async selected=>{
   const captured=identity,value=await request({mode:'intake-queue',expectedActiveVersionId:item.versionId,consent:true,methodContract:METHOD_CONTRACT,planId:plan.planId,planDigest:plan.planDigest,selected});
   if(current.current!==captured)throw Error('The review target changed. Refresh its status.');
   if(value.application!=='edit_queued'||!UUID.test(value.requestId||''))throw Error('The queued change is unconfirmed. Refresh its status before trying again.');onChanged();
 }}/>:<p role="status" className="text-sm text-ink-400">Opening the saved agent change…</p>;
}
