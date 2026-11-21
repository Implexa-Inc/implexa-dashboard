'use client';
import {useMemo,useState} from 'react';
import Link from 'next/link';
import type {MyWorkflowsRead,MyWorkflowCard} from '@/lib/workflow-catalog';
import {humanize,oneLine} from '@/lib/inbox-items';
import {CollectionEmpty,CollectionReadError} from './collection-state';

/** The trainer's collection, not the customer's installed-agent roster. */
export default function TrainingAgentPicker({owned,recordingId,partial=false}:{owned:MyWorkflowCard[];recordingId?:string;partial?:boolean}){
 const [query,setQuery]=useState(''),[all,setAll]=useState(false);
 const agents=useMemo(()=>{
  const bySlug=new Map<string,MyWorkflowCard>();
  for(const agent of owned)if(agent.source==='generated'&&!bySlug.has(agent.slug))bySlug.set(agent.slug,agent);
  // The existing roster projects aggregated_skills.last_seen_at as updated_at.
  // This is updated order, never a claim about when a lesson became live.
  const stamp=(agent:MyWorkflowCard)=>{const at=Date.parse(agent.updated_at||'');return Number.isFinite(at)?at:0;};
  return [...bySlug.values()].sort((a,b)=>stamp(b)-stamp(a)||a.name.localeCompare(b.name)||a.slug.localeCompare(b.slug));
 },[owned]);
 const needle=query.trim().toLowerCase();
 const shown=agents.filter(agent=>!needle||`${agent.name} ${agent.description||''}`.toLowerCase().includes(needle));
 if(!agents.length&&!partial)return <><div className="coach-collection-tools"><Link href="/training?view=review" className="coach-history-entry" prefetch={false}>Feedback from runs →</Link></div><CollectionEmpty enso title="No agents to train yet" description="Build an agent, then teach it with examples, feedback, or a conversation."><Link href="/create?from=training" className="btn-primary">Build your first agent</Link></CollectionEmpty></>;
 return <>
  {recordingId&&<p className="coach-recording-notice">Choose the agent this recording should teach.</p>}
  <div className="coach-collection-tools">{agents.length>0&&<><input type="search" className="input" value={query} onChange={e=>{setQuery(e.target.value);setAll(false);}} placeholder="Search your agents" aria-label="Search agents you train"/><button type="button" aria-pressed={!needle} onClick={()=>setQuery('')} className="coach-all-count">All · {partial?(agents.length?`${agents.length}+`:'?'):agents.length}</button></>}<Link href="/training?view=review" className="coach-history-entry" prefetch={false}>Feedback from runs →</Link></div>
  <section className="coach-collection" aria-label="All agents you train"><div className="agent-section-head"><h2>All agents you train</h2><span>{partial?(shown.length?`${shown.length}+`:'?'):shown.length}</span></div>
   {shown.length?<><ul className="coach-agent-list">{(all?shown:shown.slice(0,8)).map(agent=>{
    const href=`/training/${encodeURIComponent(agent.slug)}${recordingId?`?annotateRecording=${encodeURIComponent(recordingId)}`:''}`;
    return <li key={agent.slug} className="coach-agent-row"><div className="coach-agent-picture" aria-hidden="true"><svg><use href="/brand/tukido-icons.svg#coach"/></svg></div><div><h3><Link href={href}>{agent.name.trim()||humanize(agent.slug)}</Link></h3>{oneLine(agent.description)&&<p>{oneLine(agent.description)}</p>}</div><Link href={href} className="btn-outline">{recordingId?'Choose agent':'Train'}</Link></li>;
   })}</ul>{shown.length>8&&<p className="agent-section-more">Showing {all?shown.length:8} of {shown.length} · <button type="button" onClick={()=>setAll(!all)}>{all?'Show less':`Show all ${shown.length}`}</button></p>}</>:
    <>{partial?<CollectionReadError title="Some agents couldn’t be checked" description="Your agents and saved training are unchanged. Try refreshing the list."/>:<CollectionEmpty title="No results" description={`No agents match “${query.trim()}”.`}><button type="button" className="btn-outline" onClick={()=>setQuery('')}>Clear search</button></CollectionEmpty>}</>}
  </section>
 </>;
}

export function TrainingFeedUnavailable({reason}:{reason:Extract<MyWorkflowsRead,{status:'unavailable'}>['reason']}){
 return <CollectionReadError title="Couldn’t load the agents you train" description={reason==='no_session'?'Your session couldn’t be checked. Reload to try again.':'Your agents and saved training are unchanged. This page couldn’t reach Tukido.'}/>;
}
