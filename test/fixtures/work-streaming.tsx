import type {NeedsYou} from '../../lib/needs-you';
import WorkFeed,{WorkSource,type WorkReviewData} from '../../app/(dashboard)/work/_components/work-feed';
/** Simulates the order in which server Suspense boundaries arrive, without replacing any reader UI. */
export default function StreamingWorkFixture({needs,review}:{needs?:NeedsYou;review?:WorkReviewData}){
 return <WorkFeed view="activity">{needs&&<WorkSource data={{kind:'needs',value:needs}}/>}{review&&<WorkSource data={{kind:'review',value:review}}/>}</WorkFeed>;
}
