'use client';
import Link from 'next/link';
import {createContext,useContext,useState,type ReactNode} from 'react';
const CountContext=createContext<((value:{count:number;complete:boolean})=>void)|null>(null);
export const useAgentCollectionCount=()=>useContext(CountContext);
import PageHeader from '@/components/page-header';

export default function AgentHomeFrame({children,selected='mine',count}:{children:ReactNode;selected?:'mine'|'find';count?:ReactNode}){
 const [liveCount,setLiveCount]=useState<{count:number;complete:boolean}|null>(null);
 return <CountContext.Provider value={setLiveCount}><main className="app-page"><div className="app-content">
  <PageHeader title="Agents" actions={<Link href="/create" className="btn-primary"><svg width="16" height="16" aria-hidden="true"><use href="/brand/tukido-icons.svg#plus"/></svg>Build an agent</Link>}><p className="app-page-description">Run the agents you have, find one trained by an expert, or build your own.</p></PageHeader>
  <nav className="app-tabs" aria-label="Agents views">
   <Link href="/workflows?tab=manage" prefetch={false} aria-current={selected==='mine'?'page':undefined}>Your agents {liveCount?<span className="work-filter-count" aria-label={liveCount.complete?`${liveCount.count} agents`:'Agent count incomplete'}>{liveCount.complete?liveCount.count:liveCount.count?`${liveCount.count}+`:'?'}</span>:count}</Link>
   <Link href="/workflows?tab=rent" prefetch={false} aria-current={selected==='find'?'page':undefined}>Find a trained agent</Link>
  </nav>
  {children}
 </div></main></CountContext.Provider>;
}
