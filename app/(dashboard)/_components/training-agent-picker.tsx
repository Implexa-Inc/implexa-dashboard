'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {MyWorkflowsRead,MyWorkflowCard} from '@/lib/workflow-catalog';
import {humanize,oneLine} from '@/lib/inbox-items';
import {CollectionEmpty,CollectionReadError} from './collection-state';
import Modal from './modal';

function AgentRows({agents,recordingId}:{agents:MyWorkflowCard[];recordingId?:string}){
 return <ul className="coach-agent-list">{agents.map(agent=>{
  const href=`/training/${encodeURIComponent(agent.slug)}${recordingId?`?annotateRecording=${encodeURIComponent(recordingId)}`:''}`;
  return <li key={agent.slug} className="coach-agent-row">
   <div className="coach-agent-picture" aria-hidden="true"><svg><use href="/brand/tukido-icons.svg#coach"/></svg></div>
   <div><h3><Link href={href} prefetch={false}>{agent.name.trim()||humanize(agent.slug)}</Link></h3>{oneLine(agent.description)&&<p>{oneLine(agent.description)}</p>}</div>
   <Link href={href} prefetch={false} className="btn-outline">{recordingId?'Choose agent':'Train'}</Link>
  </li>;
 })}</ul>;
}
const filterAgents=(agents:MyWorkflowCard[],query:string)=>{
 const needle=query.trim().toLowerCase();
 return agents.filter(agent=>!needle||`${agent.name} ${agent.description||''}`.toLowerCase().includes(needle));
};

/** One trainer-owned roster; the recording arrival is a rare target-choice dialog. */
export default function TrainingAgentPicker({owned,recordingId,partial=false}:{owned:MyWorkflowCard[];recordingId?:string;partial?:boolean}){
 const router=useRouter();
 const [query,setQuery]=useState(''),[all,setAll]=useState(false);
 const [chooseRecording,setChooseRecording]=useState(!!recordingId),[targetQuery,setTargetQuery]=useState('');
 useEffect(()=>{setChooseRecording(!!recordingId);setTargetQuery('');},[recordingId]);
 const agents=useMemo(()=>{
  const bySlug=new Map<string,MyWorkflowCard>();
  for(const agent of owned)if(agent.source==='generated'&&!bySlug.has(agent.slug))bySlug.set(agent.slug,agent);
  // The existing roster projects last_seen_at as updated_at, not last taught.
  const stamp=(agent:MyWorkflowCard)=>{const at=Date.parse(agent.updated_at||'');return Number.isFinite(at)?at:0;};
  return [...bySlug.values()].sort((a,b)=>stamp(b)-stamp(a)||a.name.localeCompare(b.name)||a.slug.localeCompare(b.slug));
 },[owned]);
 const needle=query.trim().toLowerCase(),shown=filterAgents(agents,query),targets=filterAgents(agents,targetQuery);
 const closeRecording=()=>{
  setChooseRecording(false);
  const url=new URL(window.location.href);url.searchParams.delete('recordingId');
  router.replace(url.pathname+url.search+url.hash,{scroll:false});
 };
 const unavailable=<CollectionReadError title="Some agents couldn’t be checked" description="Your agents and saved training are unchanged. Try refreshing the list."/>;
 return <>
  <div className="coach-collection-tools">
   {agents.length>0&&<><input type="search" className="input" value={query} onChange={e=>{setQuery(e.target.value);setAll(false);}} placeholder="Search your agents" aria-label="Search agents you train"/><button type="button" aria-pressed={!needle} onClick={()=>setQuery('')} className="coach-all-count">All · {partial?`${agents.length}+`:agents.length}</button></>}
   <Link href="/training?view=review" className="coach-history-entry" prefetch={false}>Feedback from runs →</Link>
  </div>
  {!agents.length&&!partial?<CollectionEmpty enso title="No agents to train yet" description="Build an agent, then teach it with examples, feedback, or a conversation."><Link href="/create?from=training" className="btn-primary">Build your first agent</Link></CollectionEmpty>:
   <section className="coach-collection" aria-label="All agents you train">
    <div className="agent-section-head"><h2>All agents you train</h2><span>{partial?(shown.length?`${shown.length}+`:'?'):shown.length}</span></div>
    {shown.length?<><AgentRows agents={all?shown:shown.slice(0,8)}/>{shown.length>8&&<p className="agent-section-more">Showing {all?shown.length:8} of {shown.length} · <button type="button" onClick={()=>setAll(!all)}>{all?'Show less':`Show all ${shown.length}`}</button></p>}</>:
     partial?unavailable:<CollectionEmpty title="No results" description={`No agents match “${query.trim()}”.`}><button type="button" className="btn-outline" onClick={()=>setQuery('')}>Clear search</button></CollectionEmpty>}
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
