import Link from 'next/link';
import type {ReactNode} from 'react';
import type {AgentHomeTab} from '@/lib/agent-marketplace-samples';
export default function AgentHomeFrame({tab,children}:{tab?:AgentHomeTab;children:ReactNode}){
 return <main className="min-h-screen px-4 py-12"><div className={`${tab?'max-w-6xl':'max-w-4xl'} mx-auto`}>
  <header className="mb-7 flex items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight text-ink-50">Agents</h1><p className="mt-1 text-sm text-ink-300">Find an agent by the outcome you need, or manage the agents already working for you.</p></div><Link href="/create" className="btn-primary flex-none whitespace-nowrap px-4 py-2 text-sm">+ Create agent</Link></header>
  {tab&&<nav aria-label="Agent views" className="mb-9 flex gap-6 overflow-x-auto border-b border-ink-800">{[{id:'rent',label:'Rent Agent'},{id:'running',label:'Running Agents'},{id:'training',label:'Training Agent'}].map(item=><Link key={item.id} href={`/workflows?tab=${item.id}`} aria-current={tab===item.id?'page':undefined} className={`shrink-0 border-b-2 px-1 pb-4 pt-2 text-sm ${tab===item.id?'border-brand-500 text-ink-50':'border-transparent text-ink-500 hover:text-ink-200'}`}>{item.label}</Link>)}</nav>}
  {children}
 </div></main>;
}
