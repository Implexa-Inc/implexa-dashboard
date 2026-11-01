'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {deriveRunState,presentationFor,type RunRow} from '@/lib/run-state';
import {humanize} from '@/lib/inbox-items';

/** Recent run rows, never installed agents. Live progress uses RunningAgents above. */
export default function RunActivity({runs,unavailable=false}:{runs:RunRow[];unavailable?:boolean}){
 const [localTime,setLocalTime]=useState(false);
 useEffect(()=>setLocalTime(true),[]);
 return <section aria-label="Recent run history" className="mt-8">
  <h2 className="mb-3 text-sm font-medium text-ink-200">Recent runs</h2>
  {unavailable ? <p role="status" className="text-sm text-amber-300">Run history is temporarily unavailable. Refresh to try again.</p>
   : !runs.length ? <p className="text-sm text-ink-400">No recent runs.</p>
   : <ul className="space-y-3">{runs.map(run=>{
    const info=deriveRunState(run),style=presentationFor(info);
    const needsInput=run.review_status==='needs_input';
    return <li key={run.id}><Link href={`/runs/${encodeURIComponent(run.id)}`} className="block rounded-xl border border-ink-800 p-4 transition-colors hover:border-ink-600 focus-visible:outline focus-visible:outline-brand-500">
     <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium text-ink-100">{humanize(run.skill_slug)}</span><span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs ${needsInput?'bg-amber-500/15 text-amber-300':style.classes}`}><span aria-hidden="true" className={`h-2 w-2 rounded-full ${needsInput?'bg-amber-500':style.dot} ${style.pulse?'animate-pulse':''}`}/>{info.label}</span></div>
     {run.current_step_index!=null&&run.total_steps ? <p className="mt-2 text-xs text-ink-300">Step {Math.min(Math.max(run.current_step_index||1,1),run.total_steps)}/{run.total_steps}{run.current_step_label?` · ${run.current_step_label}`:''}</p>:null}
     <p className="mt-2 text-xs text-ink-500"><time dateTime={run.ran_at}>{new Date(run.ran_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:localTime?undefined:'UTC',timeZoneName:'short'})}</time><span className="ml-3">View steps and result →</span></p>
    </Link></li>;
   })}</ul>}
 </section>;
}
