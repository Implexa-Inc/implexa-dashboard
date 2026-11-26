/** Work's shared list. Existing readers and source-specific actions remain authoritative. */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { readUserProfile } from '@/lib/profile-read';
import { loadNeedsYou, type NeedsYou } from '@/lib/needs-you';
import { loadInboxItems } from '@/lib/inbox';
import { readMyWorkflows } from '@/lib/workflow-catalog';
import { getReviewQueue, reviewQueueWarning, versionSummary, unresolvedIssueLabel } from '@/lib/review';
import { resolveWorkView, AGENTS_MANAGE_HREF } from '@/lib/navigation';
import { settleWithin } from '@/lib/landing';
import { listOutcomeProductions } from '@/lib/outcome-production-load';
import PageHeader from '@/components/page-header';
import WorkFeed,{WorkSource} from './_components/work-feed';
import OutcomeProductionsList from './_components/outcome-productions-list';
import InboxList from '../inbox/inbox-list';

export const dynamic = 'force-dynamic';
export default async function WorkPage({searchParams}: {searchParams?:Record<string,string|string[]|undefined>}) {
  const supabase=createClient();
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.user) redirect('/login');
  const profile=await readUserProfile(supabase.from('users').select('id, organization_id').eq('id',session.user.id));
  if(!profile?.organization_id) redirect('/onboarding');
  const view=resolveWorkView(searchParams?.view);
  if(view==='agents') redirect(AGENTS_MANAGE_HREF);
  return <div className="app-page work-page"><div className="app-content">
    <PageHeader title="Work" actions={<Link href="/workflows" className="btn-primary"><svg className="h-4 w-4" aria-hidden="true"><use href="/brand/tukido-icons.svg#plus"/></svg>Start work</Link>}>
      <p className="app-page-description">What your agents are producing, and what needs you.</p>
    </PageHeader>
    <WorkFeed view={view}
      delivered={view==='delivered'?<Suspense fallback={<p role="status" className="work-list-notice">Loading delivered work…</p>}><DeliveredView/></Suspense>:null}
      productions={<Suspense fallback={<p role="status" className="work-list-notice">Checking other work…</p>}><OtherWork jwt={session.access_token}/></Suspense>}>
      <Suspense fallback={null}><NeedsSource/></Suspense>
      <Suspense fallback={null}><ReviewSource jwt={session.access_token}/></Suspense>
    </WorkFeed>
  </div></div>;
}

async function NeedsSource(){
  const read=await settleWithin<NeedsYou|null>(loadNeedsYou(createClient()),10_000,null);
  const value:NeedsYou=read??{needGrant:[],missed:[],signIns:[],stalled:[],attentionItems:[],homeAttention:[],pendingReviews:0,homeCount:0,total:0,partial:true,truncated:false,unavailableSources:['needs_you_timeout']};
  return <WorkSource data={{kind:'needs',value}}/>;
}
async function ReviewSource({jwt}:{jwt:string}){
  const [read,owned]=await Promise.all([
    getReviewQueue(),
    settleWithin(readMyWorkflows(jwt),10_000,{status:'unavailable' as const,reason:'timeout' as const}),
  ]);
  const queue=read??{items:[],truncated:false,total:null,visibleCount:0,sources:{review_endpoint:'unavailable'},live:false} as const;
  return <WorkSource data={{kind:'review',value:{queue,
    names:Object.fromEntries(owned.status==='ready'?owned.workflows.map(agent=>[agent.slug,agent.name]):[]),
    warning:reviewQueueWarning(queue),
    reviewDetails:Object.fromEntries(queue.items.map(item=>[item.rootRunId,`${versionSummary(item)} · ${unresolvedIssueLabel(item.unresolvedIssueCount)}`])),
  }}}/>;
}

async function DeliveredView() {
  try {
    const items=await loadInboxItems(createClient(),40,undefined,{onlyDelivered:true});
    if(items.length)return <InboxList initialItems={items} basePath="/work?view=delivered" heading={null} workRows/>;
    return <div className="work-empty"><h2>No results on this page yet</h2><p>Delivered work appears here after a run.</p><Link href="/workflows" className="btn-outline">Go to agents</Link></div>;
  } catch {
    return <p role="status" className="work-list-notice">Couldn’t load delivered work. <a href="/work?view=delivered" className="underline">Try again</a></p>;
  }
}
async function OtherWork({jwt}:{jwt:string}) {
  const load=await listOutcomeProductions(jwt);
  if(load.status==='absent'||load.status==='ready'&&load.productions.length===0) return null;
  return <details className="mt-6 rounded-lg border border-ink-800 p-4"><summary className="cursor-pointer text-ui text-ink-300">Other work & productions</summary><div className="mt-4"><OutcomeProductionsList load={load}/></div></details>;
}
