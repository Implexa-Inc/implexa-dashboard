'use client';
import {useEffect,useRef,useState} from 'react';
import {contributionRequest,isContribution,type Contribution,UUID} from '@/lib/customer-training-contributions';
import {teachingDigest} from '@/lib/training-teaching-draft';
import {TrainingInfo} from './training-workspace';
import {deriveTrainingStages,type TrainingPropertyCode} from '@/lib/training-local-ingress';

type Draft={status:string;fields?:{chosen:string;why:string;process:string;desiredBehavior:string};scopeSuggestion?:{property:TrainingPropertyCode;relation:string}|null};
export default function CustomerTrainingInbox({slug,ownerId,sessionId,versionId,disabled,onStart,onSaved,onOwnExample}:{slug:string;ownerId:string;sessionId:string|null;versionId:string|null;disabled:boolean;onStart:()=>Promise<void>;onSaved:()=>void;onOwnExample:()=>void}){
 const identity=`${ownerId}:${slug}:${sessionId}:${versionId}`,live=useRef(identity);live.current=identity;
 const [refresh,setRefresh]=useState(0);
 const [items,setItems]=useState<Contribution[]>([]),[loaded,setLoaded]=useState(false),[opened,setOpened]=useState<string|null>(null),[image,setImage]=useState(''),[draft,setDraft]=useState<Draft|null>(null),[instruction,setInstruction]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const flight=useRef(false),pending=useRef<{key:string;body:Record<string,unknown>}|null>(null);
 useEffect(()=>{let active=true;setLoaded(false);setItems([]);setOpened(null);setImage('');setDraft(null);setError('');pending.current=null;
  if(!UUID.test(ownerId)||!UUID.test(versionId||'')){setLoaded(true);return()=>{active=false;};}
  void contributionRequest({action:'list',slug}).then(value=>{if(!active)return;if(value.contractVersion!=='customer-training-inbox.v1'||!Array.isArray(value.items)||!value.items.every(isContribution))throw Error('Customer suggestions could not be verified.');setItems(value.items);setLoaded(true);}).catch(()=>{if(active)setError('Customer suggestions couldn’t load.');});return()=>{active=false;};},[identity,refresh]);
 async function work(fn:(expected:string)=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setError('');const expected=identity;try{await fn(expected);}catch(e){if(live.current===expected)setError(e instanceof Error?e.message:'Please try again.');}finally{flight.current=false;if(live.current===expected)setBusy(false);}}
 async function review(c:Contribution){await work(async expected=>{
  setOpened(c.id);setImage('');setDraft(null);setInstruction('');
  const value=await contributionRequest({action:'read',id:c.id,shareDigest:c.shareDigest});
  if(!isContribution(value.contribution)||value.contribution.shareDigest!==c.shareDigest||typeof value.image!=='string'||!value.image.startsWith('data:image/png;base64,')
   ||await teachingDigest(Uint8Array.from(atob(value.image.slice(22)),x=>x.charCodeAt(0)))!==c.evidence.sha256)throw Error('The shared frame is unavailable.');
  if(live.current!==expected)return;setImage(value.image);
 });}
 async function suggest(c:Contribution){await work(async expected=>{
  const value=await contributionRequest({action:'draft',id:c.id,shareDigest:c.shareDigest});if(live.current!==expected)return;
  if(value.contractVersion!=='customer-contribution-draft.v1'||value.id!==c.id||value.shareDigest!==c.shareDigest)throw Error('The suggestion could not be verified.');
  setDraft(value);setInstruction(value.fields?[value.fields.why,value.fields.process,value.fields.desiredBehavior].join(' '):'');
 });}
 async function save(c:Contribution){if(!sessionId){await onStart();return;}await work(async expected=>{
  if(!versionId||!instruction.trim()||!draft?.scopeSuggestion||pending.current&&pending.current.body.id!==c.id)return;
  const property=draft.scopeSuggestion.property,body={action:'prepare',id:c.id,shareDigest:c.shareDigest,sessionId,expectedActiveVersionId:versionId,
   content:{contractVersion:'agent-text-teaching.v1',category:'taste',instruction,properties:[property],applicability:{stages:deriveTrainingStages(property),taskFacts:[],exceptions:[],priority:50}}};
  if(pending.current&&JSON.stringify(pending.current.body)!==JSON.stringify(body))throw Error('Retry the pending save before changing the guidance.');
  pending.current||={key:crypto.randomUUID(),body};const value=await contributionRequest(pending.current.body,pending.current.key);
  if(value.contractVersion!=='customer-contribution-teaching.v1'||!UUID.test(value.recordId||'')||!/^[a-f0-9]{64}$/.test(value.recordDigest||''))throw Error('Save is unconfirmed. Retry this guidance.');
  if(live.current!==expected)return;pending.current=null;setItems(old=>old.map(x=>x.id===c.id?{...x,teaching:{recordId:value.recordId,recordDigest:value.recordDigest}}:x));setOpened(null);onSaved();
 });}
 if(loaded&&!items.length)return null;
 return <section aria-label="Customer training suggestions" className="space-y-3">
  {(items.length>0||error)&&<h3 className="text-lg font-medium">Suggestions from customers</h3>}
  {items.map(c=><article key={c.id} className="space-y-3 rounded-xl border border-ink-700 p-4">
   <p className="text-xs text-ink-500">Customer feedback · Reference only <TrainingInfo label="About customer suggestions">Drafting sends this shared note and frame to Claude Haiku 5.5. You review the proposed guidance before applying it. The frame stays a reference, not output footage.</TrainingInfo></p><p className="text-sm leading-6">{c.excerpt}</p>{c.teaching&&<p className="text-xs text-ink-400">Teaching suggestion saved · Original customer reference</p>}
   {opened!==c.id?<button type="button" className="text-sm text-brand-400" disabled={busy||disabled} onClick={()=>void review(c)}>Review suggestion →</button>:<>
    {image&&<img src={image} alt="Customer-shared reference frame, not approved training" className="max-h-56 rounded-lg object-contain"/>}
    {c.teaching?<button type="button" className="text-sm text-brand-400" onClick={onSaved}>Review saved training →</button>:!draft?<button type="button" disabled={busy||!image} className="text-sm text-brand-400" onClick={()=>void suggest(c)}>Suggest a reusable lesson</button>:draft.status==='suggested'&&draft.fields&&draft.scopeSuggestion?<>
     <p className="text-xs text-ink-500">Review and adapt the guidance. The customer’s original note and frame stay separate.</p>
     <textarea aria-label="Reusable guidance from this customer suggestion" maxLength={2000} value={instruction} disabled={busy||!!pending.current} onChange={e=>setInstruction(e.target.value)} className="min-h-24 w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm"/>
     <button type="button" className="btn-primary" disabled={busy||disabled||!instruction.trim()} onClick={()=>void save(c)}>{sessionId?'Review as training':'Continue to training'}</button>
    </>:<p className="text-sm text-ink-400">This needs your judgment. Chat or record your own example to teach it.</p>}
    <div className="flex gap-4">{!c.teaching&&<button type="button" disabled={busy||disabled||!!pending.current} className="text-xs text-ink-400 underline" onClick={()=>void work(async expected=>{await contributionRequest({action:'dismiss',id:c.id,shareDigest:c.shareDigest});if(live.current!==expected)return;setItems(xs=>xs.filter(x=>x.id!==c.id));onOwnExample();})}>Teach with my own example instead</button>}
     <button type="button" disabled={busy||!!pending.current} className="text-xs text-ink-500" onClick={()=>void work(async expected=>{await contributionRequest({action:'dismiss',id:c.id,shareDigest:c.shareDigest});if(live.current===expected)setItems(xs=>xs.filter(x=>x.id!==c.id));})}>{c.teaching?'Hide reference':'Dismiss'}</button></div>
   </>}
  </article>)}
  {busy&&<p role="status" className="text-xs text-ink-400">Working…</p>}{error&&<div role="alert" className="text-sm text-amber-300"><p>{error}</p>{!loaded&&<button type="button" disabled={busy} className="text-xs underline" onClick={()=>setRefresh(v=>v+1)}>Retry customer suggestions</button>}</div>}
 </section>;
}
