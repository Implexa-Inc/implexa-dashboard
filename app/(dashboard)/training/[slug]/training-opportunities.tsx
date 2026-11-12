'use client';
import {useEffect,useRef,useState} from 'react';
import {trainingOpportunities,questionPresentation,questionExcerpt,type QuestionsPage,type QuestionPresentation} from '@/lib/trainer-questions';
import {trainingPropertyLabel} from '@/lib/training-local-ingress';
import {TrainingInfo,RunImage,type TrainingRun} from './training-workspace';

/** Presentation and submission use exact recorded identities; no inferred acceptance. */
export default function TrainingOpportunities({questions,sessionId,versionId,disabled,onSaved,onStart,runs=[],unavailable=false}:{runs?:TrainingRun[];unavailable?:boolean;questions:QuestionsPage|null;sessionId:string|null;versionId:string|null;disabled:boolean;onSaved:()=>void;onStart:()=>Promise<void>}){
 const identity=`${sessionId}:${versionId}`,latest=useRef(identity);latest.current=identity;
 const [opened,setOpened]=useState<string|null>(null),[skipped,setSkipped]=useState<string[]>([]),[saved,setSaved]=useState<string[]>([]);
 const [presentations,setPresentations]=useState<Record<string,QuestionPresentation>>({}),[answer,setAnswer]=useState(''),[option,setOption]=useState<number|null>(null),[custom,setCustom]=useState(false),[working,setWorking]=useState(''),[error,setError]=useState('');
 const queuedOpen=useRef<string|null>(null);
 const pending=useRef<{identity:string;id:string;key:string;body:any}|null>(null);
 useEffect(()=>{setOpened(null);setSkipped([]);setSaved([]);setPresentations({});setAnswer('');setOption(null);setCustom(false);setError('');pending.current=null;},[identity]);
 useEffect(()=>{if(sessionId&&queuedOpen.current){const id=queuedOpen.current;queuedOpen.current=null;void open(id);}},[sessionId]);
 const items=trainingOpportunities(questions?.items||[],versionId).filter(q=>!skipped.includes(q.id)&&!saved.includes(q.id));
 async function request(body:any,key:string){const r=await fetch(`/api/agent-training/questions?operation=teaching&sessionId=${sessionId}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body),cache:'no-store'});const value=await r.json();if(!r.ok||!value.ok)throw Error(value.reason||'Could not save. Try again.');return value;}
 async function open(id:string){if(!sessionId){queuedOpen.current=id;await onStart();return;}if(working)return;setOpened(id);setAnswer('');setOption(null);setCustom(false);setError('');if(presentations[id])return;
  const q=items.find(q=>q.id===id);if(!q)return;const captured=identity;setWorking('Preparing choices');
  try{const value=await request({action:'present',questionReceiptId:id,questionReceiptDigest:q.receiptDigest,expectedActiveVersionId:versionId},crypto.randomUUID());if(latest.current!==captured)return;if(!questionPresentation(value.presentation))throw Error('Choices are unavailable. You can write your answer.');setPresentations(p=>({...p,[id]:value.presentation}));}
  catch{if(latest.current===captured){setCustom(true);setError('Choices couldn’t load. You can still write your answer.');}}finally{if(latest.current===captured)setWorking('');}
 }
 async function save(id:string){if(!answer.trim()||!sessionId||working)return;const q=items.find(q=>q.id===id);if(!q)return;const captured=identity;
  const body={action:'save',questionReceiptId:id,questionReceiptDigest:q.receiptDigest,expectedActiveVersionId:versionId,rawAnswer:answer,presentationId:presentations[id]?.id||null,optionIndex:option};
  if(pending.current&&JSON.stringify(pending.current.body)!==JSON.stringify(body)){setError('Retry the pending answer before changing it.');return;}
  pending.current||={identity,id,key:crypto.randomUUID(),body};setWorking('Saving your teaching');setError('');
  try{const value=await request(pending.current.body,pending.current.key);if(latest.current!==captured)return;if(value.contractVersion!=='training-question-teaching.v1'||value.questionReceiptId!==id||!value.recordId||!value.recordDigest)throw Error('Save could not be confirmed. Retry the same answer.');pending.current=null;setSaved(ids=>[...ids,id]);setOpened(null);setAnswer('');onSaved();}
  catch(e){if(latest.current===captured)setError(e instanceof Error?e.message:'Save could not be confirmed. Retry.');}finally{if(latest.current===captured)setWorking('');}
 }
 return <section aria-labelledby="training-opportunities-heading" className="space-y-4">
  <div><h3 id="training-opportunities-heading" className="text-lg font-medium">Help your agent improve</h3><p className="mt-1 text-sm text-ink-400">A few quick answers can guide its next run.</p></div>
  {saved.length>0&&<p role="status" className="text-sm text-emerald-400">Answer saved as a teaching suggestion. Review it before including it.</p>}
  {!questions?<p className="text-sm text-ink-500">{unavailable?'Suggestions couldn’t load. You can still teach in the ways below.':'Checking recent runs…'}</p>:!items.length?<p className="text-sm text-ink-500">No new questions need your guidance. You can teach in any of the ways below.</p>:<div className="grid items-start gap-3 xl:grid-cols-3">{items.map(q=>{const p=presentations[q.id],isOpen=opened===q.id,artifact=runs.find(run=>run.id===q.runId)?.artifact;return <article key={q.id} className={`space-y-3 rounded-xl border p-4 ${isOpen?'border-brand-500':'border-ink-700'}`}>
   {artifact&&<RunImage artifact={artifact}/>}
   <p className="text-xs text-ink-500">{trainingPropertyLabel(q.property)} · {q.opportunityReason==='review_finding'?'A related result needs improvement':'No matching guidance was found'}</p>
   <p className="text-sm leading-6">{p?.value.question||'How would you approach this in a future run?'}</p>
   {!isOpen?<div className="flex justify-between"><button type="button" disabled={disabled||!!working} className="text-sm text-brand-400" onClick={()=>void open(q.id)}>Answer →</button><button type="button" className="text-xs text-ink-500" onClick={()=>setSkipped(ids=>[...ids,q.id])}>Skip</button></div>:<>
    {p&&<fieldset disabled={!!working||!!pending.current} className="space-y-2"><legend className="mb-2 text-xs text-ink-500">Suggested approaches</legend>{p.value.options.map((text,i)=><label key={i} className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-800 p-2 text-sm"><input type="radio" name={`choice-${q.id}`} checked={option===i&&!custom} onChange={()=>{setOption(i);setAnswer(text);setCustom(false);}}/>{text}</label>)}<label className="flex items-center gap-2 text-sm"><input type="radio" name={`choice-${q.id}`} checked={custom} onChange={()=>{setOption(null);setCustom(true);setAnswer('');}}/>Type a different answer</label></fieldset>}
    {(custom||!p)&&<textarea aria-label="Your answer" maxLength={2000} value={answer} disabled={!!working||!!pending.current} onChange={e=>setAnswer(e.target.value)} placeholder="What would you prefer, and when?" className="min-h-24 w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm"/>}
    <div className="flex items-center justify-between gap-2"><button type="button" className="btn-primary text-sm" disabled={disabled||!!working||!answer.trim()} onClick={()=>void save(q.id)}>Save answer</button><button type="button" disabled={!!working||!!pending.current} className="text-xs text-ink-500" onClick={()=>{setSkipped(ids=>[...ids,q.id]);setOpened(null);}}>Skip</button></div>
    {working&&<p role="status" className="text-xs text-ink-400">{working}…</p>}{error&&<p role="alert" className="text-xs text-amber-300">{error.replaceAll('_',' ')}</p>}
   </>}
   <details className="text-xs text-ink-500"><summary className="cursor-pointer">Context</summary><p className="mt-2 whitespace-pre-wrap">{q.question}</p><p className="mt-2">{q.sceneElement}</p></details>
  </article>;})}</div>}
  <TrainingInfo label="About these suggestions">Choices are written by AI from recorded questions. Your submitted answer becomes a private suggestion for review. Finding guidance does not establish that it was applied.</TrainingInfo>
 </section>;
}
