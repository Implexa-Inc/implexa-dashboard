'use client';

import {AGENTS_RUNNING_HREF} from '@/lib/navigation';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {createAgentBuild} from '@/lib/plan-review';
import {AttachFiles,composeNoteWithFiles,useRunAttachments,ATTACH_BUILD_MARKER} from './run-attachments';
import {isCreationDraftRead,type CreationDraftRead,type CreationTurn} from '@/lib/agent-creation-brief';

/** Prepared cards over the existing plan/build gate. This component grants no
 * tools, starts no runs and stores no private conversation in a definition. */
export default function GuidedAgentCreation({ownerId}:{ownerId:string}){
 const [draftId,setDraftId]=useState(''),[data,setData]=useState<CreationDraftRead|null>(null),[selectedId,setSelectedId]=useState<string|null>(null);
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [queued,setQueued]=useState(false);
 const pending=useRef<{draftId:string;turnId:string;message:string;baseReplyId:string|null;baseDraftId:string|null}|null>(null),seed=useRef<{draftId:string;replyId:string}|null>(null),active=useRef(''),composer=useRef<HTMLTextAreaElement>(null);
 const {files,canAttach,canAttachFolder,attachFile,attachFolder,removeFile,reset:resetFiles,error:attachError}=useRunAttachments();
 const storageKey=`implexa-creation-draft:${ownerId}`,selectionKey=(id:string)=>`${storageKey}:${id}:selection`;
 useEffect(()=>{let saved:string|null=null;try{saved=sessionStorage.getItem(storageKey);}catch{}
  const id=saved&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(saved)?saved:crypto.randomUUID();
  setData(null);setSelectedId(null);setText('');setQueued(false);pending.current=null;seed.current=null;
  setDraftId(id);active.current=id;try{sessionStorage.setItem(storageKey,id);}catch{};
  return()=>{active.current='';};
 },[storageKey]);
 const apply=(value:CreationDraftRead)=>{
  setData(value);const prepared=value.turns.filter(t=>t.status==='answered'&&t.brief&&t.replyId);
  let saved:string|null=null;try{saved=sessionStorage.getItem(selectionKey(value.draftId));}catch{}
  setSelectedId(old=>prepared.some(t=>t.replyId===old)?old:prepared.some(t=>t.replyId===saved)?saved:prepared.at(-1)?.replyId||null);
 };
 const load=async(id:string)=>{
  setBusy(true);setError('');
  try{const r=await fetch(`/api/agents/creation-draft?draftId=${encodeURIComponent(id)}`,{cache:'no-store'});const v=await r.json();
   if(active.current!==id)return;if(!r.ok||!isCreationDraftRead(v,id))throw Error(v.reason||'creation_draft_unavailable');apply(v);
  }catch(e){if(active.current===id)setError(e instanceof Error?e.message:'creation_draft_unavailable');}
  finally{if(active.current===id)setBusy(false);}
 };
 useEffect(()=>{if(draftId)void load(draftId);},[draftId]);
 const selected=data?.turns.find(t=>t.replyId===selectedId&&t.status==='answered'&&t.brief)||null;
 const prepared=data?.turns.filter(t=>t.status==='answered'&&t.brief&&t.replyId)||[];
 const isPending=data?.turns.some(t=>t.status==='pending')===true;
 const isBuilt=queued||!!data?.buildRequestId||data?.withdrawn===true;
 const choose=(turn:CreationTurn)=>{setSelectedId(turn.replyId);try{sessionStorage.setItem(selectionKey(draftId),turn.replyId!);}catch{}};
 const send=async()=>{
  if(busy||isBuilt||isPending||!draftId||!text.trim())return;
  const identity=draftId,message=text,baseReplyId=selected?.replyId||seed.current?.replyId||null,baseDraftId=selected?null:seed.current?.draftId||null;
  const turn=pending.current&&pending.current.draftId===identity&&pending.current.message===message&&pending.current.baseReplyId===baseReplyId&&pending.current.baseDraftId===baseDraftId
   ?pending.current:{draftId:identity,turnId:crypto.randomUUID(),message,baseReplyId,baseDraftId};
  pending.current=turn;setBusy(true);setError('');setNotice('');
  try{const r=await fetch('/api/agents/creation-draft',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',body:JSON.stringify({...turn,consent:true})});
   const v=await r.json();if(active.current!==identity)return;
   if(!r.ok||!isCreationDraftRead(v,identity))throw Error(v.reason||'creation_brief_unconfirmed');
   apply(v);const answer=v.turns.find(t=>t.turnId===turn.turnId);
   if(answer?.brief&&answer.replyId){choose(answer);setNotice('Draft updated. Review the cards or keep refining it in chat.');}
   setText('');pending.current=null;seed.current=null;
  }catch(e){if(active.current===identity)setError(`${e instanceof Error?e.message:'creation_brief_unconfirmed'}. Refresh the saved draft before sending again; no automatic retry is made.`);}
  finally{if(active.current===identity)setBusy(false);}
 };
 const change=(field:string)=>{setText(`Change ${field}: `);composer.current?.focus();};
 const withdraw=async()=>{if(busy||!draftId)return;const identity=draftId;setBusy(true);setError('');try{
  const r=await fetch('/api/agents/creation-draft',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',body:JSON.stringify({draftId,turnId:crypto.randomUUID(),action:'withdraw'})});const v=await r.json();
   if(active.current!==identity)return;if(!r.ok||!isCreationDraftRead(v,identity))throw Error(v.reason||'Withdrawal unconfirmed');apply(v);setText('');setNotice('Draft withdrawn from future model preparation and builds. Its raw history remains privately retained. This does not erase it, cancel a queued build or remove cards from an agent already built.');
 }catch(e){if(active.current===identity)setError(e instanceof Error?e.message:'Withdrawal unconfirmed');}finally{if(active.current===identity)setBusy(false);}};
 const previousPrepared=prepared.find(t=>t.replyId===selected?.baseReplyId);
 const undo=()=>{if(previousPrepared){choose(previousPrepared);setNotice('Previous saved draft restored. No AI call was made.');}};
 const startNew=()=>{if(busy)return;seed.current=selected?.replyId?{draftId,replyId:selected.replyId}:null;const id=crypto.randomUUID();active.current=id;setDraftId(id);setData(null);setSelectedId(null);setText(seed.current?'Create another agent using the selected saved draft.':'');setQueued(false);resetFiles();setError('');setNotice(seed.current?'The selected cards will seed the new draft when you Send. Their private training notes stay separate. The earlier draft and build remain preserved.':'New private draft.');pending.current=null;
  try{sessionStorage.setItem(storageKey,id);}catch{};};
 const buildAgent=async()=>{
  if(!selected?.brief||!selected.replyId||!selected.replyDigest||!selected.buildIntent||busy||isPending||isBuilt)return;
  const intent=composeNoteWithFiles(selected.buildIntent,files,ATTACH_BUILD_MARKER);
  if(intent.length>20000){setError('These attachments make the build request too long. Remove some before building; nothing has been truncated.');return;}
  const identity=draftId;setBusy(true);setError('');
  try{const r=await createAgentBuild({intent:'',creationDraftBinding:{draftId,replyId:selected.replyId,replyDigest:selected.replyDigest},creationDraftFiles:files});
   if(active.current!==identity)return;if(!r.ok)throw Error(r.error||'Build unconfirmed');setQueued(true);void load(identity);
  }catch(e){if(active.current===identity)setError(e instanceof Error?e.message:'Build unconfirmed. Refresh before trying again.');}
  finally{if(active.current===identity)setBusy(false);}
 };
 return <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
  <div className="min-w-0 space-y-5">
   <div className="flex items-center justify-between gap-4"><p className="text-[10px] uppercase tracking-[.18em] text-ink-500">Your agent, prepared with you</p>
    <button type="button" className="text-xs text-ink-400 underline" disabled={busy} onClick={startNew}>{selected?'Copy to a new draft':'New draft'}</button></div>
   {!selected&&<div className="rounded-xl border border-ink-800 p-6"><h2 className="text-xl font-medium">{data?.withdrawn?'This draft is withdrawn.':'Start with the job you want done.'}</h2>
    <p className="mt-3 text-sm leading-6 text-ink-400">{data?.withdrawn?'Choose New draft to start again. This draft can no longer prepare replies or queue a build.':'Explain it in chat. Implexa will prepare the goal, tools, input and output for you. Nothing is built until you choose Build.'}</p></div>}
   {selected?.brief&&<>
    {([['The goal','goal',<><h2 className="text-lg font-medium">{selected.brief.name}</h2><p className="mt-3">{selected.brief.goal}</p></>],
     ['What it receives','inputs',<ul className="list-disc pl-4 space-y-2">{selected.brief.inputs.map((s,i)=><li key={i}>{s}</li>)}</ul>],
     ['What it delivers','outputs',<ul className="list-disc pl-4 space-y-2">{selected.brief.outputs.map((s,i)=><li key={i}>{s}</li>)}</ul>],
     ['Tools and methods','tools',<><ul className="space-y-2">{selected.tools.map((t,i)=><li key={i}><span className="font-medium">{t.name}</span> · {t.requirement==='required'?'Required choice':'Preferred choice'}{!t.supported&&<span className="text-amber-300"> · Setup must verify support</span>}</li>)}</ul>{selected.tools.length===0&&<p>No specific tool requested.</p>}<p className="mt-3 text-xs text-ink-500">These are requests, not access grants. Existing Setup checks tools, methods and permissions before use.</p></>]] as const).map(([title,field,content])=><section key={field} className="rounded-xl border border-ink-800 p-5 text-sm leading-6 text-ink-300">
      <div className="mb-3 flex justify-between gap-3"><h3 className="text-xs font-medium uppercase tracking-wide text-ink-500">{title}</h3><button type="button" disabled={busy||isBuilt} className="text-xs text-ink-400 underline" onClick={()=>change(field)}>Change in chat</button></div>{content}</section>)}
    {selected.trainingNotes.length>0&&<section className="rounded-xl border border-emerald-900/70 bg-emerald-950/10 p-5 text-sm"><h3 className="font-medium">Keep for training</h3>
     <ul className="mt-3 list-disc pl-4 space-y-2 text-ink-300">{selected.trainingNotes.map((s,i)=><li key={i}>{s}</li>)}</ul><p className="mt-3 text-xs text-ink-500">Private notes are preserved with this creation draft. They are excluded from the agent’s build instructions and have not been admitted as learnings.</p></section>}
    <p className="text-xs leading-5 text-ink-400">These cards become the agent’s definition. Private notes are kept separately and are not yet applied. Input and output descriptions reach your builder as instructions; Setup verifies the resulting contracts and permissions.</p>
    <details className="text-xs text-ink-400"><summary className="cursor-pointer">Exact build request</summary><pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-ink-800 p-4">{composeNoteWithFiles(selected.buildIntent||'',files,ATTACH_BUILD_MARKER)}</pre></details>
    {!isBuilt&&<div className="flex flex-wrap items-center gap-4"><button type="button" className="btn-primary" disabled={busy||isPending} onClick={buildAgent}>Build this agent</button>
     <button type="button" className="text-sm text-ink-400 underline disabled:opacity-40" disabled={busy||!previousPrepared} onClick={undo}>Undo last change</button>
     <p className="text-xs text-ink-500">No run, permission grant or media purchase.</p></div>}
   </>}
   {isBuilt&&!data?.withdrawn&&<div role="status" className="rounded-xl border border-emerald-800 p-5 text-sm"><p>Build queued through your connected engine. This is not yet a built or tested agent. If it fails, copy these cards to a new draft.</p><Link className="mt-3 inline-block underline" href={AGENTS_RUNNING_HREF}>View your agents →</Link></div>}
   {notice&&<p role="status" className="text-sm text-ink-400">{notice}</p>}
   {error&&<p role="alert" className="rounded-lg border border-amber-700 p-3 text-sm">{error.replaceAll('_',' ')}</p>}
  </div>
  <aside className="min-w-0 lg:sticky lg:top-6"><div className="flex min-h-[460px] max-h-[760px] h-[calc(100dvh-13rem)] flex-col gap-4 rounded-xl border border-ink-800 bg-ink-900/20 p-5">
   <h2 className="text-lg font-medium">Create with Implexa</h2>
   <button type="button" className="self-start text-xs text-ink-500 underline" disabled={!draftId||busy} onClick={()=>load(draftId)}>Refresh saved draft</button>
   {!!data?.recentDrafts?.length&&<label className="text-xs text-ink-500">Private draft history<select aria-label="Private draft history" className="mt-1 w-full rounded border border-ink-700 bg-ink-950 p-2" disabled={busy} value={draftId} onChange={e=>{active.current=e.target.value;setDraftId(e.target.value);setData(null);setSelectedId(null);setQueued(false);setText('');pending.current=null;seed.current=null;resetFiles();try{sessionStorage.setItem(storageKey,e.target.value);}catch{}}}>
    {!data.recentDrafts.some(d=>d.draft_id===draftId)&&<option value={draftId}>Current draft</option>}{data.recentDrafts.map(d=><option key={d.draft_id} value={d.draft_id}>{new Date(d.updated_at).toLocaleString()}{d.withdrawn?' · Withdrawn':''}</option>)}
   </select></label>}
   {data&&!data.withdrawn&&data.totalTurns>data.turns.length&&<p className="text-xs text-ink-500">Showing recent exchanges. All earlier messages remain in this private draft’s history.</p>}
   <ol aria-label="Agent creation conversation" className="min-h-20 flex-1 space-y-4 overflow-y-auto text-sm leading-6">{data?.turns.map(t=><li key={t.turnId} className="border-t border-ink-800 pt-3">
    <p className="whitespace-pre-wrap"><strong>You:</strong> {t.message}</p>{t.reply&&<p className="mt-2 whitespace-pre-wrap"><strong>Implexa:</strong> {t.reply}</p>}
    {t.status==='pending'&&<p className="mt-2 text-amber-300">Reply not confirmed. Refresh only reads saved state. If it stays pending, copy the selected cards to a new draft, or choose New draft; the original message stays preserved.</p>}
    {t.status==='failed'&&<p className="mt-2 text-amber-300">Your message is preserved. This draft reply could not be prepared: {t.reason?.replaceAll('_',' ')}.</p>}
    {t.questions.length>0&&<ul className="mt-2 list-disc pl-4">{t.questions.map((q,i)=><li key={i}>{q}</li>)}</ul>}
    {t.brief&&t.replyId!==selectedId&&<button type="button" className="mt-2 text-xs text-ink-400 underline" disabled={busy||isBuilt} onClick={()=>choose(t)}>Use this saved draft</button>}
   </li>)}</ol>
   <fieldset disabled={busy||isBuilt}><AttachFiles files={files} canAttach={canAttach} canAttachFolder={canAttachFolder} onAttach={()=>attachFile()} onAttachFolder={()=>attachFolder()} onRemove={removeFile} error={attachError} hint="Files stay local and are passed to the builder when you choose Build."/></fieldset>
   <label className="block text-sm">Message Implexa<textarea ref={composer} className="mt-2 block w-full min-h-24 rounded-lg border border-ink-700 bg-ink-950 p-3" maxLength={2000} value={text}
    disabled={busy||isBuilt||isPending} onChange={e=>setText(e.target.value)} placeholder="What should this agent do?"/></label>
   <p className="text-xs leading-5 text-ink-500">Send shares this chat and prepared draft with Claude Haiku 5.5 and saves them privately. Attached files stay local; Build passes their paths to your own engine.</p>
   <button type="button" className="btn-primary" disabled={!draftId||busy||isBuilt||isPending||!text.trim()} onClick={send}>{busy?'Working…':'Send'}</button>
   <details className="text-xs text-ink-500"><summary>Private draft retention</summary><p className="mt-2">Messages and replies stay in your private history with no automatic expiry. Withdrawal stops future model preparation and builds from this draft; it retains the original evidence and does not cancel an existing build.</p><button type="button" className="mt-2 underline" disabled={busy||data?.withdrawn||!data?.turns.length} onClick={withdraw}>Withdraw this draft from further use</button></details>
  </div></aside>
 </section>;
}
