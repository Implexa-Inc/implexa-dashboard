import {demoAnnotationReceipt,scopedTeachingSuggestion,teachingDigest,teachingFrame,type DemoAnnotation,type ScopedTeachingSuggestion} from './training-teaching-draft.ts';
import {deriveTrainingStages,TRAINING_PROPERTY_CODES,TRAINING_RELATIONS,type TrainingPropertyCode} from './training-local-ingress.ts';

export type FeedbackExtractionProgress={key:string;fingerprint?:string;annotation?:DemoAnnotation;suggestion?:ScopedTeachingSuggestion;record?:{recordId:string;recordDigest:string};linked?:boolean;suggestionStarted?:boolean;retentionUntil?:string};
type Source={sourceId:string;token:string;metadata:{sha256:string;durationMs:number}};
type Reply={ok:boolean;[key:string]:any};
type Send=(operation:'annotation'|'suggestion',body:unknown,key?:string)=>Promise<Reply>;
const JOURNAL_PREFIX='implexa:training-extraction:v1:';
/** Local recovery of the exact in-flight draft, not another training store. The
 * source annotation and teaching remain in the existing canonical writers. */
export function extractionProgressFor(storage:Pick<Storage,'getItem'|'setItem'>,scope:string,fingerprint:string):FeedbackExtractionProgress {
  if(!/^[a-f0-9]{64}$/.test(fingerprint))throw Error('This note has no valid recovery identity.');
  const key=`${JOURNAL_PREFIX}${scope}:${fingerprint}`,raw=storage.getItem(key);
  const h=fingerprint.slice(0,12)+'5'+fingerprint.slice(13,16)+((parseInt(fingerprint[16],16)&3)|8).toString(16)+fingerprint.slice(17,32);
  const nativeKey=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  if(!raw)return {key:nativeKey,fingerprint};
  let value:any;try{value=JSON.parse(raw);}catch{throw Error('This saved extraction needs recovery. Your original note is preserved.');}
  if(!value||value.version!==1||value.progress?.key!==nativeKey||value.progress?.fingerprint!==fingerprint)throw Error('This saved extraction does not match the note.');
  return value.progress;
}
export function checkpointExtraction(storage:Pick<Storage,'setItem'>,scope:string,progress:FeedbackExtractionProgress){
  const value=JSON.stringify({version:1,progress});
  if(value.length>20000)throw Error('This extraction is too large to save for recovery.');
  try{storage.setItem(`${JOURNAL_PREFIX}${scope}:${progress.fingerprint||progress.key}`,value);}catch{throw Error('Implexa could not save this draft for recovery. Free browser storage and retry; your original note stays saved.');}
}
export function extractionFailure(value:Reply):string{
  if(value.reason==='idempotency_key_conflict')return 'This note has a conflicting saved draft. No duplicate was created; review its saved training.';
  if(value.reason==='teaching_suggestion_rate_limited')return `Drafting is busy. Retry in ${Number.isSafeInteger(value.retryAfter)?value.retryAfter:60} seconds; your notes and completed drafts are saved.`;
  return 'This note could not be analyzed. Your original feedback and saved drafts are preserved.';
}

/** Compose existing annotation, suggestion, native draft and link writers in order.
 * No acceptance occurs here. Progress survives a failed link so retry reuses its draft.
 */
