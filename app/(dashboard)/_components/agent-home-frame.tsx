import Link from 'next/link';
import type {ReactNode} from 'react';
export default function AgentHomeFrame({children,manage=false}:{children:ReactNode;manage?:boolean}){
 return <main className="min-h-screen px-4 py-12"><div className="max-w-4xl mx-auto">
  <header className="mb-7 flex items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight text-ink-50">Agents</h1><p className="mt-1 text-sm text-ink-300">{manage?'Manage your installed agents.':'Find an agent by the outcome you need, or manage the agents already working for you.'}</p></div><Link href="/create" className="btn-primary flex-none whitespace-nowrap px-4 py-2 text-sm">+ Create agent</Link></header>
  {children}
 </div></main>;
}

/** Owner's sketch: one quiet build disclosure, then the full-width rental gallery. */
export function RentBuildHome({build,status,children}:{build:ReactNode;status?:ReactNode;children:ReactNode}) {
 return <div className="min-h-screen px-5 py-12 lg:px-8"><div className="mx-auto max-w-6xl">
  <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Rent/Build</h1>
  <details className="group mb-9 mt-8 border-y border-ink-800 py-5">
   <summary className="flex cursor-pointer list-none items-center gap-3 rounded text-lg font-medium text-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="text-2xl font-light text-brand-500 transition-transform group-open:rotate-45">+</span>Build an agent</summary>
   <div className="mt-5 max-w-2xl">{build}</div>
  </details>
  {status}
  {children}
 </div></div>;
}
