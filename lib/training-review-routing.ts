import type {ReviewQueueItem,ReviewQueue} from './review';
import type {MyWorkflowsRead} from './workflow-catalog';
/** Presentation only: failed ownership reads and customer installations keep their existing review route. */
export function trainingReviewSlug(packet:{live:boolean;run:{slug:string|null;holdKind?:string|null}|null},owned:MyWorkflowsRead):string|null{
 const slug=packet.live?packet.run?.slug:null;
 return slug&&packet.run?.holdKind!=='approval_before_action'&&owned.status==='ready'&&owned.workflows.some(agent=>agent.slug===slug&&agent.source==='generated')?slug:null;
}
export function trainingReviewHref(slug:string,runId:string,artifact?:string):string{
 return `/training/${encodeURIComponent(slug)}/review/${encodeURIComponent(runId)}${artifact?`?artifact=${encodeURIComponent(artifact)}`:''}`;
}

/** One partition for Training's list and Work's list/badge. Unknown ownership stays in Work. */
export function isTrainerFeedback(item:Pick<ReviewQueueItem,'slug'|'reason'|'holdKind'>,owned:MyWorkflowsRead):boolean{
 return item.reason!=='approval'&&item.holdKind!=='approval_before_action'&&!!trainingReviewSlug({live:true,run:item},owned);
}
export function reviewQueueForArea(queue:ReviewQueue,owned:MyWorkflowsRead,area:'training'|'work'):ReviewQueue{
 if(area==='work'&&owned.status!=='ready')return queue;
 const items=queue.items.filter(item=>isTrainerFeedback(item,owned)===(area==='training'));
 return {...queue,items,visibleCount:items.length,total:null,...(area==='training'&&owned.status!=='ready'?{sources:{...queue.sources,training_owner_roster:'unavailable'}}:{})};
}
