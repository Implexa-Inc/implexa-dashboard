'use client';
import {useEffect,useRef,useState} from 'react';
import {contributionRequest,isTrainerContribution,isCustomerGuidance,type TrainerContribution as Contribution,type CustomerGuidance as Draft,UUID} from '@/lib/customer-training-contributions';
import {TrainingInfo} from './training-workspace';
import {deriveTrainingStages,type TrainingPropertyCode} from '@/lib/training-local-ingress';


export default function CustomerTrainingInbox({slug,ownerId,sessionId,versionId,disabled,onStart,onSaved,onOwnExample}:{slug:string;ownerId:string;sessionId:string|null;versionId:string|null;disabled:boolean;onStart:()=>Promise<void>;onSaved:()=>void;onOwnExample:()=>void}){
 const base=`${ownerId}:${slug}:${versionId}`,scope=useRef({base,sessionId,epoch:0});
 // Starting the first session is a handoff, not a new teaching context.
 // A different existing session or owner/version invalidates pending work.
 if(scope.current.base!==base||(scope.current.sessionId!==sessionId&&scope.current.sessionId!==null))scope.current.epoch++;
 scope.current.base=base;scope.current.sessionId=sessionId;
 const [refresh,setRefresh]=useState(0);
 const identity=`${base}:${scope.current.epoch}:${refresh}`,live=useRef(identity);live.current=identity;
 const [items,setItems]=useState<Contribution[]>([]),[loaded,setLoaded]=useState(false),[opened,setOpened]=useState<string|null>(null),[draft,setDraft]=useState<Draft|null>(null),[instruction,setInstruction]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const flight=useRef<symbol|null>(null),pending=useRef<{key:string;body:Record<string,unknown>}|null>(null);
 useEffect(()=>{let active=true;flight.current=null;setBusy(false);setLoaded(false);setItems([]);setOpened(null);setDraft(null);setError('');pending.current=null;
  if(!UUID.test(ownerId)||!UUID.test(versionId||'')){setLoaded(true);return()=>{active=false;};}
  void contributionRequest({action:'list',slug}).then(value=>{if(!active)return;if(value.contractVersion!=='customer-training-inbox.v2'||!Array.isArray(value.items)||!value.items.every(isTrainerContribution))throw Error('Customer suggestions could not be verified.');setItems(value.items);setLoaded(true);}).catch(()=>{if(active)setError('Customer suggestions couldn’t load.');});return()=>{active=false;};},[identity]);
 async function work(fn:(expected:string)=>Promise<void>){if(flight.current)return;const token=Symbol();flight.current=token;setBusy(true);setError('');const expected=identity;try{await fn(expected);}catch(e){if(live.current===expected)setError(e instanceof Error?e.message:'Please try again.');}finally{if(flight.current===token){flight.current=null;if(live.current===expected)setBusy(false);}}}
 async function review(c:Contribution){await work(async expected=>{
  setOpened(c.id);setDraft(null);setInstruction('');
  if(c.teaching||!c.canSuggest)return;
  const value=await contributionRequest({action:'draft',id:c.id,shareDigest:c.shareDigest});
  if(live.current!==expected)return;
  if(!isCustomerGuidance(value,c))throw Error('The general suggestion could not be verified. No customer source is displayed.');
  setDraft(value);setInstruction(value.guidance?[value.guidance.judgment,value.guidance.appliesWhen,value.guidance.instruction].join(' '):'');
 });}
 async function save(c:Contribution){if(!sessionId){await work(async()=>{await onStart();});return;}await work(async expected=>{
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
   <p className="text-xs text-ink-500">Customer learning opportunity <TrainingInfo label="About customer suggestions">With the customer’s consent, AI extracts general guidance privately. Their note, screenshots and actual run are not shown to you. You decide whether to teach the suggestion.</TrainingInfo></p><p className="text-sm leading-6">A customer’s feedback may help improve future runs.</p>{c.teaching&&<p className="text-xs text-ink-400">Teaching suggestion saved</p>}
   {opened!==c.id?<button type="button" className="text-sm text-action-accent" disabled={busy||disabled} onClick={()=>void review(c)}>Review suggestion →</button>:<>
    {c.teaching?<button type="button" className="text-sm text-action-accent" onClick={onSaved}>Review saved training →</button>:!draft?<p className="text-sm text-ink-400">{busy?'Preparing a general suggestion…':c.canSuggest?'The suggestion could not be prepared. Try again or teach your own example.':'This feedback has not authorized AI drafting. Teach your own example instead.'}{c.canSuggest&&!busy&&<button type="button" className="ml-2 underline" onClick={()=>void review(c)}>Try again</button>}</p>:draft.status==='suggested'&&draft.guidance&&draft.scopeSuggestion?<>
     <p className="text-xs text-ink-500">Review and adapt the guidance. Customer source material stays private.</p>
     <textarea aria-label="Reusable guidance from this customer suggestion" maxLength={2000} value={instruction} disabled={busy||!!pending.current} onChange={e=>setInstruction(e.target.value)} className="min-h-24 w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm"/>
     <button type="button" className="btn-primary" disabled={busy||disabled||!instruction.trim()} onClick={()=>void save(c)}>{sessionId?'Review as training':'Continue to training'}</button>
    </>:<p className="text-sm text-ink-400">This needs your judgment. Chat or record your own example to teach it.</p>}
    <div className="flex gap-4">{!c.teaching&&<button type="button" disabled={busy||disabled||!!pending.current} className="text-xs text-ink-400 underline" onClick={()=>void work(async expected=>{await contributionRequest({action:'dismiss',id:c.id,shareDigest:c.shareDigest});if(live.current!==expected)return;setItems(xs=>xs.filter(x=>x.id!==c.id));onOwnExample();})}>Teach with my own example instead</button>}
     <button type="button" disabled={busy||!!pending.current} className="text-xs text-ink-500" onClick={()=>void work(async expected=>{await contributionRequest({action:'dismiss',id:c.id,shareDigest:c.shareDigest});if(live.current===expected)setItems(xs=>xs.filter(x=>x.id!==c.id));})}>{c.teaching?'Hide suggestion':'Dismiss'}</button></div>
   </>}
  </article>)}
  {busy&&<p role="status" className="text-xs text-ink-400">Working…</p>}{error&&<div role="alert" className="text-sm text-state-needs"><p>{error}</p>{!loaded&&<button type="button" disabled={busy} className="text-xs underline" onClick={()=>setRefresh(v=>v+1)}>Retry customer suggestions</button>}</div>}
 </section>;
}
