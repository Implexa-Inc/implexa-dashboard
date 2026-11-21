'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {MyWorkflowsRead,MyWorkflowCard} from '@/lib/workflow-catalog';
import {coachingCounts,coachingCount,type CoachPage} from '@/lib/training-coach';
import LocalTime from './local-time';
import {humanize,oneLine} from '@/lib/inbox-items';
import {CollectionEmpty,CollectionReadError} from './collection-state';
import Modal from './modal';

type OwnedCoachAgent=Pick<MyWorkflowCard,'slug'|'name'|'source'|'description'|'updated_at'>;
function AgentRows({agents,recordingId,summary}:{agents:OwnedCoachAgent[];recordingId?:string;summary?:CoachPage}){
 return <ul className="coach-agent-list">{agents.map(agent=>{
  const facts=summary?.agents.find(row=>row.slug===agent.slug);
  const href=`/training/${encodeURIComponent(agent.slug)}${recordingId?`?annotateRecording=${encodeURIComponent(recordingId)}`:''}`;
  return <li key={agent.slug} className="coach-agent-row">
   <div className="coach-agent-picture" aria-hidden="true"><svg><use href="/brand/tukido-icons.svg#coach"/></svg></div>
   <div><h3><Link href={href} prefetch={false}>{agent.name.trim()||humanize(agent.slug)}</Link></h3>{oneLine(agent.description)&&<p>{oneLine(agent.description)}</p>}</div>
   {!recordingId&&facts&&<>
    <div className="coach-row-decisions">{facts.decisions.length===0&&facts.decisionsComplete?<span className="text-ink-400">Nothing waiting</span>:<span className="coach-decision-pill"><b>{coachingCount(facts.decisions.length,facts.decisionsComplete)}</b> to decide</span>}</div>
    <div className="coach-row-learnings" title={facts.liveLessons===null?'Live training unavailable':`${facts.liveLessons} live lessons`}><span><b>{facts.liveLessons===null?'?':facts.liveLessons}</b>{facts.lastTaughtAt?<> · taught <LocalTime iso={facts.lastTaughtAt}/></>:facts.liveLessons===null?' · Unknown':facts.liveLessons===0?' · Not taught yet':''}</span></div>
    <div className="coach-row-marketplace"><span className={`coach-listing-pill ${facts.listing==='listed'?'listed':'idle'}`}>{({listed:'Listed',draft:'Draft listing',submitted:'In review',not_listed:'Not listed',unknown:'Unknown'})[facts.listing]}</span></div>
   </>}
   <Link href={href} prefetch={false} className="btn-outline">{recordingId?'Choose agent':facts?.decisions.length?`Review ${coachingCount(facts.decisions.length,facts.decisionsComplete)}`:'Train'}</Link>
  </li>;
 })}</ul>;
}
const filterAgents=(agents:OwnedCoachAgent[],query:string)=>{
 const needle=query.trim().toLowerCase();
 return agents.filter(agent=>!needle||`${agent.name} ${agent.description||''}`.toLowerCase().includes(needle));
};

