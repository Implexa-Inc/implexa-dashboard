'use client';
import {useEffect,useRef,useState} from 'react';
import type {ReviewIssue} from '@/lib/review';
import {contributionRequest,isContribution,type Contribution} from '@/lib/customer-training-contributions';
import {teachingDigest} from '@/lib/training-teaching-draft';
import {TrainingDialog} from '../training/[slug]/training-workspace';

export default function CustomerFeedbackSharing({issue,ownerId}:{issue:ReviewIssue;ownerId:string}){
 const identity=`${ownerId}:${issue.id}:${issue.body}:${JSON.stringify(issue.anchor)}`,live=useRef(identity);live.current=identity;
 const [open,setOpen]=useState(false),[excerpt,setExcerpt]=useState(issue.body),[preview,setPreview]=useState<any>(null),[shared,setShared]=useState<Contribution|null>(null),[busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 const flight=useRef<symbol|null>(null);
 useEffect(()=>{flight.current=null;setBusy(false);setOpen(false);setExcerpt(issue.body);setPreview(null);setShared(null);setPending(false);setError('');},[identity]);
 async function work(fn:()=>Promise<void>){if(flight.current)return;const token=Symbol();flight.current=token;setBusy(true);setError('');const expected=identity;
  try{await fn();}catch(e){if(live.current===expected)setError(e instanceof Error?e.message:'Please try again.');}finally{if(flight.current===token){flight.current=null;if(live.current===expected)setBusy(false);}}}
 async function review(){const expected=identity;await work(async()=>{
  if(!excerpt.trim()||!issue.body.includes(excerpt))throw Error('Keep only the exact part of your saved note that you want to share.');
  const bridge=(window as any).implexaDesktop;
  if(bridge?.customerContributionEvidenceContractVersion!=='1')throw Error('Update Implexa Desktop to share this saved frame. Your feedback stays private.');
  const value=await bridge.trainingLocal('readCustomerContributionEvidence',{issueId:issue.id,excerpt,expectedOwnerId:ownerId});
  if(!value?.ok)throw Error(value?.reason==='customer_feedback_frame_unavailable'?'The saved frame is not ready yet. Wait a moment, then review again.':'This result has no verified trainer-linked frame to share. Your note stays private.');
  const receipt=value?.receipt,e=receipt?.evidence;
  if(!value?.ok||value.contractVersion!=='customer-feedback-share-context.v1'||receipt.customerId!==ownerId||receipt.issueId!==issue.id||receipt.excerpt!==excerpt||receipt.assistedDraftingAllowed!==true||receipt.assistedDraftingProvider!=='anthropic'
   ||typeof value.image!=='string'||!value.image.startsWith('data:image/png;base64,')||value.image.length>2800000||!e||await teachingDigest(Uint8Array.from(atob(value.image.slice(22)),c=>c.charCodeAt(0)))!==e.sha256)throw Error('The saved frame could not be verified. Reopen this note and try again.');
  if(live.current===expected){setPreview(value);if(isContribution(value.existingContribution)&&value.existingContribution.storedAt)setShared(value.existingContribution);}
 });}
 async function share(){const expected=identity;await work(async()=>{
  if(!preview||preview.receipt.excerpt!==excerpt)return;setPending(true);
  const value=await contributionRequest({action:'share',issueId:issue.id,excerpt,shareDigest:preview.shareDigest,consent:true,image:preview.image},`customer-feedback:v1:${issue.id}:${preview.shareDigest}`);
  if(!isContribution(value.contribution)||value.contribution.shareDigest!==preview.shareDigest||!value.contribution.storedAt||value.contribution.withdrawnAt)throw Error('Sharing is unconfirmed. Retry the same note.');
  if(live.current===expected){setPending(false);setShared(value.contribution);}
 });}
 return <><button type="button" className="mt-2 text-ui text-action-accent underline" onClick={()=>setOpen(true)}>Suggest an improvement to the trainer</button>
 <TrainingDialog open={open} onClose={()=>{if(!busy)setOpen(false);}} title={shared?'Suggestion shared':'Help improve this agent'} maxWidth="max-w-xl">
  {shared?<div className="space-y-3"><p className="text-reading">{shared.withdrawnAt?'This shared example has been withdrawn.':'Your feedback is available for private AI analysis. The trainer receives general guidance, not your source material, and decides what should become training.'}</p>{!shared.withdrawnAt&&<button type="button" disabled={busy} className="text-ui underline" onClick={()=>void work(async()=>{const value=await contributionRequest({action:'withdraw',id:shared.id,shareDigest:shared.shareDigest});if(!isContribution(value.contribution)||!value.contribution.withdrawnAt)throw Error('Withdrawal is unconfirmed. Retry.');if(live.current!==identity)return;setShared(null);setPreview(null);setOpen(false);})}>Withdraw this suggestion</button>}</div>:<div className="space-y-4">
   <p className="text-reading text-ink-300">Share only the part that could help other customers. Keep your brand and personal preferences private.</p>
   <textarea aria-label="Feedback to share" value={excerpt} maxLength={2000} disabled={busy||pending} onChange={e=>{setExcerpt(e.target.value);setPreview(null);}} className="min-h-24 w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-ui"/>
   {preview?<><img src={preview.image} alt="Exact saved frame for private AI analysis" className="max-h-64 rounded-lg object-contain"/><p className="text-reading">Allow Anthropic’s AI to analyze this note and frame privately to suggest general improvements for {preview.agentName}. {preview.trainerName} can review the general guidance, but cannot see your note, screenshot or actual run. Nothing becomes public footage or a sample.</p><button type="button" disabled={busy} className="btn-primary" onClick={()=>void share()}>Suggest general improvements</button></>:<button type="button" disabled={busy||!excerpt.trim()} className="btn-primary" onClick={()=>void review()}>Review what will be shared</button>}
  </div>}
  {busy&&<p role="status" className="mt-3 text-secondary text-ink-400">Working…</p>}{error&&<p role="alert" className="mt-3 text-reading text-state-needs">{error}</p>}
 </TrainingDialog></>;
}
