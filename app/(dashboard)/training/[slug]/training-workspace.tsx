'use client';

import Link from 'next/link';
import type {ReactNode} from 'react';

export type TrainingView='start'|'teach'|'history'|'settings';

function Symbol({kind}:{kind:'result'|'show'|'chat'}){
 return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
  {kind==='result'?<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/></>:kind==='show'?<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M9 21h6m-3-4v4m-2-13h4v5h-4Z"/></>:<path d="M4 4h16v12H9l-5 4V4Z"/>}
 </svg>;
}

/** Presentation only: the existing Training, recorder and Review Room own actions. */
export function TrainingEntry({slug,lastRunId,onShow,onChat}:{slug:string;lastRunId?:string|null;onShow:()=>void;onChat:()=>void}){
 const card='flex w-full items-center gap-4 rounded-xl border border-ink-800 bg-ink-900/30 p-5 text-left transition hover:border-ink-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500';
 const mark='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-950/40 text-emerald-200/80';
 return <section className="py-5" aria-labelledby="training-start-heading">
  <p className="text-[10px] font-medium uppercase tracking-[.18em] text-ink-500">A result, a conversation, a demonstration</p>
  <h2 id="training-start-heading" className="mt-3 text-2xl font-medium tracking-tight">How would you like to teach it?</h2>
  <p className="mt-3 max-w-lg text-sm leading-6 text-ink-400">Show a choice, explain a preference, or review work it has already done. Your original feedback and evidence stay available.</p>
  <div className="mt-7 space-y-3">
   <Link className={card} href={lastRunId?`/review/${encodeURIComponent(lastRunId)}`:`/workflows/${encodeURIComponent(slug)}?source=generated&tab=runs`}>
    <span className={mark}><Symbol kind="result"/></span><span className="flex-1"><strong className="block text-sm font-medium">Improve a result</strong><span className="mt-1 block text-xs leading-5 text-ink-400">{lastRunId?'Open the latest run in Review Room and annotate its output.':'Choose a run and annotate what you would change.'}</span></span><span aria-hidden="true" className="text-ink-500">→</span>
   </Link>
   <button type="button" className={card} onClick={onShow}><span className={mark}><Symbol kind="show"/></span><span className="flex-1"><strong className="block text-sm font-medium">Show how you do it</strong><span className="mt-1 block text-xs leading-5 text-ink-400">Record your screen, upload a demonstration, or choose a saved example.</span></span><span aria-hidden="true" className="text-ink-500">→</span></button>
   <button type="button" className={card} onClick={onChat}><span className={mark}><Symbol kind="chat"/></span><span className="flex-1"><strong className="block text-sm font-medium">Explain a change</strong><span className="mt-1 block text-xs leading-5 text-ink-400">Discuss this agent and its training with Implexa.</span></span><span aria-hidden="true" className="text-ink-500">→</span></button>
  </div>
 </section>;
}

export function TrainingNavigation({view,onChange}:{view:TrainingView;onChange:(view:TrainingView)=>void}){
 return <nav className="flex gap-6 border-b border-ink-800 text-xs" aria-label="Training workspace">
  {([['start','Teach'],['history','Learnings & history'],['settings','Sharing & details']] as const).map(([id,label])=><button key={id} type="button" aria-current={view===id||(view==='teach'&&id==='start')?'page':undefined} onClick={()=>onChange(id)} className={`border-b-2 pb-3 transition ${view===id||(view==='teach'&&id==='start')?'border-brand-500 text-ink-50':'border-transparent text-ink-500 hover:text-ink-200'}`}>{label}</button>)}
 </nav>;
}

/** Native details keep the same controls and state; no second implementation. */
export function TrainingDetails({title,children,open=false}:{title:string;children:ReactNode;open?:boolean}){
 return <details open={open} className="rounded-xl border border-ink-800 bg-ink-900/20"><summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-200">{title}</summary><div className="space-y-5 border-t border-ink-800 p-4 text-sm leading-6 [&_button]:rounded-md [&_button]:border [&_button]:border-ink-700 [&_button]:px-3 [&_button]:py-1.5 [&_button]:text-xs [&_button:disabled]:opacity-40">{children}</div></details>;
}

export function revealTrainingElement(id:string){
 const el=document.getElementById(id);if(!el)return;
 let parent:HTMLElement|null=el;
 while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
 el.scrollIntoView({block:'center',behavior:'smooth'});
}
