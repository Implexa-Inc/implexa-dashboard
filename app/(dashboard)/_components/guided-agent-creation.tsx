'use client';

import {AGENTS_RUNNING_HREF} from '@/lib/navigation';
import {ChatFrame,ChatMessage,ChatComposer,ChatChoices} from './agent-chat';
import {creationQuestionChoices} from '@/lib/agent-creation-brief';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {createAgentBuild,retrySavedBuild} from '@/lib/plan-review';
import {fileName,MAX_RUN_FILES,composeNoteWithFiles,useRunAttachments,ATTACH_BUILD_MARKER} from './run-attachments';
import {isCreationDraftRead,type CreationDraftRead,type CreationTurn} from '@/lib/agent-creation-brief';

const documentFormats = /\.(txt|md|markdown|csv|tsv)$/i;

async function readDraftDocument(file: File): Promise<string> {
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new window.FileReader();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = () => reject(new Error(`Could not read ${file.name}. Select the file again.`));
  reader.readAsArrayBuffer(file);
 });
 let content: string;
 try { content = new TextDecoder('utf-8', {fatal:true}).decode(buffer); }
 catch { throw new Error(`Save ${file.name} as UTF-8 text and attach it again.`); }
 if (!content.trim() || /[\u0000-\u0008\u000e-\u001f]/.test(content)) throw new Error(`${file.name} has no readable document text.`);
 return content;
}

/** The composer can sit inside a clipped conversation. Position the disclosure
 * in the viewport and close it when its anchor moves. */
function AttachmentMenu({children,disabled}:{children:React.ReactNode;disabled:boolean}){
 const trigger=useRef<HTMLButtonElement>(null), container=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<React.CSSProperties|null>(null);
 const close=()=>setPosition(null);
 useEffect(()=>{
  if(!position)return;
  const outside=(event:Event)=>{if(!container.current?.contains(event.target as Node))close();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){close();trigger.current?.focus();}};
  const scroll=(event:Event)=>{if(!container.current?.contains(event.target as Node))close();};
  document.addEventListener('pointerdown',outside);
  document.addEventListener('focusin',outside);
  document.addEventListener('keydown',escape);
  window.addEventListener('resize',close);
  window.addEventListener('scroll',scroll,true);
  return ()=>{
   document.removeEventListener('pointerdown',outside);
   document.removeEventListener('focusin',outside);
   document.removeEventListener('keydown',escape);
   window.removeEventListener('resize',close);
   window.removeEventListener('scroll',scroll,true);
  };
 },[position]);
 return <div ref={container}>
  <button ref={trigger} type="button" aria-label="Add attachments" title="Add attachments" aria-expanded={!!position} disabled={disabled}
   className="flex h-10 w-10 items-center justify-center rounded-full text-ink-200 hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
   onClick={event=>{
    if(position){close();return;}
    const rect=event.currentTarget.getBoundingClientRect();
    const above=rect.top>=210||rect.top>window.innerHeight-rect.bottom;
    const space=above?rect.top:window.innerHeight-rect.bottom;
    setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-264)),maxHeight:space-16,
     ...(above?{bottom:window.innerHeight-rect.top+6}:{top:rect.bottom+6})});
   }}>
   <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
  </button>
  <div hidden={!position} role="group" aria-label="Attachment options" style={position??undefined}
   className="fixed z-50 w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl border border-ink-700 bg-ink-900 p-1.5 shadow-xl"
   onClick={event=>{if((event.target as Element).closest('button')){close();trigger.current?.focus();}}}>
   {children}
  </div>
 </div>;
}

/** Prepared cards over the existing plan/build gate. This component grants no
 * tools, starts no runs and stores no private conversation in a definition. */
