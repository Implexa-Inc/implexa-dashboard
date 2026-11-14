'use client';
import {useEffect,useRef,useState} from 'react';
import type {ReviewIssue} from '@/lib/review';
import {contributionRequest,isContribution,type Contribution} from '@/lib/customer-training-contributions';
import {teachingDigest} from '@/lib/training-teaching-draft';
import {TrainingDialog} from '../training/[slug]/training-workspace';

export default function CustomerFeedbackSharing({issue,ownerId}:{issue:ReviewIssue;ownerId:string}){
 const identity=`${ownerId}:${issue.id}:${issue.body}:${JSON.stringify(issue.anchor)}`,live=useRef(identity);live.current=identity;
 const [open,setOpen]=useState(false),[excerpt,setExcerpt]=useState(issue.body),[preview,setPreview]=useState<any>(null),[shared,setShared]=useState<Contribution|null>(null),[busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 const flight=useRef(false);
 useEffect(()=>{setOpen(false);setExcerpt(issue.body);setPreview(null);setShared(null);setPending(false);setError('');},[identity]);
 async function work(fn:()=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setError('');const expected=identity;
  try{await fn();}catch(e){if(live.current===expected)setError(e instanceof Error?e.message:'Please try again.');}finally{flight.current=false;if(live.current===expected)setBusy(false);}}
 async function review(){const expected=identity;await work(async()=>{
  if(!excerpt.trim()||!issue.body.includes(excerpt))throw Error('Keep only the exact part of your saved note that you want to share.');
  const bridge=(window as any).implexaDesktop;
  if(bridge?.customerContributionEvidenceContractVersion!=='1')throw Error('Update Implexa Desktop to share this saved frame. Your feedback stays private.');
  const value=await bridge.trainingLocal('readCustomerContributionEvidence',{issueId:issue.id,excerpt,expectedOwnerId:ownerId});
  const receipt=value?.receipt,e=receipt?.evidence;
  if(!value?.ok||value.contractVersion!=='customer-feedback-share-context.v1'||receipt.customerId!==ownerId||receipt.issueId!==issue.id||receipt.excerpt!==excerpt
   ||typeof value.image!=='string'||!value.image.startsWith('data:image/png;base64,')||value.image.length>2800000||!e||await teachingDigest(Uint8Array.from(atob(value.image.slice(22)),c=>c.charCodeAt(0)))!==e.sha256)throw Error('The saved frame could not be verified. Reopen this note and try again.');
  if(live.current===expected){setPreview(value);if(isContribution(value.existingContribution)&&value.existingContribution.storedAt)setShared(value.existingContribution);}
 });}
 async function share(){const expected=identity;await work(async()=>{
  if(!preview||preview.receipt.excerpt!==excerpt)return;setPending(true);
  const value=await contributionRequest({action:'share',issueId:issue.id,excerpt,shareDigest:preview.shareDigest,consent:true,image:preview.image},`customer-feedback:v1:${issue.id}:${preview.shareDigest}`);
  if(!isContribution(value.contribution)||value.contribution.shareDigest!==preview.shareDigest||!value.contribution.storedAt||value.contribution.withdrawnAt)throw Error('Sharing is unconfirmed. Retry the same note.');
  if(live.current===expected){setPending(false);setShared(value.contribution);}
 });}
 return <><button type="button" className="mt-2 text-xs text-brand-400 underline" onClick={()=>setOpen(true)}>Suggest an improvement to the trainer</button>
 <TrainingDialog open={open} onClose={()=>{if(!busy)setOpen(false);}} title={shared?'Suggestion shared':'Help improve this agent'} maxWidth="max-w-xl">
  {shared?<div className="space-y-3"><p className="text-sm">{shared.withdrawnAt?'This shared example has been withdrawn.':'Your note and frame are with the trainer for review. They decide what should become training.'}</p>{!shared.withdrawnAt&&<button type="button" disabled={busy} className="text-sm underline" onClick={()=>void work(async()=>{const value=await contributionRequest({action:'withdraw',id:shared.id,shareDigest:shared.shareDigest});if(!isContribution(value.contribution)||!value.contribution.withdrawnAt)throw Error('Withdrawal is unconfirmed. Retry.');setShared(null);setPreview(null);setOpen(false);})}>Withdraw this shared example</button>}</div>:<div className="space-y-4">
   <p className="text-sm text-ink-300">Share only the part that could help other customers. Keep your brand and personal preferences private.</p>
   <textarea aria-label="Feedback to share" value={excerpt} maxLength={2000} disabled={busy||pending} onChange={e=>{setExcerpt(e.target.value);setPreview(null);}} className="min-h-24 w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm"/>
   {preview?<><img src={preview.image} alt="Exact saved frame to share with the trainer" className="max-h-64 rounded-lg object-contain"/><p className="text-sm">Share this note and frame with {preview.trainerName} to improve {preview.agentName}. The trainer can use it as a reference and approve guidance for future customers. It won’t become video footage or a public sample.</p><button type="button" disabled={busy} className="btn-primary" onClick={()=>void share()}>Share with the trainer</button></>:<button type="button" disabled={busy||!excerpt.trim()} className="btn-primary" onClick={()=>void review()}>Review what will be shared</button>}
  </div>}
  {busy&&<p role="status" className="mt-3 text-xs text-ink-400">Working…</p>}{error&&<p role="alert" className="mt-3 text-sm text-amber-300">{error}</p>}
 </TrainingDialog></>;
}
