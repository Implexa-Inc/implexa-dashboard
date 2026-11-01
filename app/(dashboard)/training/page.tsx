import Link from 'next/link';
import RetryButton from '../_components/retry-button';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readMyWorkflows, type MyWorkflowsRead } from '@/lib/workflow-catalog';
import {reviewQueueForArea} from '@/lib/training-review-routing';
import {getReviewQueue} from '@/lib/review';
import ReadyForReviewList from '../work/_components/ready-for-review-list';
import TrainingAgentPicker,{TrainingFeedUnavailable as FeedUnavailable} from '../_components/training-agent-picker';

export const dynamic = 'force-dynamic';

export default async function TrainingPage({searchParams}:{searchParams?:{view?:string;recordingId?:string}}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const feed = await readMyWorkflows(session.access_token);
  const recordingId=searchParams?.recordingId&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(searchParams.recordingId)?searchParams.recordingId:undefined;
  const queue=searchParams?.view==='review'&&feed.status==='ready'?await getReviewQueue():null;
  const owned=feed.status==='ready'?feed.workflows.filter(a=>a.source==='generated'):[];
  const feedback=queue?reviewQueueForArea(queue,feed,'training'):null;

  return (
    <div className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[.18em] text-ink-500">Your trainer workspace</p><h1 className="text-3xl font-medium tracking-tight text-ink-50">What would you like to train?</h1>
          <p className="text-ink-300 text-sm mt-1">
            Teach through a result, a conversation, or a demonstration.
          </p>
        </header>

        {feed.status !== 'ready' ? <FeedUnavailable reason={feed.reason} /> : <>
          {!!feed.unavailableEntries && <p role="status" className="mb-4 text-sm text-ink-400">Some agent entries could not be read. The available agents are shown below.<RetryButton /></p>}
          {feedback?<><Link href="/training" className="mb-5 inline-block text-sm text-ink-400">← Your agents</Link><h2 className="mb-5 text-xl">Feedback from runs</h2><ReadyForReviewList queue={feedback} nameBySlug={new Map(owned.map(a=>[a.slug,a.name]))} training/></>:<><Link href="/training?view=review" className="mb-6 inline-block text-sm text-ink-400">Feedback from runs →</Link><TrainingAgentPicker owned={feed.workflows} recordingId={recordingId} /></>}
        </>}
      </div>
    </div>
  );
}

