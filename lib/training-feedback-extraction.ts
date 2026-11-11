import {demoAnnotationReceipt,scopedTeachingSuggestion,teachingDigest,teachingFrame,type DemoAnnotation,type ScopedTeachingSuggestion} from './training-teaching-draft.ts';
import {deriveTrainingStages,TRAINING_PROPERTY_CODES,TRAINING_RELATIONS,type TrainingPropertyCode} from './training-local-ingress.ts';

export type FeedbackExtractionProgress={key:string;annotation?:DemoAnnotation;suggestion?:ScopedTeachingSuggestion;record?:{recordId:string;recordDigest:string};linked?:boolean};
type Source={sourceId:string;token:string;metadata:{sha256:string;durationMs:number}};
type Reply={ok:boolean;[key:string]:any};
type Send=(operation:'annotation'|'suggestion',body:unknown,key?:string)=>Promise<Reply>;

/** Compose existing annotation, suggestion, native draft and link writers in order.
 * No acceptance occurs here. Progress survives a failed link so retry reuses its draft.
 */
export async function extractFeedbackTeaching({source,timeMs,rawAnnotation,versionId,retentionUntil,progress,call,send,check}:{
  source:Source;timeMs:number;rawAnnotation:string;versionId:string;retentionUntil:string;progress:FeedbackExtractionProgress;
  call:(operation:string,args:unknown)=>Promise<Reply>;send:Send;check:()=>Promise<void>;
}){
  if(!rawAnnotation.trim()||rawAnnotation.length>2000)throw Error('This note is too long for one teaching. Split it into shorter notes; the original stays saved.');
  await check();
  const frameTime=Math.min(timeMs,Math.max(0,source.metadata.durationMs-1));
  if(!Number.isSafeInteger(frameTime)||frameTime<0)throw Error('This note has no valid frame.');
  const preview=await call('preview',{token:source.token,timeMs:frameTime});
  if(!preview.ok||typeof preview.image!=='string')throw Error('The exact teaching frame could not be opened.');
  const frameSha256=await teachingDigest(teachingFrame(preview.image));
  const expected={sourceId:source.sourceId,sourceSha256:source.metadata.sha256,timeMs:frameTime,frameSha256,rawAnnotation,expectedActiveVersionId:versionId};
  if(progress.annotation&&Object.entries(expected).some(([key,value])=>progress.annotation![key as keyof DemoAnnotation]!==value))throw Error('The saved annotation no longer matches this note.');
  if(!progress.annotation){
    await check();const value=await send('annotation',{action:'save',...expected},`workspace-note:${progress.key}`);
    if(!demoAnnotationReceipt(value,expected))throw Error('Your annotation could not be confirmed saved. Retry this same note.');
    progress.annotation={...expected,annotationId:value.annotationId,annotationDigest:value.annotationDigest};
  }
  const annotation=progress.annotation;
  const binding={sourceId:source.sourceId,sourceSha256:source.metadata.sha256,timeMs:frameTime,frameSha256,annotationId:annotation.annotationId,annotationDigest:annotation.annotationDigest,expectedActiveVersionId:versionId,feedbackSha256:await teachingDigest(new TextEncoder().encode(rawAnnotation))};
  if(!progress.suggestion){
    await check();const {feedbackSha256:_,...wire}=binding;
    const value=await send('suggestion',{...wire,mode:'demonstration',includeScope:true,image:preview.image,consent:true});
    if(!scopedTeachingSuggestion(value,binding))throw Error('The proposed teaching did not match this note and frame.');
    progress.suggestion=value;
  }
  const suggestion=progress.suggestion;
  if(suggestion.status==='insufficient'||!suggestion.fields||!suggestion.scopeSuggestion)return {status:'held' as const,reason:suggestion.reason||'Review the category and example type before saving this teaching.',suggestion,image:preview.image};
  const scope=suggestion.scopeSuggestion;
  if(!TRAINING_PROPERTY_CODES.includes(scope.property as any)||!TRAINING_RELATIONS.includes(scope.relation as any))throw Error('The proposed teaching scope is unsupported.');
  const stages=deriveTrainingStages(scope.property as TrainingPropertyCode);
  if(!progress.record){
    await check();const value=await call('annotate',{token:source.token,timeMs:frameTime,idempotencyKey:progress.key,decision:suggestion.fields,content:{
      relation:scope.relation,properties:[scope.property],mustNotCopy:['source text','source logos','protected identity'],
      applicability:{taskFacts:[],stages,exceptions:[],priority:50},
      governance:{rightsBasis:'owner_created',rightsReceipt:'Coach confirms ownership and grants bounded evidence use',disclosure:'owner_private',retentionUntil,deletionPolicy:'revoke_then_delete_derivatives',consent:true,attribution:''},
    }});
    if(!value.ok||typeof value.recordId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.recordId)||typeof value.recordDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.recordDigest))throw Error('The teaching draft could not be confirmed saved.');
    progress.record={recordId:value.recordId,recordDigest:value.recordDigest};
  }
  if(!progress.linked){
    await check();const value=await send('annotation',{action:'link',annotationId:annotation.annotationId,annotationDigest:annotation.annotationDigest,recordId:progress.record.recordId,expectedRecordDigest:progress.record.recordDigest,expectedActiveVersionId:versionId},`workspace-link:${annotation.annotationId}:${progress.record.recordId}`);
    if(!value.ok||value.contractVersion!=='training-demo-link.v1'||value.annotationId!==annotation.annotationId||value.annotationDigest!==annotation.annotationDigest||value.recordId!==progress.record.recordId||value.recordDigest!==progress.record.recordDigest||typeof value.linkReceiptId!=='string')throw Error('The draft is saved. Retry linking this same note; do not create another draft.');
    progress.linked=true;
  }
  return {status:'drafted' as const,record:progress.record,suggestion,image:preview.image};
}
