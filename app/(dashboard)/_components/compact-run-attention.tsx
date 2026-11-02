import Link from 'next/link';
import type {Attention} from '@/lib/attention';
import type {OutcomeProductionListLoad} from '@/lib/outcome-production-load';
import {coalesceUnstartedDrafts} from '../work/_components/outcome-productions-list';

export function CompactRunAlerts({attention}:{attention:Attention}) {
 const warning=attention.partial || attention.truncated || !attention.live;
 const count=new Set(attention.items.map(item=>item.runId ?? item.attentionId)).size;
 return <div className="mb-3 space-y-2 text-sm">
  {count>0 && <Link href="/work?view=needs" prefetch={false} className="inline-block text-amber-300 hover:underline">{warning?'At least ':''}{count} {count===1?'run needs':'runs need'} you →</Link>}
  {warning && <p role="status" className="text-xs text-amber-300">Some run alerts couldn’t be checked. <Link href="/work?view=needs" prefetch={false} className="underline">Needs you</Link></p>}
 </div>;
}
export function CompactActiveProductions({load}:{load:OutcomeProductionListLoad}) {
 if(load.status==='absent')return null;
 if(load.status==='unavailable')return <p role="status" className="mb-5 text-xs text-amber-300">Other active work couldn’t be checked. <Link href="/work?view=needs" prefetch={false} className="underline">View work</Link></p>;
 const parents=coalesceUnstartedDrafts(load.productions).filter(item=>!item.settled);
 return <div className="mb-5 text-sm">
  {load.truncated&&<p role="status" className="mb-3 text-xs text-amber-300">Showing the first active work items; more may need you.</p>}
  {parents.length>0&&<details className="border-b border-ink-800 pb-3"><summary className="cursor-pointer text-ink-300">Other active work · {load.truncated?'at least ':''}{parents.length}</summary><ul className="mt-2 divide-y divide-ink-800">{parents.map(item=><li key={item.id}><Link href={`/runs/productions/${item.id}`} prefetch={false} className="flex items-center justify-between gap-4 py-3"><span className="truncate text-ink-100">{item.goal}</span><span className="shrink-0 text-xs text-ink-400"><span className="capitalize">{item.state.replace(/_/g,' ')}</span> · {item.progress.completedNodes}/{item.progress.totalNodes}</span></Link></li>)}</ul></details>}
 </div>;
}
