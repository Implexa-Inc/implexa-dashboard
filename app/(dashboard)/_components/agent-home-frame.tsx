import Link from 'next/link';
import type {ReactNode} from 'react';
export default function AgentHomeFrame({children,manage=false}:{children:ReactNode;manage?:boolean}){
 return <main className="min-h-screen px-4 py-12"><div className="max-w-4xl mx-auto">
  <header className="mb-7 flex items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight text-ink-50">Agents</h1><p className="mt-1 text-sm text-ink-300">{manage?'Manage your installed agents.':'Find an agent by the outcome you need, or manage the agents already working for you.'}</p></div><Link href="/create" className="btn-primary flex-none whitespace-nowrap px-4 py-2 text-sm">+ Create agent</Link></header>
  {children}
 </div></main>;
}
