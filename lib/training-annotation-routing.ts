/** Navigation carries opaque identities only; existing owner/digest readers authorize them. */
export type TrainingAnnotationTarget=
 |{kind:'result';runId?:string;issueId?:string;artifactId?:string}
 |{kind:'recording';recordingId:string;momentId?:string;sessionId?:string;sourceId?:string;analyze?:boolean}
 |{kind:'feedback';annotationId:string;annotationDigest:string;sessionId:string}
 |{kind:'image';sourceId:string;sessionId:string;feedback?:string;details?:boolean};
export function trainingAnnotationHref(slug:string,target:TrainingAnnotationTarget):string{
 const agent=encodeURIComponent(slug),q=new URLSearchParams();
 if(target.kind==='result'){
  if(target.artifactId)q.set('artifact',target.artifactId);
  if(target.issueId)q.set('issueId',target.issueId);
  const path=target.runId?`/training/${agent}/review/${encodeURIComponent(target.runId)}`:`/training/${agent}/review/issues/${encodeURIComponent(target.issueId||'')}`;
  return path+(q.size?`?${q}`:'');
 }
 if(target.kind==='feedback'){q.set('sessionId',target.sessionId);q.set('digest',target.annotationDigest);return `/training/${agent}/annotate/feedback/${encodeURIComponent(target.annotationId)}?${q}`;}
 if(target.kind==='recording'){
  if(target.momentId)q.set('momentId',target.momentId);if(target.sessionId)q.set('sessionId',target.sessionId);if(target.sourceId)q.set('sourceId',target.sourceId);if(target.analyze)q.set('analyze','1');
  return `/training/${agent}/annotate/recordings/${encodeURIComponent(target.recordingId)}${q.size?`?${q}`:''}`;
 }
 q.set('sessionId',target.sessionId);if(target.details)q.set('details','1');if(target.feedback)q.set('feedback',target.feedback);
 return `/training/${agent}/annotate/${encodeURIComponent(target.sourceId)}?${q}`;
}
export const trainingAnnotationReturn=(slug:string)=>`/training/${encodeURIComponent(slug)}`;