/** One trainer-owned roster; the recording arrival is a rare target-choice dialog. */
export default function TrainingAgentPicker({owned,recordingId,partial=false,summary}:{owned:OwnedCoachAgent[];recordingId?:string;partial?:boolean;summary?:CoachPage}){
 const router=useRouter();
 const [query,setQuery]=useState(''),[all,setAll]=useState(false);
 const [showAllWaiting,setShowAllWaiting]=useState(false);
 const [filter,setFilter]=useState<'all'|'waiting'|'listed'|'not_listed'>('all');
 const [chooseRecording,setChooseRecording]=useState(!!recordingId),[targetQuery,setTargetQuery]=useState('');
 useEffect(()=>{setChooseRecording(!!recordingId);setTargetQuery('');},[recordingId]);
 const agents=useMemo(()=>{
  const bySlug=new Map<string,OwnedCoachAgent>();
  for(const agent of owned)if(agent.source==='generated'&&!bySlug.has(agent.slug))bySlug.set(agent.slug,agent);
  // The summary caller supplies last-made-live here. Older callers retain
  // their roster timestamp without presenting it as last taught.
  const stamp=(agent:OwnedCoachAgent)=>{const at=Date.parse(agent.updated_at||'');return Number.isFinite(at)?at:0;};
  return [...bySlug.values()].sort((a,b)=>stamp(b)-stamp(a)||a.name.localeCompare(b.name)||a.slug.localeCompare(b.slug));
 },[owned]);
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
 const others=summary?shown.filter(agent=>!waiting.some(item=>item.slug===agent.slug)):shown;
 const columns=<div className="coach-column-head" aria-hidden="true"><span/><span>Agent</span><span>Decisions</span><span>Learnings</span><span>Marketplace</span><span/></div>;
 return <>
  {counts&&<div className="coach-summary-tiles" aria-label="Coaching summary"><div className={counts.decisions?'card needs':'card'}><b>{coachingCount(counts.decisions,counts.decisionsComplete)}</b><span>Decisions waiting for you</span>{waiting[0]&&<a href="#coach-waiting">Review them →</a>}</div><div className="card"><b>{coachingCount(counts.agents,counts.agentsComplete)}</b><span>Agents you train</span></div><div className="card"><b>{coachingCount(counts.listed,counts.listedComplete)}</b><span>Agents listed</span></div></div>}
  {counts&&(!counts.decisionsComplete||!counts.agentsComplete||!counts.listedComplete)&&<p className="text-xs text-ink-400 mb-6">+ means the count may be higher.</p>}
  <div className="coach-collection-tools">
   {agents.length>0&&<><input type="search" className="input" value={query} onChange={e=>{setQuery(e.target.value);setAll(false);}} placeholder="Search your agents" aria-label="Search agents you train"/><button type="button" aria-pressed={filter==='all'&&!needle} onClick={()=>{setQuery('');setFilter('all');}} className="coach-all-count">All · {partial?`${agents.length}+`:agents.length}</button></>}
   {summary&&<>{(['waiting','listed','not_listed'] as const).map(value=><button key={value} type="button" className="coach-all-count" aria-pressed={filter===value} onClick={()=>{setFilter(value);setAll(false);}}>{value==='waiting'?'Needs a decision':value==='listed'?'Listed':'Not listed'} · {coachingCount(summary.agents.filter(a=>value==='waiting'?a.decisions.length>0:value==='listed'?a.listing==='listed':a.listing!=='listed'&&a.listing!=='unknown').length,summary.complete&&summary.agents.every(a=>value==='waiting'?a.decisionsComplete:a.listing!=='unknown'))}</button>)}</>}
   <Link href="/training?view=review" className="coach-history-entry" prefetch={false}>Feedback from runs →</Link>
  </div>
  {waiting.length>0&&<section id="coach-waiting" className="coach-collection mb-8" aria-label="Waiting for you"><div className="agent-section-head"><h2>Waiting for you</h2><span>{waiting.length} agents</span></div>{columns}<AgentRows agents={showAllWaiting?waiting:waiting.slice(0,3)} summary={summary}/>{waiting.length>3&&<button type="button" className="coach-history-entry mt-3" onClick={()=>setShowAllWaiting(!showAllWaiting)}>{showAllWaiting?'Show fewer waiting agents':`Show all ${waiting.length} waiting agents`}</button>}</section>}
  {!agents.length&&!partial?<CollectionEmpty enso title="No agents to train yet" description="Build an agent, then teach it with examples, feedback, or a conversation."><Link href="/create?from=training" className="btn-primary">Build your first agent</Link></CollectionEmpty>:
   (others.length>0||waiting.length===0)&&<section id="all-coach-agents" className="coach-collection" aria-label="All agents you train">
    <div className="agent-section-head"><h2>All agents you train</h2><span>{partial?(others.length?`${others.length}+`:'?'):others.length}{waiting.length?' more':''}</span></div>
    {others.length?<>{summary&&!waiting.length&&columns}<AgentRows agents={all?others:others.slice(0,8)} summary={summary}/>{others.length>8&&<p className="agent-section-more">Showing {all?others.length:8} of {others.length} · <button type="button" onClick={()=>setAll(!all)}>{all?'Show less':`Show all ${others.length}`}</button></p>}</>:
     partial?unavailable:<CollectionEmpty title="No results" description={query.trim()?`No agents match “${query.trim()}”.`:filter==='listed'?'No listed agents in this view.':filter==='waiting'?'No known decisions are waiting.':'No agents in this view.'}><button type="button" className="btn-outline" onClick={()=>{setQuery('');setFilter('all');}}>Clear search</button></CollectionEmpty>}
   </section>}
  <Modal open={chooseRecording&&!!recordingId} onClose={closeRecording} title="Which agent should this recording teach?" subtitle="Your recording stays saved on this Mac." maxWidth="max-w-3xl">
   {agents.length>0&&<input type="search" className="input mb-4" value={targetQuery} onChange={e=>setTargetQuery(e.target.value)} aria-label="Find an agent for this recording" placeholder="Search your agents"/>}
   {targets.length?<div className="coach-recording-targets"><AgentRows agents={targets} recordingId={recordingId}/></div>:partial?unavailable:<CollectionEmpty title={agents.length?'No results':'No agents to train yet'} description={agents.length?`No agents match “${targetQuery.trim()}”.`:'Build an agent, then choose this recording from your saved recordings.'}>{agents.length?<button type="button" className="btn-outline" onClick={()=>setTargetQuery('')}>Clear search</button>:<Link href="/create?from=training" className="btn-primary">Build your first agent</Link>}</CollectionEmpty>}
  </Modal>
 </>;
}

export function TrainingFeedUnavailable({reason}:{reason:Extract<MyWorkflowsRead,{status:'unavailable'}>['reason']}){
 return <CollectionReadError title="Couldn’t load the agents you train" description={reason==='no_session'?'Your session couldn’t be checked. Reload to try again.':'Your agents and saved training are unchanged. This page couldn’t reach Tukido.'}/>;
}
