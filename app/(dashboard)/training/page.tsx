import {Suspense} from 'react';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import PageHeader from '@/components/page-header';
import {createClient} from '@/lib/supabase/server';
import {readTrainingCoach} from '@/lib/training-coach-server';
import {readMyWorkflows} from '@/lib/workflow-catalog';
import {reviewQueueForArea} from '@/lib/training-review-routing';
import {getReviewQueue} from '@/lib/review';
import RetryButton from '../_components/retry-button';
import ReadyForReviewList from '../work/_components/ready-for-review-list';
import TrainingAgentPicker,{TrainingFeedUnavailable} from '../_components/training-agent-picker';

export const dynamic='force-dynamic';
export default async function TrainingPage({searchParams}:{searchParams?:{view?:string;recordingId?:string}}){
 const supabase=createClient();const {data:{session}}=await supabase.auth.getSession();
 if(!session?.user)redirect('/login');
 const recordingId=searchParams?.recordingId&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(searchParams.recordingId)?searchParams.recordingId:undefined;
 return <main className="app-page"><div className="app-content">
  <PageHeader title="Coach" actions={<Link href="/create?from=training" className="btn-primary"><svg width="16" height="16" aria-hidden="true"><use href="/brand/tukido-icons.svg#plus"/></svg>Train a new agent</Link>}><p className="app-page-description">Teach your agents, decide what they learn, and list them for others to rent.</p></PageHeader>
  <Suspense fallback={<p role="status" className="mt-6 text-sm text-ink-400">Loading the agents you train…</p>}><CoachContents key={session.user.id} accountId={session.user.id} jwt={session.access_token} review={searchParams?.view==='review'} recordingId={recordingId}/></Suspense>
 </div></main>;
}
async function CoachContents({jwt,review,recordingId,accountId}:{jwt:string;review:boolean;recordingId?:string;accountId:string}){
 if(!review){const summary=await readTrainingCoach(jwt);if(summary.status!=='ready')return <TrainingFeedUnavailable reason="http_error"/>;const owned=summary.page.agents.map(agent=>({slug:agent.slug,name:agent.name,source:'generated',description:agent.description||'',updated_at:agent.lastTaughtAt}));return <TrainingAgentPicker key={accountId} owned={owned} recordingId={recordingId} partial={!summary.page.complete} summary={summary.page}/>;}
 const feed=await readMyWorkflows(jwt);
 if(feed.status!=='ready')return <TrainingFeedUnavailable reason={feed.reason}/>;
 const owned=feed.workflows.filter(agent=>agent.source==='generated');
 const queue=review?reviewQueueForArea(await getReviewQueue(),feed,'training'):null;
 return <>
  {!!feed.unavailableEntries&&<p role="status" className="mb-5 text-sm text-ink-400">Some agent details couldn’t be loaded. Known agents are shown below. <RetryButton/></p>}
  {queue?<><Link href="/training" className="mb-5 inline-block text-sm text-ink-400">← All agents you train</Link><h2 className="mb-5 text-xl">Feedback from runs</h2><ReadyForReviewList queue={queue} nameBySlug={new Map(owned.map(agent=>[agent.slug,agent.name]))} training/></>:
   <TrainingAgentPicker key={accountId} owned={owned} recordingId={recordingId} partial={!!feed.unavailableEntries}/>}
 </>;
}