export async function extractFeedbackTeaching({source,timeMs,rawAnnotation,versionId,retentionUntil,progress,call,send,check,checkpoint=()=>{}}:{
  source:Source;timeMs:number;rawAnnotation:string;versionId:string;retentionUntil:string;progress:FeedbackExtractionProgress;
  call:(operation:string,args:unknown)=>Promise<Reply>;send:Send;check:()=>Promise<void>;checkpoint?:()=>void;
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
    if(!value.ok)throw Error(extractionFailure(value));
    if(!demoAnnotationReceipt(value,expected))throw Error('Your annotation could not be confirmed saved. Retry this same note.');
    progress.annotation={...expected,annotationId:value.annotationId,annotationDigest:value.annotationDigest};checkpoint();
  }
  const annotation=progress.annotation;
  const binding={sourceId:source.sourceId,sourceSha256:source.metadata.sha256,timeMs:frameTime,frameSha256,annotationId:annotation.annotationId,annotationDigest:annotation.annotationDigest,expectedActiveVersionId:versionId,feedbackSha256:await teachingDigest(new TextEncoder().encode(rawAnnotation))};
  if(!progress.suggestion){
    if(progress.suggestionStarted)throw Error('This extraction was interrupted while drafting. Your note is saved. Review any existing draft before requesting another suggestion.');
    await check();const {feedbackSha256:_,...wire}=binding;
    progress.suggestionStarted=true;try{checkpoint();}catch(error){progress.suggestionStarted=false;throw error;}
    const value=await send('suggestion',{...wire,mode:'demonstration',includeScope:true,image:preview.image,consent:true});
    if(!value.ok){if(value.reason==='teaching_suggestion_rate_limited'){progress.suggestionStarted=false;checkpoint();}throw Error(extractionFailure(value));}
    if(!scopedTeachingSuggestion(value,binding))throw Error('The proposed teaching did not match this note and frame.');
    progress.suggestion=value;progress.suggestionStarted=false;checkpoint();
  }
  const suggestion=progress.suggestion;
  if(!scopedTeachingSuggestion(suggestion,binding))throw Error('The saved suggestion no longer matches this note and frame.');
  if(suggestion.status==='insufficient'||!suggestion.fields||!suggestion.scopeSuggestion)return {status:'held' as const,reason:suggestion.reason||'Review the category and example type before saving this teaching.',suggestion,image:preview.image};
  const scope=suggestion.scopeSuggestion;
  if(!TRAINING_PROPERTY_CODES.includes(scope.property as any)||!TRAINING_RELATIONS.includes(scope.relation as any))throw Error('The proposed teaching scope is unsupported.');
  const stages=deriveTrainingStages(scope.property as TrainingPropertyCode);
  if(!progress.record){
    if(!progress.retentionUntil){progress.retentionUntil=retentionUntil;checkpoint();}
    await check();const value=await call('annotate',{token:source.token,timeMs:frameTime,idempotencyKey:progress.key,decision:suggestion.fields,content:{
      relation:scope.relation,properties:[scope.property],mustNotCopy:['source text','source logos','protected identity'],
      applicability:{taskFacts:[],stages,exceptions:[],priority:50},
      governance:{rightsBasis:'owner_created',rightsReceipt:'Coach confirms ownership and grants bounded evidence use',disclosure:'owner_private',retentionUntil:progress.retentionUntil,deletionPolicy:'revoke_then_delete_derivatives',consent:true,attribution:''},
    }});
    if(!value.ok||typeof value.recordId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.recordId)||typeof value.recordDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.recordDigest))throw Error('The teaching draft could not be confirmed saved.');
    progress.record={recordId:value.recordId,recordDigest:value.recordDigest};checkpoint();
  }
  if(!progress.linked){
    await check();const value=await send('annotation',{action:'link',annotationId:annotation.annotationId,annotationDigest:annotation.annotationDigest,recordId:progress.record.recordId,expectedRecordDigest:progress.record.recordDigest,expectedActiveVersionId:versionId},`workspace-link:${annotation.annotationId}:${progress.record.recordId}`);
    if(!value.ok||value.contractVersion!=='training-demo-link.v1'||value.annotationId!==annotation.annotationId||value.annotationDigest!==annotation.annotationDigest||value.recordId!==progress.record.recordId||value.recordDigest!==progress.record.recordDigest||typeof value.linkReceiptId!=='string')throw Error('The draft is saved. Retry linking this same note; do not create another draft.');
    progress.linked=true;checkpoint();
  }
  return {status:'drafted' as const,record:progress.record,suggestion,image:preview.image};
}