export default function GuidedAgentCreation({ownerId,connected=false}:{ownerId:string;connected?:boolean}){
 const [draftId,setDraftId]=useState(''),[data,setData]=useState<CreationDraftRead|null>(null),[selectedId,setSelectedId]=useState<string|null>(null);
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [queued,setQueued]=useState(false);
 const [documents,setDocuments]=useState<File[]>([]);
 const [offerReference,setOfferReference]=useState(false);
 const documentPicker=useRef<HTMLInputElement>(null);
 const pending=useRef<{draftId:string;turnId:string;message:string;baseReplyId:string|null;baseDraftId:string|null}|null>(null),seed=useRef<{draftId:string;replyId:string}|null>(null),active=useRef(''),composer=useRef<HTMLTextAreaElement>(null);
 const {files,canAttach,canAttachFolder,attachFile,attachFolder,removeFile,reset:resetFiles,error:attachError}=useRunAttachments();
 const storageKey=`implexa-creation-draft:${ownerId}`,selectionKey=(id:string)=>`${storageKey}:${id}:selection`;
 useEffect(()=>{let saved:string|null=null;try{saved=sessionStorage.getItem(storageKey);}catch{}
  const id=saved&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(saved)?saved:crypto.randomUUID();
  setData(null);setSelectedId(null);setText('');setDocuments([]);setOfferReference(false);resetFiles();setQueued(false);pending.current=null;seed.current=null;
  setDraftId(id);active.current=id;try{sessionStorage.setItem(storageKey,id);}catch{};
  return()=>{active.current='';};
 },[storageKey]);
 const apply=(value:CreationDraftRead)=>{
  setData(value);const prepared=value.turns.filter(t=>t.status==='answered'&&t.replyId);
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
 const selected=data?.turns.find(t=>t.replyId===selectedId&&t.status==='answered')||null;
 const prepared=data?.turns.filter(t=>t.status==='answered'&&t.brief&&t.replyId)||[];
 const isPending=data?.turns.some(t=>t.status==='pending')===true;
 const isBuilt=queued||!!data?.buildRequestId||data?.withdrawn===true;
 const starting=!data?.turns.length&&!isBuilt;
 const focusedDraft=useRef('');
 useEffect(()=>{
  const area=composer.current;
  if(!draftId||data?.draftId!==draftId||busy||isBuilt||isPending||focusedDraft.current===draftId||!area||area.disabled||area.closest('details:not([open])'))return;
  area.focus({preventScroll:true});focusedDraft.current=draftId;
 },[draftId,data?.draftId,busy,isBuilt,isPending]);
 const choose=(turn:CreationTurn)=>{setSelectedId(turn.replyId);try{sessionStorage.setItem(selectionKey(draftId),turn.replyId!);}catch{}};
 const send=async({retry,choice}:{retry?:CreationTurn;choice?:string}={})=>{
  const fromComposer=!retry&&choice===undefined;
  if(busy||isBuilt||isPending||!draftId||(fromComposer&&!text.trim()&&!documents.length&&!files.length))return;
  const identity=draftId;
  const usePlan=!retry||retry.mode==='playbook';
  let message=retry?.message??choice??text;
  setBusy(true);setError('');
  try {
   if(fromComposer&&(documents.length||files.length)){
    const parts=await Promise.all(documents.map(async file=>({name:file.name,content:await readDraftDocument(file)})));
    const references=files.length
     ? `Attached references (names only; contents unavailable while drafting this plan): ${JSON.stringify(files.map(fileName))}`
     : '';
    message=[text, ...parts.map(part=>`Attached document ${JSON.stringify(part.name)}\n${part.content}`),references]
     .filter(Boolean).join('\n\n');
   }
   if(active.current!==identity)return;
   if(message.length>20000||new Blob([JSON.stringify(message)]).size>24000)throw Error('This message and its documents exceed the planner limit. Send a shorter excerpt (up to 20,000 characters and 24 KB).');
  }catch(e){if(active.current===identity){setError(e instanceof Error?e.message:'Could not read the document.');setBusy(false);}return;}
  const baseReplyId=retry?retry.baseReplyId:selected?.replyId||seed.current?.replyId||null;
  const baseDraftId=retry?retry.baseDraftId||null:selected?null:seed.current?.draftId||null;
  const turn=pending.current&&pending.current.draftId===identity&&pending.current.message===message&&pending.current.baseReplyId===baseReplyId&&pending.current.baseDraftId===baseDraftId
   ?pending.current:{draftId:identity,turnId:crypto.randomUUID(),message,baseReplyId,baseDraftId};
  pending.current=turn;setBusy(true);setError('');setNotice('');
  try{const r=await fetch('/api/agents/creation-draft',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',body:JSON.stringify({...turn,consent:true,...(usePlan?{mode:'playbook'}:{})})});
   const v=await r.json();if(active.current!==identity)return;
   if(!r.ok||!isCreationDraftRead(v,identity))throw Error(v.reason||'creation_brief_unconfirmed');
   apply(v);const answer=v.turns.find(t=>t.turnId===turn.turnId);
   if(answer?.status==='answered'&&answer.replyId){choose(answer);setNotice(answer.brief?'Draft updated. Review it or keep chatting.':'');}
   if(fromComposer){setText('');setDocuments([]);setOfferReference(false);}pending.current=null;seed.current=null;
  }catch(e){if(active.current===identity)setError(`${e instanceof Error?e.message:'creation_brief_unconfirmed'}. Refresh the saved draft before sending again; no automatic retry is made.`);}
  finally{if(active.current===identity)setBusy(false);}
 };
 const change=(field:string)=>{setText(`Change ${field}: `);composer.current?.focus();};
 const withdraw=async()=>{if(busy||!draftId)return;const identity=draftId;setBusy(true);setError('');try{
  const r=await fetch('/api/agents/creation-draft',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',body:JSON.stringify({draftId,turnId:crypto.randomUUID(),action:'withdraw'})});const v=await r.json();
   if(active.current!==identity)return;if(!r.ok||!isCreationDraftRead(v,identity))throw Error(v.reason||'Withdrawal unconfirmed');apply(v);setText('');setDocuments([]);setOfferReference(false);setNotice('Draft withdrawn from future model preparation and builds. Its raw history remains privately retained. This does not erase it, cancel a queued build or remove cards from an agent already built.');
 }catch(e){if(active.current===identity)setError(e instanceof Error?e.message:'Withdrawal unconfirmed');}finally{if(active.current===identity)setBusy(false);}};
 const previousPrepared=data?.turns.find(t=>t.replyId===selected?.baseReplyId);
 const undo=()=>{if(previousPrepared){choose(previousPrepared);setNotice('Previous saved draft restored. No AI call was made.');}};
 const startNew=()=>{if(busy)return;setDocuments([]);setOfferReference(false);seed.current=selected?.replyId?{draftId,replyId:selected.replyId}:null;const id=crypto.randomUUID();active.current=id;setDraftId(id);setData(null);setSelectedId(null);setText(seed.current?'Create another agent using the selected saved draft.':'');setQueued(false);resetFiles();setError('');setNotice(seed.current?'The selected cards will seed the new draft when you Send. Their private training notes stay separate. The earlier draft and build remain preserved.':'New private draft.');pending.current=null;
  try{sessionStorage.setItem(storageKey,id);}catch{};};
 const buildAgent=async()=>{
  if(!selected?.brief||!selected.replyId||!selected.replyDigest||!selected.buildIntent||busy||isPending||isBuilt)return;
  const intent=composeNoteWithFiles(selected.buildIntent,files,ATTACH_BUILD_MARKER);
  if(intent.length>20000){setError('These attachments make the build request too long. Remove some before building; nothing has been truncated.');return;}
  const identity=draftId;setBusy(true);setError('');
  try{const r=await createAgentBuild({intent:'',creationDraftBinding:{draftId,replyId:selected.replyId,replyDigest:selected.replyDigest},creationDraftFiles:files});
   if(active.current!==identity)return;if(!r.ok)throw Error(r.error||'Build unconfirmed');setQueued(true);window.dispatchEvent(new window.Event('agent-build-changed'));void load(identity);
  }catch(e){if(active.current===identity)setError(e instanceof Error?e.message:'Build unconfirmed. Refresh before trying again.');}
  finally{if(active.current===identity)setBusy(false);}
 };
 const draftDetails=<div className="space-y-3">
   <p className="text-reading">Send shares this conversation and the prepared draft with Claude Haiku 5.5. Text files help Tukido draft the plan. Reference files and folders stay on your computer and are available to the builder.</p>
   <button type="button" className="underline" disabled={!draftId||busy} onClick={()=>load(draftId)}>Refresh saved draft</button>
   {!!data?.recentDrafts?.length&&<label className="block">Private draft history<select aria-label="Private draft history" className="mt-1 w-full rounded border border-ink-700 bg-ink-950 p-2" disabled={busy} value={draftId} onChange={e=>{active.current=e.target.value;setDraftId(e.target.value);setData(null);setSelectedId(null);setQueued(false);setText('');setDocuments([]);setOfferReference(false);pending.current=null;seed.current=null;resetFiles();try{sessionStorage.setItem(storageKey,e.target.value);}catch{}}}>
    {!data.recentDrafts.some(d=>d.draft_id===draftId)&&<option value={draftId}>Current draft</option>}{data.recentDrafts.map(d=><option key={d.draft_id} value={d.draft_id}>{new Date(d.updated_at).toLocaleString()}{d.withdrawn?' · Withdrawn':''}</option>)}
   </select></label>}
   <p className="text-reading">Messages stay in your private history. Withdrawal stops further preparation and builds from this draft; it does not cancel queued work.</p><button type="button" className="underline" disabled={busy||data?.withdrawn||!data?.turns.length} onClick={withdraw}>Withdraw this draft from further use</button>
  </div>;
 const attachmentsDisabled=busy||isBuilt||isPending;
 const menuRow="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-ui text-ink-100 hover:bg-ink-800 focus-visible:bg-ink-800 disabled:opacity-40";
 const attachmentControls=<>
  <input hidden ref={documentPicker} type="file" multiple aria-label="Select files" onChange={event=>{
   const picked=Array.from(event.currentTarget.files||[]);event.currentTarget.value='';
   if(!picked.length)return;
   setOfferReference(false);
   const readable=picked.filter(file=>documentFormats.test(file.name)&&file.size<=24000);
   const next=[...documents,...readable];
   if(next.length>8||next.reduce((total,file)=>total+file.size,0)>24000){setError('Attach up to eight documents totaling 24 KB, or paste a shorter excerpt.');return;}
   setDocuments(next);
   if(readable.length===picked.length){setError('');return;}
   setOfferReference(canAttach);
   setError(canAttach?'Paste the relevant text, or choose this file as a reference for the builder.':'Paste the relevant text, or attach a text, Markdown, CSV or TSV file up to 24 KB.');
  }}/>
  <AttachmentMenu key={draftId} disabled={attachmentsDisabled}>
   <button type="button" className={menuRow} disabled={attachmentsDisabled} onClick={()=>documentPicker.current?.click()}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 13.5l7-7a2.1 2.1 0 0 1 3 3l-9 9a4 4 0 1 1-5.7-5.6l9.3-9.3"/></svg>
    Attach file
   </button>
   {canAttachFolder&&<button type="button" className={menuRow} disabled={attachmentsDisabled||files.length>=MAX_RUN_FILES} onClick={()=>void attachFolder()}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M3 6h6l2 2h10v12H3z"/></svg>Attach folder
   </button>}
  </AttachmentMenu>
 </>;
 const selections=[
  ...documents.map((file,i)=>({name:file.name,when:'',remove:()=>setDocuments(current=>current.filter((_,idx)=>idx!==i))})),
  ...files.map((path,i)=>({name:fileName(path),when:'Reference',remove:()=>removeFile(i)})),
 ];
 const attachmentPreview=<>
  {!!selections.length&&<ul className="flex flex-wrap gap-2">{selections.map((item,i)=><li key={i} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-ink-700 px-2 text-secondary">
   <span className="truncate">{item.name}</span>{item.when&&<small className="shrink-0 text-ink-400">{item.when}</small>}
   <button disabled={attachmentsDisabled} type="button" aria-label={`Remove ${item.name}`} onClick={item.remove}>×</button>
  </li>)}</ul>}
  {offerReference&&<button type="button" className="text-secondary underline" disabled={attachmentsDisabled||files.length>=MAX_RUN_FILES} onClick={()=>{
   setOfferReference(false);setError('');void attachFile();
  }}>Choose file as reference</button>}
  {attachError&&<p role="alert" className="text-secondary text-state-needs">{attachError}</p>}
 </>;
 const buildLabel=selected?.brief?.plan?'Approve plan and build':'Build this agent';
 // The plan cards sit in a second column that scrolls away from the chat, so the
 // person finishing the conversation never saw the way forward. This keeps the
 // same build action where they are looking. It builds the SELECTED saved draft,
 // exactly like the button under the cards, and says so when that is not the
 // newest one or when a question is still open.
 const openQuestion=!!selected?.questions?.[0];
 const earlierDraft=!!selected?.replyId&&prepared.length>0&&prepared[prepared.length-1].replyId!==selected.replyId;
 const buildCue=selected?.brief&&!isBuilt?<div role="status" data-testid="chat-build-cue" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-950 px-4 py-3">
  <p className="min-w-[14rem] flex-1 text-ui text-ink-200"><strong className="font-medium">{isPending?'Preparing your reply…':openQuestion?'You can build now, or answer first.':'Your plan is ready.'}</strong>{' '}
   <span className="text-ink-400">{isPending?'Build is available once the reply is saved.':earlierDraft?'This builds the earlier saved draft you selected.':openQuestion?'Building now uses the plan as it stands.':'Review the plan, or keep chatting to change it.'}</span></p>
  <button type="button" className="btn-primary shrink-0" disabled={busy||isPending} onClick={buildAgent}>{buildLabel}</button>
 </div>:null;
 const chatComposer=<ChatComposer micIcon inlineAttachments attachmentPreview={attachmentPreview} attachedMessage={documents.length>0||files.length>0} maxLength={Infinity} voiceScope={draftId||'creation-start'} standalone={starting} details={starting?draftDetails:undefined} value={text} onChange={setText} onSend={()=>void send()} disabled={isBuilt||isPending} sending={busy} sendDisabled={!draftId} textareaRef={composer} placeholder={starting?'Describe the job, paste the steps, or attach a playbook…':'Add a detail or ask for a change…'} attachments={attachmentControls}/>;
 return <section className={starting?"mx-auto max-w-3xl space-y-4":"grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]"}>
  <aside className={starting?"min-w-0":"min-w-0 lg:sticky lg:top-6"}>{starting?chatComposer:<ChatFrame contentSized scrollKey={data?.turns.at(-1)?.turnId+':'+data?.turns.at(-1)?.status} title="Chat with AI" subtitle="Build your agent" details={draftDetails} composer={<>{buildCue}{chatComposer}</>}>
   {data&&!data.withdrawn&&data.totalTurns>data.turns.length&&<p className="text-secondary text-ink-500">Showing recent exchanges. Earlier messages are saved in this draft.</p>}
   <ol aria-label="Agent creation conversation" className="space-y-6">{data?.turns.map(t=><li key={t.turnId} className="space-y-3">
    <ChatMessage role="user"><>{t.mode==='playbook'&&t.message.length>600?<details><summary>View full message</summary><p className="whitespace-pre-wrap">{t.message}</p></details>:<p className="text-reading whitespace-pre-wrap">{t.message}</p>}</></ChatMessage>{t.reply&&<ChatMessage role="assistant"><p className="text-reading whitespace-pre-wrap">{t.reply}</p></ChatMessage>}
    {t.status==='pending'&&<p className="text-reading text-ink-400">Your message is saved. <button type="button" className="underline" disabled={busy} onClick={()=>load(draftId)}>Check for the reply</button></p>}
    {t.status==='failed'&&<p role="status" className="text-reading text-state-needs">Your message is saved. The reply couldn’t be prepared. {t===data.turns.at(-1)&&!isBuilt&&<button type="button" className="underline" disabled={busy||isPending} onClick={()=>void send({retry:t})}>Retry message</button>}</p>}
    {t.brief&&t.replyId!==selectedId&&<button type="button" className="text-ui text-ink-400 underline" disabled={busy||isBuilt} onClick={()=>choose(t)}>Use this saved draft</button>}
   </li>)}</ol>
   {selected?.questions?.[0]&&!isBuilt&&<ChatChoices question={selected.questions[0]} choices={creationQuestionChoices(selected.answerOptions)} disabled={busy||isPending} onChoose={value=>{if(value)void send({choice:value});else composer.current?.focus();}}/>}
  </ChatFrame>}</aside>
  <div className="min-w-0 space-y-5">
   {!starting&&<div className="flex items-center justify-between gap-4"><p className="text-reading uppercase tracking-[.18em] text-ink-500">Your agent, prepared with you{selected?.brief&&!isBuilt&&<span className="ml-3 rounded border border-ink-700 px-2 py-1 normal-case tracking-normal">Draft</span>}</p>
    <button type="button" className="text-ui text-ink-400 underline" disabled={busy} onClick={startNew}>{selected?'Copy to a new draft':'New draft'}</button></div>}
   {!starting&&!selected?.brief&&<div className="rounded-xl border border-ink-800 p-6"><h2 className="text-xl font-medium">{data?.withdrawn?'This draft is withdrawn.':selected?'A few details, then your agent is ready.':'Start with the job you want done.'}</h2>
    <p className="mt-3 text-reading text-ink-400">{data?.withdrawn?'Choose New draft to start again. This draft can no longer prepare replies or queue a build.':selected?'Answer the next question in chat. Your goal, tools, input and output will appear here.':'Explain it in chat. Tukido will prepare the goal, tools, input and output for you. Nothing is built until you choose Build.'}</p></div>}
   {selected?.brief&&<>
    {([['The goal','goal',<><h2 className="text-lg font-medium">{selected.brief.name}</h2><p className="mt-3">{selected.brief.goal}</p></>],
     ['What it receives','inputs',<ul className="list-disc pl-4 space-y-2">{selected.brief.inputs.map((s,i)=><li key={i}>{s}</li>)}</ul>],
     ['What it delivers','outputs',<ul className="list-disc pl-4 space-y-2">{selected.brief.outputs.map((s,i)=><li key={i}>{s}</li>)}</ul>],
     ['Tools and methods','tools',<>
       {selected.brief.plan?.sources.map(source=><div key={source.name} className="mb-3"><strong>{source.name}</strong><p>{source.purpose}</p><p>Recommended · {source.routes[0]}{source.domain?' · '+(source.browserRead?.url||source.domain):''}</p>{source.routes.length>1&&<p>Users can also choose {source.routes.slice(1).join(' or ')} in Setup.</p>}</div>)}
       <ul className="space-y-2">{selected.tools.filter(t=>!selected.brief?.plan?.sources.some(s=>s.name.toLowerCase()===t.name.toLowerCase())).map(t=><li key={t.name}><strong>{t.name}</strong> · {t.requirement==='required'?'Required':'Preferred'}{t.purpose&&<p>{t.purpose}</p>}<p>{t.method&&t.method!=='Confirm in Setup'?'Suggested access: '+t.method:t.routes?.length?'Suggested access: '+t.routes[0]:'Access method to confirm in Setup'}</p>
       {!!t.routes?.filter(route=>route!==(t.method||t.routes?.[0])).length&&<p>Other supported methods: {t.routes.filter(route=>route!==(t.method||t.routes?.[0])).join(' or ')}</p>}
       {t.method&&t.method!=='Provided file'&&t.method!=='Confirm in Setup'&&!t.routes?.includes(t.method)&&<p>Setup must verify this method.</p>}</li>)}</ul>
       {!selected.tools.length&&!selected.brief.plan?.sources.length&&<p>No specific tool requested.</p>}
       {!!selected.brief.plan?.operations?.length&&<p className="mt-3">{selected.brief.plan.operations.join(' · ')}</p>}
     </>]] as const).map(([title,field,content])=><section key={field} className="rounded-xl border border-ink-800 p-5 text-secondary leading-6 text-ink-300">
      <div className="mb-3 flex justify-between gap-3"><h3 className="text-ui font-medium uppercase tracking-wide text-ink-500">{title}</h3><button type="button" disabled={busy||isBuilt} className="text-ui text-ink-400 underline" onClick={()=>change(field)}>Change in chat</button></div>{content}</section>)}
    {selected.brief.plan&&<section className="space-y-3 rounded-xl border border-ink-800 p-5">
     <div className="flex justify-between"><h3>Execution plan</h3><button type="button" className="underline" disabled={busy||isBuilt} onClick={()=>change('the plan or allowed access methods')}>Change in chat</button></div>
     <ol className="list-decimal space-y-2 pl-5">{selected.brief.plan.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>
     {selected.brief.plan.runInputs && (['start','after_review'] as const).map(stage=>{
       const inputs=selected.brief!.plan!.runInputs!.filter(field=>field.collection===stage);
       return inputs.length>0 && <div key={stage}><h4>{stage==='start'?'Enter each run':'After reviewing the first result'}</h4><ul>{inputs.map(f=><li key={f.key}>{f.label}</li>)}</ul></div>;
     })}
     <h4>Checks before delivery</h4><ul className="list-disc pl-5">{selected.brief.plan.checks.map((check,i)=><li key={i}>{check}</li>)}</ul>
    </section>}
    {selected.trainingNotes.length>0&&<section className="rounded-xl border border-emerald-900/70 bg-emerald-950/10 p-5 text-secondary"><h3 className="font-medium">Keep for training</h3>
     <ul className="mt-3 list-disc pl-4 space-y-2 text-ink-300">{selected.trainingNotes.map((s,i)=><li key={i}>{s}</li>)}</ul><p className="mt-3 text-reading text-ink-500">Private notes are preserved with this creation draft. They are excluded from the agent’s build instructions and have not been admitted as learnings.</p></section>}

    <details className="text-secondary text-ink-400"><summary className="cursor-pointer">Exact build request</summary><pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-ink-800 p-4">{composeNoteWithFiles(selected.buildIntent||'',files,ATTACH_BUILD_MARKER)}</pre></details>
    {!isBuilt&&<div className="flex flex-wrap items-center gap-4"><button type="button" className="btn-primary" disabled={busy||isPending} onClick={buildAgent}>{buildLabel}</button>
     <button type="button" className="text-ui text-ink-400 underline disabled:opacity-40" disabled={busy||!previousPrepared} onClick={undo}>Undo last change</button>
</div>}
   </>}
   {isBuilt&&!data?.withdrawn&&<div role="status" className="rounded-xl border border-emerald-800 p-5 text-secondary"><p>{data?.buildCanRetry?'The build failed. Your approved draft and attachments are saved.':connected||typeof window!=='undefined'&&!!window.implexaDesktop?.handoffAgent?'Follow your build at the top of the dashboard.':'Your build request is saved. Connect Claude or Codex in Setup to build it.'}</p>{data?.buildCanRetry && data.buildRequestId && <button type="button" className="btn-primary mt-3" disabled={busy} onClick={async()=>{
     const identity=draftId;setBusy(true);setError('');
     try{await retrySavedBuild(data.buildRequestId!);if(active.current===identity)await load(identity);}
     catch{if(active.current===identity)setError('Could not confirm the retry. Refresh build status.');}
     finally{if(active.current===identity)setBusy(false);}
   }}>Retry build</button>}{!connected&&<Link className="mr-5 mt-3 inline-block underline" href="/install">Connect Claude or Codex</Link>}<Link className="mt-3 inline-block underline" href={AGENTS_RUNNING_HREF}>View your agents →</Link></div>}
   {notice&&<p role="status" className="text-reading text-ink-400">{notice}</p>}
   {error&&<p role="alert" className="rounded-lg border border-amber-700 p-3 text-reading">{error.replaceAll('_',' ')}</p>}
  </div>

 </section>;
}
