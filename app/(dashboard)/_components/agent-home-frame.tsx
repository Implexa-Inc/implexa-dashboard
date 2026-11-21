'use client';

import Link from 'next/link';
import type {ReactNode} from 'react';
export default function AgentHomeFrame({children,manage=false}:{children:ReactNode;manage?:boolean}){
 return <main className="app-page"><div className="app-content">
  <header className="app-page-head"><div><h1>Agents</h1><p className="app-page-description">Run the agents you have, find one trained by an expert, or build your own.</p></div><Link href="/create" className="btn-primary flex-none whitespace-nowrap">+ Build an agent</Link></header>
  {manage && <AgentTabs selected="mine" />}
  {children}
 </div></main>;
}

/** Owner's sketch: one quiet build disclosure, then the full-width rental gallery. */
export function RentBuildHome({build,status,children}:{build:ReactNode;status?:ReactNode;children:ReactNode}) {
 return <div className="app-page"><div className="app-content">
  <header className="app-page-head"><div><h1>Agents</h1><p className="app-page-description">Find an agent by the outcome you need, or build your own.</p></div></header>
  <AgentTabs selected="find" />
  <details className="group mb-9 mt-8 border-y border-ink-800 py-5" onToggle={event=>{if(event.target===event.currentTarget&&event.currentTarget.open)event.currentTarget.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')?.focus({preventScroll:true});}}>
   <summary className="flex cursor-pointer list-none items-center gap-3 rounded text-lg font-medium text-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="text-2xl font-light text-brand-500 transition-transform group-open:rotate-45">+</span>Build an agent</summary>
   <div className="mt-5 max-w-5xl">{build}</div>
  </details>
  {status}
  {children}
 </div></div>;
}

function AgentTabs({selected}:{selected:'mine'|'find'}) {
 return <nav className="app-tabs" aria-label="Agents views">
  <Link href="/workflows?tab=manage" prefetch={false} aria-current={selected==='mine'?'page':undefined}>Your agents</Link>
  <Link href="/workflows?tab=rent" prefetch={false} aria-current={selected==='find'?'page':undefined}>Find a trained agent</Link>
 </nav>;
}
