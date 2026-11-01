import type {MyWorkflowsRead} from './workflow-catalog';
/** Presentation only: failed ownership reads and customer installations keep their existing review route. */
export function trainingReviewSlug(packet:{live:boolean;run:{slug:string|null;holdKind?:string|null}|null},owned:MyWorkflowsRead):string|null{
 const slug=packet.live?packet.run?.slug:null;
 return slug&&packet.run?.holdKind!=='approval_before_action'&&owned.status==='ready'&&owned.workflows.some(agent=>agent.slug===slug&&agent.source==='generated')?slug:null;
}
export function trainingReviewHref(slug:string,runId:string,artifact?:string):string{
 return `/training/${encodeURIComponent(slug)}/review/${encodeURIComponent(runId)}${artifact?`?artifact=${encodeURIComponent(artifact)}`:''}`;
}
