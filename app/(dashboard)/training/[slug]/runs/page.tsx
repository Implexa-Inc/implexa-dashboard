import Link from 'next/link';
import {redirect,notFound} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {readMyWorkflows} from '@/lib/workflow-catalog';
import {getAgentDetail} from '@/lib/agent-detail';
import {trainingReviewHref} from '@/lib/training-review-routing';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:{slug:string}}){
 const {data:{session}}=await createClient().auth.getSession();if(!session?.user)redirect('/login');
 const owned=await readMyWorkflows(session.access_token);
 if(owned.status!=='ready')return <main className="p-10"><h1>Results couldn’t load</h1><Link href="/training">Return to Training</Link></main>;
 const agent=owned.workflows.find(a=>a.slug===params.slug&&a.source==='generated');if(!agent)notFound();
 const detail=await getAgentDetail(params.slug,session.access_token,{source:'generated'});
 const available=detail.status==='ready'&&!detail.detail.isUnavailable('runs');
 const runs=detail.status==='ready'&&available?detail.detail.runs.filter(run=>run.slug===params.slug).sort((a,b)=>b.ran_at.localeCompare(a.ran_at)):[];
 return <main className="mx-auto max-w-4xl space-y-6 px-6 py-10"><Link href={`/training/${encodeURIComponent(params.slug)}`} className="text-sm text-ink-400">← Training</Link><h1 className="text-2xl">{agent.name}</h1><h2>Give feedback on a run</h2>{!available?<p>Results couldn’t load. This does not mean there are none.</p>:runs.length?<ul className="divide-y divide-ink-800">{runs.map(run=><li key={run.id}><Link className="flex justify-between gap-4 py-5" href={trainingReviewHref(params.slug,run.id)}><span>{new Date(run.ran_at).toLocaleDateString('en-US')}</span><span>{run.state.label} · Give feedback →</span></Link></li>)}</ul>:<p>No results yet.</p>}</main>;
}
