'use client';
import {useEffect,useRef,useState} from 'react';
import Modal from '../../_components/modal';
import ImproveAgent from '../../_components/improve-agent';
import {TrainingInfo} from './training-workspace';
import {ChatFrame,ChatMessage,ChatComposer} from '../../_components/agent-chat';

type Source={sourceId:string;localName?:string;metadata:{sha256:string;mediaType:string;durationMs:number}};
type Action='none'|'analyse_tool_method'|'analyse_taste'|'review_method'|'review_agent_update'|'review_teaching'|'test_agent';
type Turn={turnId:string;versionId:string;sourceId:string|null;sourceSha256:string|null;message:string;createdAt:string;
 canProposeEdit?:boolean;
 sourceKind?:'creation_notes'|'trainer_feedback';
 status:'pending'|'answered'|'failed'|'stale';answer:string|null;action:Action;reason:string|null};
type Context={agent:{id:string;name:string;slug:string;versionId:string};boundMethods:Array<{stageIndex:number;source:string;slug:string;contentDigest:string}>;
 researchMethodPresent:boolean;source:{sourceId:string;sha256:string}|null;availableActions:Action[]};
type Reply={ok:boolean;reason?:string;contractVersion?:string;canSend?:boolean;turns?:Turn[];turn?:Turn;context?:Context|null;totalTurns?:number};
export type TrainingChatRequest={key:string;target:{kind:'feedback'|'record';id:string;digest:string};prompt:string};
const names:Record<Action,string>={none:'',analyse_tool_method:'Analyze the recording’s tool method',analyse_taste:'Analyze the recording’s taste',
 review_method:'Review the operating method',review_agent_update:'Review the agent update',review_teaching:'Review the teaching',test_agent:'Open the agent to test'};
const validTurn=(v:Turn)=>v&&typeof v.turnId==='string'&&typeof v.versionId==='string'&&typeof v.message==='string'
 &&['pending','answered','failed','stale'].includes(v.status)&&Object.hasOwn(names,v.action);
const contextMatches=(v:Context|null|undefined,versionId:string|null,sourceId:string|null,sha:string|null,slug:string)=>!!v
 &&v.agent?.versionId===versionId&&v.agent.slug===slug&&(v.source?.sourceId||null)===sourceId&&(v.source?.sha256||null)===sha
 &&typeof v.researchMethodPresent==='boolean'&&Array.isArray(v.boundMethods)
 &&v.boundMethods.every(m=>typeof m.slug==='string'&&/^[a-f0-9]{64}$/.test(m.contentDigest))
 &&Array.isArray(v.availableActions)&&v.availableActions.every(a=>Object.hasOwn(names,a));
