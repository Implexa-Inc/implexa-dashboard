'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {MyWorkflowsRead,MyWorkflowCard} from '@/lib/workflow-catalog';
import {coachPage,coachingCounts,coachingCount,type CoachAgent,type CoachPage} from '@/lib/training-coach';
import LocalTime from './local-time';
import {humanize,oneLine} from '@/lib/inbox-items';
import {CollectionEmpty,CollectionReadError} from './collection-state';
import Modal from './modal';
import {AgentSampleThumbnail,useAgentSampleThumbnails,type CoverMap} from './agent-sample-thumbnails';

type OwnedCoachAgent=Pick<MyWorkflowCard,'slug'|'name'|'source'|'description'|'updated_at'>&{workflow_id?:string};
function AgentRows({agents,recordingId,summary,covers,loading=false,onRetry,retrying,retryable}:{agents:OwnedCoachAgent[];recordingId?:string;summary?:CoachPage;covers?:CoverMap;loading?:boolean;onRetry?:(agent:OwnedCoachAgent)=>void;retrying?:Set<string>;retryable?:Set<string>}){
 return <ul className="coach-agent-list">{agents.map(agent=>{
  const facts=summary?.agents.find(row=>row.slug===agent.slug);
  const href=`/training/${encodeURIComponent(agent.slug)}${recordingId?`?annotateRecording=${encodeURIComponent(recordingId)}`:''}`;
  return <li key={agent.slug} className="coach-agent-row">
   <div className="coach-agent-picture"><AgentSampleThumbnail cover={covers?.[facts?.id||agent.workflow_id||'']} icon="coach"/></div>
   <div><h3><Link href={href} prefetch={false}>{agent.name.trim()||humanize(agent.slug)}</Link></h3>{oneLine(agent.description)&&<p>{oneLine(agent.description)}</p>}</div>
   {!recordingId&&facts&&<>
    <div className="coach-row-decisions">{facts.versionId===null?<span className="text-ink-400">No active version</span>:facts.decisions.length===0&&facts.decisionsComplete?<span className="text-ink-400">Nothing waiting</span>:<span className="coach-decision-pill"><b>{coachingCount(facts.decisions.length,facts.decisionsComplete)}</b> to decide</span>}</div>
    <div className="coach-row-learnings" title={facts.versionId===null?'No active version; lessons are not counted':facts.liveLessons===null?'Live training unavailable':`${facts.liveLessons} live lessons`}><span><b>{facts.versionId===null?'—':facts.liveLessons===null?'?':facts.liveLessons}</b>{facts.versionId===null?' · No active version':facts.lastTaughtAt?<> · taught <LocalTime iso={facts.lastTaughtAt}/></>:facts.liveLessons===null?' · Unknown':facts.liveLessons===0?' · Not taught yet':''}</span></div>
    <div className="coach-row-marketplace"><span className={`coach-listing-pill ${facts.listing==='listed'?'listed':'idle'}`}>{({listed:'Listed',draft:'Draft listing',submitted:'In review',not_listed:'Not listed',public_not_submitted:'Public, not yet submitted for review',unknown:'Unknown'})[facts.listing]}</span></div>
   </>}
   {!recordingId&&!facts&&onRetry&&<><div className="coach-row-decisions" >{loading?'Loading counts…':<>Count unavailable <button type="button" className="underline" disabled={!!retrying?.size||!retryable?.has(agent.slug)} onClick={()=>onRetry(agent)}>{retrying?.has(agent.slug)?'Checking…':'Retry count'}</button></>}</div><div className="coach-row-learnings">—</div><div className="coach-row-marketplace">—</div></>}
   <Link href={href} prefetch={false} className="btn-outline">{recordingId?'Choose agent':facts?.decisions.length?`Review ${coachingCount(facts.decisions.length,facts.decisionsComplete)}`:'Train'}</Link>
  </li>;
 })}</ul>;
}
const filterAgents=(agents:OwnedCoachAgent[],query:string)=>{
 const needle=query.trim().toLowerCase();
 return agents.filter(agent=>!needle||`${agent.name} ${agent.description||''}`.toLowerCase().includes(needle));
};