export default function TrainingChat({sessionId,versionId,slug,sources,selectedSourceId,disabled,busy=false,embedded=false,onAttach,onClose,onSelectSource,onAction,guided=false,automaticInclusion=false,request,onSaved,editUnavailable=false}:{
 sessionId:string;versionId:string|null;slug:string;sources:Source[];selectedSourceId:string|null;disabled:boolean;busy?:boolean;
 editUnavailable?:boolean;embedded?:boolean;onAttach?:()=>void;onClose?:()=>void;
 guided?:boolean;automaticInclusion?:boolean;request?:TrainingChatRequest|null;onSaved?:()=>void;
 onSelectSource:(id:string)=>void;onAction:(action:Action,binding:{versionId:string;sourceId:string|null;sourceSha256:string|null})=>Promise<void>;
}){
 const [turns,setTurns]=useState<Turn[]>([]),[context,setContext]=useState<Context|null>(null),[total,setTotal]=useState(0);
 const [opened,setOpened]=useState(embedded);
 const [text,setText]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false),[loading,setLoading]=useState(false),[canSend,setCanSend]=useState(false);
 const [editTurn,setEditTurn]=useState<Turn|null>(null);
 const [target,setTarget]=useState<TrainingChatRequest['target']|null>(null);
 const identity=`${sessionId}:${versionId}:${selectedSourceId}`,latest=useRef(identity);latest.current=identity;
 const pending=useRef<{identity:string;message:string;turnId:string;targetKey:string}|null>(null);
 const load=async(signal?:AbortSignal)=>{
  if(!sessionId)return;const captured=identity;setLoading(true);setError('');
  try{
   const q=new URLSearchParams({sessionId,...(selectedSourceId?{sourceId:selectedSourceId}:{})});
   const r=await fetch(`/api/agent-training/chat?${q}`,{cache:'no-store',signal});const v:Reply=await r.json();
   if(signal?.aborted||latest.current!==captured)return;
   if(!r.ok||!v.ok||v.contractVersion!=='training-chat.v1'||!Array.isArray(v.turns)||!v.turns.every(validTurn)
    ||(v.canSend&&!contextMatches(v.context,versionId,selectedSourceId,sources.find(s=>s.sourceId===selectedSourceId)?.metadata.sha256||null,slug)))throw Error(v.reason||'training_chat_unavailable');
   setTurns(v.turns);setTotal(v.totalTurns||0);setCanSend(v.canSend===true);setContext(v.context||null);
  }catch(e){if(!signal?.aborted&&latest.current===captured)setError(e instanceof Error?e.message:'training_chat_unavailable');}
  finally{if(latest.current===captured)setLoading(false);}
 };
 useEffect(()=>{setTurns([]);setContext(null);setCanSend(false);setText('');setTarget(null);setEditTurn(null);pending.current=null;const c=new AbortController();if(opened)void load(c.signal);return()=>c.abort();},[identity,opened]);
 useEffect(()=>{if(guided&&request){setOpened(true);setTarget(request.target);setText(request.prompt);pending.current=null;}},[request?.key,guided]);
 const source=sources.find(s=>s.sourceId===selectedSourceId);
 const send=async()=>{
  if(sending||disabled||!canSend||!versionId||!text.trim())return;
  const captured=identity,message=text;
  const targetKey=JSON.stringify(target);
  const reserved=pending.current?.identity===captured&&pending.current.message===message&&pending.current.targetKey===targetKey?pending.current:{identity:captured,message,turnId:crypto.randomUUID(),targetKey};
  pending.current=reserved;setSending(true);setError('');
  try{
   const r=await fetch(`/api/agent-training/chat?sessionId=${encodeURIComponent(sessionId)}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({turnId:reserved.turnId,expectedActiveVersionId:versionId,sourceId:selectedSourceId,message,consent:true,...(guided?{changesContract:'guided-training-changes.v1',target}:{})})});
   const v:Reply=await r.json();if(latest.current!==captured)return;
   if(!r.ok||!v.ok||v.contractVersion!=='training-chat.v1'||!v.turn||!validTurn(v.turn)||v.turn.turnId!==reserved.turnId
    ||(v.context&&!contextMatches(v.context,versionId,selectedSourceId,source?.metadata.sha256||null,slug))
    ||v.turn.versionId!==versionId||v.turn.sourceId!==selectedSourceId||v.turn.sourceSha256!==(source?.metadata.sha256||null))throw Error(v.reason||'training_chat_response_unconfirmed');
   setTurns(old=>[...old.filter(t=>t.turnId!==v.turn!.turnId),v.turn!]);setCanSend(v.canSend===true);
   if(v.context)setContext(v.context);setText('');setTarget(null);pending.current=null;onSaved?.();
  }catch(e){if(latest.current===captured)setError(`${e instanceof Error?e.message:'training_chat_response_unconfirmed'}. Refresh saved messages before sending again; a saved turn is not automatically called again.`);}
  finally{setSending(false);}
 };
 if(!opened)return <section aria-labelledby="training-chat-heading" className="rounded border border-brand-500 p-4 space-y-3">
  <h2 id="training-chat-heading" className="text-lg font-semibold">Chat with AI</h2>
  <p>Discuss this agent and turn a recording or feedback into reviewed improvements.</p>
  <button type="button" disabled={!sessionId||busy} onClick={()=>setOpened(true)}>Open conversation</button>
 </section>;
 return <><ChatFrame scrollKey={turns.at(-1)?.turnId+':'+turns.at(-1)?.status} embedded={embedded} subtitle={source?.localName||'Your agent'} onClose={onClose} details={<>  <details className="text-xs text-ink-400"><summary className="cursor-pointer">Conversation context · {source?.localName||'Agent setup'}</summary>
  <label className="block">Recording or image for this conversation<select className="block w-full rounded bg-ink-900 border p-2" value={selectedSourceId||''} disabled={sending||disabled} onChange={e=>onSelectSource(e.target.value)}>
   <option value="">Agent setup only</option>{sources.map((s,i)=><option key={s.sourceId} value={s.sourceId}>{s.localName||`Source ${i+1}`} · {s.metadata.mediaType}</option>)}
  </select></label>
  <p className="mt-2">Context: current agent setup · version {versionId?.slice(0,8)||'unavailable'}{source?' · selected source’s saved teaching and analysis notes':' · no source selected'} · up to three recent exchanges about that source.</p>
  {context&&<div id="training-chat-methods" className="text-sm space-y-1"><p>Operating methods in this version: {context.boundMethods.length||'none'}</p>
   {context.boundMethods.map(m=><p key={`${m.stageIndex}:${m.slug}`}>{m.slug.replaceAll('-',' ')} · step {m.stageIndex} · <span title={m.contentDigest}>{m.contentDigest.slice(0,12)}</span></p>)}
   {context.researchMethodPresent&&<p>Reference research assessment is already attached. It does not need a duplicate agent edit.</p>}</div>}
  <button type="button" disabled={!sessionId||loading||sending} onClick={()=>load()}>Refresh saved messages</button>
  </details>
  <div className="flex items-center justify-between text-xs text-ink-500"><span>Chat uses Claude Haiku 5.5</span><TrainingInfo label="What chat shares and saves">
  <p className="text-xs leading-5 text-ink-400">Send shares your message, this agent’s setup, selected source’s saved notes and recent chat with Claude Haiku 5.5. No recording frames or transcript are sent by this chat. Text and replies stay in private Training history.</p>
  {guided&&<p className="text-xs leading-5 text-ink-400">{automaticInclusion?'Your standing policy adds clear taste suggestions to the private candidate.':'Automatic inclusion is off; clear preferences remain suggestions unless you explicitly include them.'} Tool-method preferences need explicit inclusion. No run, public release or served update happens on Send.</p>}
  </TrainingInfo></div>
</>} composer=<ChatComposer voiceScope={`${sessionId}:${versionId}:${selectedSourceId}`} id="training-chat-message" value={text} onChange={setText} onSend={()=>void send()} disabled={disabled||!canSend} sending={sending} placeholder="Ask a question or explain what you’d change…" attachments={onAttach?<button type="button" disabled={disabled||sending} onClick={onAttach} className="rounded-lg px-3 py-1 text-xs text-ink-400 hover:text-ink-100">＋ Add an example</button>:undefined}/>>
  {turns.length===0&&!loading&&<p className="text-ink-400">What would you like to change?</p>}
  {loading&&<p role="status">Loading this conversation…</p>}
  {total>turns.length&&<p className="text-sm">Showing recent messages. Earlier exchanges remain in this private Training session’s history.</p>}
  <ol aria-label="Training conversation" className="space-y-6">{turns.map(t=>{
   const matches=t.versionId===versionId&&t.sourceId===selectedSourceId&&t.sourceSha256===(source?.metadata.sha256||null);
   const actionable=matches&&t.status==='answered'&&context?.agent.versionId===versionId&&context.availableActions.includes(t.action)&&!disabled&&canSend;
   return <li key={t.turnId} className="space-y-3">{!matches&&<p className="text-xs text-ink-500">Earlier conversation</p>}
    <ChatMessage role={t.sourceKind==='creation_notes'?'assistant':'user'}>{t.sourceKind==='creation_notes'&&<p className="text-xs text-ink-500">Creation note</p>}<p className="whitespace-pre-wrap">{t.message}</p></ChatMessage>
    {t.answer&&<ChatMessage role="assistant"><p className="whitespace-pre-wrap">{t.answer}</p></ChatMessage>}
    {t.status==='pending'&&<p>{t.sourceKind==='creation_notes'?'Private note imported from the AI-prepared creation draft. No chat reply was requested.':'Reply not yet confirmed. Refresh reads the saved turn without calling Claude again.'}</p>}
    {t.status==='failed'&&<p role="status">This reply could not be completed: {t.reason?.replaceAll('_',' ')}. Your message is preserved; no automatic retry was made.</p>}
    {t.status==='stale'&&<p>This reply belongs to an earlier agent version. Its proposed action is unavailable.</p>}
    {t.canProposeEdit===true&&guided&&matches&&t.status==='answered'&&canSend&&<button type="button" className="rounded-xl border border-ink-700 px-4 py-3 text-sm text-brand-400" disabled={disabled||sending||editUnavailable} onClick={()=>setEditTurn(t)}>Review agent change →</button>}
    {t.action!=='none'&&(t.action==='test_agent'?actionable?guided?<button type="button" disabled={sending} onClick={()=>onAction(t.action,{versionId:t.versionId,sourceId:t.sourceId,sourceSha256:t.sourceSha256})}>Review the private update’s test</button>:<a href={`/workflows/${encodeURIComponent(slug)}?source=generated`}>{names[t.action]}</a>:<span>Test entry unavailable for this earlier context.</span>:
     <button type="button" disabled={!actionable||sending} onClick={()=>onAction(t.action,{versionId:t.versionId,sourceId:t.sourceId,sourceSha256:t.sourceSha256})}>{names[t.action]}</button>)}
   </li>;
  })}</ol>
  {!canSend&&sessionId&&!loading&&<p>Sending is unavailable until this session matches the active agent version.</p>}
  {target&&<div className="rounded-lg border border-ink-700 p-3 text-xs">{target.kind==='feedback'?'Preparing a learning from the selected original feedback.':'Editing the selected teaching as a new private version.'} Nothing is sent until Send.<button type="button" disabled={sending} onClick={()=>{setTarget(null);pending.current=null;}}>Cancel selected target</button></div>}

  {error&&<p role="alert" className="text-sm text-amber-300">{error.replaceAll('_',' ')}</p>}
 </ChatFrame><Modal open={!!editTurn} onClose={()=>setEditTurn(null)} title="Review agent change">{editTurn&&<ImproveAgent key={editTurn.turnId} slug={slug} bare initialNote={editTurn.message} statusUnavailable={disabled||editUnavailable||!canSend||editTurn.versionId!==versionId} trainingChatBinding={{sessionId,turnId:editTurn.turnId,expectedActiveVersionId:editTurn.versionId}}/>}</Modal></>;
}