/** One trainer-owned roster; the recording arrival is a rare target-choice dialog. */
export default function TrainingAgentPicker({owned,recordingId,partial=false,loadSummary=false}:{owned:OwnedCoachAgent[];recordingId?:string;partial?:boolean;loadSummary?:boolean}){
 const [loadedSummary,setLoadedSummary]=useState<CoachPage>(),[countsLoading,setCountsLoading]=useState(loadSummary);
 const [summaryRetry,setSummaryRetry]=useState(0);
 const [familyFacts,setFamilyFacts]=useState<Record<string,CoachAgent>>({}),[retrying,setRetrying]=useState<Set<string>>(new Set());
 const requests=useRef(new Set<AbortController>());
 const catalogKey=JSON.stringify(owned.map(a=>[a.source,a.slug,a.workflow_id]));
 const exactAgent=(slug:string)=>{const matches=owned.filter(a=>a.source==='generated'&&a.slug===slug),id=typeof matches[0]?.workflow_id==='string'?matches[0].workflow_id.toLowerCase():undefined;return matches.length===1&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id||'')&&owned.filter(a=>a.source==='generated'&&typeof a.workflow_id==='string'&&a.workflow_id.toLowerCase()===id).length===1?{...matches[0],workflow_id:id!}:null;};
 useEffect(()=>{
  if(!loadSummary)return;
  if(!owned.some(a=>a.source==='generated')){setCountsLoading(false);return;}
  const controller=new AbortController();requests.current.add(controller);const timer=setTimeout(()=>controller.abort(),5000);
  setCountsLoading(true);setLoadedSummary(undefined);setFamilyFacts({});setRetrying(new Set());
  void fetch('/api/agent-training/coach?contractVersion=training-coach-decisions.v2',{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error();const page=coachPage(await response.json());if(!page)throw Error();if(!controller.signal.aborted)setLoadedSummary(page);
  }).catch(()=>{}).finally(()=>{clearTimeout(timer);requests.current.delete(controller);if(!disposed)setCountsLoading(false);});
  let disposed=false;
  return()=>{disposed=true;clearTimeout(timer);controller.abort();for(const request of requests.current)request.abort();requests.current.clear();};
 },[loadSummary,catalogKey,summaryRetry]);
 const incoming=loadedSummary;
 const summary=useMemo(()=>{
  if(!loadSummary)return undefined;
  const facts=owned.flatMap(a=>{const exact=exactAgent(a.slug);if(!exact)return [];const row=familyFacts[exact.workflow_id!]||incoming?.agents.find(f=>f.id===exact.workflow_id&&f.slug===exact.slug);return row?.id===exact.workflow_id&&row.slug===exact.slug?[row]:[];});
  if(!incoming&&!facts.length)return undefined;
  return {ok:true,contractVersion:'training-coach-decisions.v2',savedFeedbackReady:incoming?.contractVersion==='training-coach-decisions.v2'&&incoming.savedFeedbackReady===true,agents:facts,complete:!partial&&!!incoming?.complete&&facts.length===owned.filter(a=>a.source==='generated').length} as CoachPage;
 },[incoming,familyFacts,catalogKey,loadSummary,partial]);
 async function retryFamily(agent:OwnedCoachAgent){
  const exact=exactAgent(agent.slug);if(!exact||requests.current.size>0)return;
  const controller=new AbortController();requests.current.add(controller);const timer=setTimeout(()=>controller.abort(),5000);setRetrying(previous=>new Set(previous).add(agent.slug));
  try{const response=await fetch(`/api/agent-training/coach?${new URLSearchParams({familyId:exact.workflow_id!,contractVersion:'training-coach-decisions.v2'})}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();const page=coachPage(await response.json()),row=page?.agents.length===1?page.agents[0]:null;if(!row||row.id!==exact.workflow_id||row.slug!==exact.slug)throw Error();if(!controller.signal.aborted)setFamilyFacts(previous=>({...previous,[row.id]:row}));}catch{}finally{clearTimeout(timer);const current=requests.current.has(controller);requests.current.delete(controller);if(current)setRetrying(previous=>{const next=new Set(previous);next.delete(agent.slug);return next;});}
 }

 const router=useRouter();
 const [query,setQuery]=useState(''),[all,setAll]=useState(false),[showAllWaiting,setShowAllWaiting]=useState(false);
 const [filter,setFilter]=useState<'all'|'waiting'|'listed'|'not_listed'>('all');
 const [chooseRecording,setChooseRecording]=useState(!!recordingId),[targetQuery,setTargetQuery]=useState('');
 useEffect(()=>{setChooseRecording(!!recordingId);setTargetQuery('');},[recordingId]);
 const agents=useMemo(()=>{
  const bySlug=new Map<string,OwnedCoachAgent>();
  for(const agent of owned)if(agent.source==='generated'&&!bySlug.has(agent.slug))bySlug.set(agent.slug,agent);
  // Roster timestamps determine a stable order; arriving last-taught facts
  // never reorder rows or stand in for the displayed teaching date.
  const stamp=(agent:OwnedCoachAgent)=>{const at=Date.parse(agent.updated_at||'');return Number.isFinite(at)?at:0;};
  return [...bySlug.values()].sort((a,b)=>stamp(b)-stamp(a)||a.name.localeCompare(b.name)||a.slug.localeCompare(b.slug));
 },[owned]);
 const retryable=new Set(agents.filter(a=>exactAgent(a.slug)).map(a=>a.slug));
 const identitiesComplete=retryable.size===agents.length,knownAgents=retryable.size;
 const covers=useAgentSampleThumbnails(agents.map(a=>a.workflow_id));
 const needle=query.trim().toLowerCase(),targets=filterAgents(agents,targetQuery);
 const factsFor=(slug:string)=>summary?.agents.find(agent=>agent.slug===slug);
 const shown=filterAgents(agents,query).filter(agent=>{const facts=factsFor(agent.slug);return filter==='all'||filter==='waiting'&&!!facts?.decisions.length||filter==='listed'&&facts?.listing==='listed'||filter==='not_listed'&&facts&&facts.listing!=='listed'&&facts.listing!=='unknown';});
 const closeRecording=()=>{
  setChooseRecording(false);
  const url=new URL(window.location.href);url.searchParams.delete('recordingId');
  router.replace(url.pathname+url.search+url.hash,{scroll:false});
 };
 const unavailable=<CollectionReadError title="Some agents couldn’t be checked" description="Your agents and saved training are unchanged. Try refreshing the list."/>;
 const counts=summary?coachingCounts(summary):null;
 const waiting=shown.filter(agent=>summary?.agents.some(row=>row.slug===agent.slug&&row.decisions.length>0));
 const others=shown;
 const columns=<div className="coach-column-head" aria-hidden="true"><span/><span>Agent</span><span>Decisions</span><span>Learnings</span><span>Marketplace</span><span/></div>;
 return <>
  {!counts&&loadSummary&&<div className="coach-summary-tiles" aria-label="Coaching summary"><div className="card"><b>—</b><span>{countsLoading?'Loading counts…':'Decision count unavailable'}</span></div><div className="card"><b>{coachingCount(knownAgents,!partial&&identitiesComplete)}</b><span>Agents you train</span></div><div className="card"><b>—</b><span>{countsLoading?'Loading counts…':'Listed count unavailable'}</span></div></div>}
  {counts&&<div className="coach-summary-tiles" aria-label="Coaching summary"><div className={counts.decisions?'card needs':'card'}><b>{coachingCount(counts.decisions,counts.decisionsComplete)}</b><span>Decisions waiting for you</span>{waiting[0]&&<a href="#coach-waiting">Review them →</a>}</div><div className="card"><b>{coachingCount(knownAgents,!partial&&identitiesComplete)}</b><span>Agents you train</span></div><div className="card"><b>{coachingCount(counts.listed,counts.listedComplete)}</b><span>Agents listed</span></div></div>}
  {loadSummary&&!identitiesComplete&&<p role="status" className="text-sm text-ink-400 mb-6">Some agent identities couldn’t be checked. Their counts are unavailable.</p>}
  {loadSummary&&summary?.agents.some(a=>a.versionId===null)&&<p role="status" className="text-sm text-ink-400 mb-6">{summary.agents.filter(a=>a.versionId===null).length} {summary.agents.filter(a=>a.versionId===null).length===1?'agent has':'agents have'} no active version. Their decisions and lessons aren’t counted.</p>}
  {counts&&(!counts.decisionsComplete||!counts.agentsComplete||!counts.listedComplete)&&<p className="text-xs text-ink-400 mb-6">+ means the count may be higher.</p>}
  {loadSummary&&<p role="status" className="mb-6 text-sm text-ink-400">{countsLoading?'Loading decision and lesson counts…':!summary||!summary.complete?<>Some counts are unavailable. <button type="button" className="underline" disabled={!!retrying.size} onClick={()=>setSummaryRetry(n=>n+1)}>Retry counts</button></>:'Counts checked.'}</p>}
  <div className="coach-collection-tools">
   {agents.length>0&&<><input type="search" className="input" value={query} onChange={e=>{setQuery(e.target.value);setAll(false);}} placeholder="Search your agents" aria-label="Search agents you train"/><button type="button" aria-pressed={filter==='all'&&!needle} onClick={()=>{setQuery('');setFilter('all');}} className="coach-all-count">All · {partial?`${agents.length}+`:agents.length}</button></>}
   {summary&&<>{(['waiting','listed','not_listed'] as const).map(value=><button key={value} type="button" className="coach-all-count" aria-pressed={filter===value} onClick={()=>{setFilter(value);setAll(false);}}>{value==='waiting'?'Needs a decision':value==='listed'?'Listed':'Not listed'} · {coachingCount(summary.agents.filter(a=>value==='waiting'?a.decisions.length>0:value==='listed'?a.listing==='listed':a.listing!=='listed'&&a.listing!=='unknown').length,summary.complete&&summary.agents.every(a=>value==='waiting'?a.decisionsComplete:a.listing!=='unknown'))}</button>)}</>}
   <Link href="/training?view=review" className="coach-history-entry" prefetch={false}>Feedback from runs →</Link>
  </div>
  {waiting.length>0&&<section id="coach-waiting" className="coach-collection mb-8" aria-label="Waiting for you"><div className="agent-section-head"><h2>Waiting for you</h2><span>{waiting.length} {waiting.length===1?'agent':'agents'}</span></div>{columns}<AgentRows covers={covers} agents={showAllWaiting?waiting:waiting.slice(0,3)} summary={summary}/>{waiting.length>3&&<button type="button" className="coach-history-entry mt-3" onClick={()=>setShowAllWaiting(!showAllWaiting)}>{showAllWaiting?'Show fewer waiting agents':`Show all ${waiting.length} waiting agents`}</button>}</section>}
  {!agents.length&&!partial?<CollectionEmpty enso title="No agents to train yet" description="Build an agent, then teach it with examples, feedback, or a conversation."><Link href="/create?from=training" className="btn-primary">Build your first agent</Link></CollectionEmpty>:
   <section id="all-coach-agents" className="coach-collection" aria-label="All agents you train">
    <div className="agent-section-head"><h2>All agents you train</h2><span>{partial?(others.length?`${others.length}+`:'?'):others.length}</span></div>
    {others.length?<>{loadSummary&&columns}<AgentRows covers={covers} agents={all?others:others.slice(0,8)} summary={summary} loading={countsLoading} onRetry={loadSummary?retryFamily:undefined} retrying={retrying} retryable={retryable}/>{others.length>8&&<p className="agent-section-more">Showing {all?others.length:8} of {others.length} · <button type="button" onClick={()=>setAll(!all)}>{all?'Show less':`Show all ${others.length}`}</button></p>}</>:
     partial?unavailable:<CollectionEmpty title="No results" description={query.trim()?`No agents match “${query.trim()}”.`:filter==='listed'?'No listed agents in this view.':filter==='waiting'?'No known decisions are waiting.':'No agents in this view.'}><button type="button" className="btn-outline" onClick={()=>{setQuery('');setFilter('all');}}>Clear search</button></CollectionEmpty>}
   </section>}
  <Modal open={chooseRecording&&!!recordingId} onClose={closeRecording} title="Which agent should this recording teach?" subtitle="Your recording stays saved on this Mac." maxWidth="max-w-3xl">
   {agents.length>0&&<input type="search" className="input mb-4" value={targetQuery} onChange={e=>setTargetQuery(e.target.value)} aria-label="Find an agent for this recording" placeholder="Search your agents"/>}
   {targets.length?<div className="coach-recording-targets"><AgentRows covers={covers} agents={targets} recordingId={recordingId}/></div>:partial?unavailable:<CollectionEmpty title={agents.length?'No results':'No agents to train yet'} description={agents.length?`No agents match “${targetQuery.trim()}”.`:'Build an agent, then choose this recording from your saved recordings.'}>{agents.length?<button type="button" className="btn-outline" onClick={()=>setTargetQuery('')}>Clear search</button>:<Link href="/create?from=training" className="btn-primary">Build your first agent</Link>}</CollectionEmpty>}
  </Modal>
 </>;
}

export function TrainingFeedUnavailable({reason}:{reason:Extract<MyWorkflowsRead,{status:'unavailable'}>['reason']}){
 return <CollectionReadError title="Couldn’t load the agents you train" description={reason==='no_session'?'Your session couldn’t be checked. Reload to try again.':'Your agents and saved training are unchanged. This page couldn’t reach Tukido.'}/>;
}
