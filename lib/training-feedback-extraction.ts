import {buildSpatialAnchor,anchorError,INTENT_CHANGE} from './review-anchor.ts';
import type {DraftSpatial} from './review-timestamp-feedback.ts';
import {demoAnnotationReceipt,scopedTeachingSuggestion,teachingDigest,teachingFrame,type DemoAnnotation,type ScopedTeachingSuggestion,annotationAnalysis,analysisRequestReceipt,type AnnotationAnalysis,type AnalysisRequestReceipt} from './training-teaching-draft.ts';
import {deriveTrainingStages,TRAINING_PROPERTY_CODES,TRAINING_RELATIONS,type TrainingPropertyCode,type TrainingRelation,trainingDirectionFacts} from './training-local-ingress.ts';

export type FeedbackExtractionProgress={key:string;fingerprint?:string;annotation?:DemoAnnotation;suggestion?:ScopedTeachingSuggestion|AnnotationAnalysis;analysisRequest?:AnalysisRequestReceipt;analysisOutcome?:'pending'|'failed';analysisContract?:'training-teaching-suggestion.v7'|'training-teaching-suggestion.v9';analysisIntent?:{retryOf:null|{requestEventId:string;requestDigest:string;acknowledgedUnknownPrior?:true}};record?:{recordId:string;recordDigest:string};linked?:boolean;suggestionStarted?:boolean;draftingRetries?:number;priorDraftOutcome?:'unconfirmed';retentionUntil?:string;reviewedRelation?:TrainingRelation};
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
export type SavedDirectFeedback={fingerprint:string;annotation:DemoAnnotation;feedback:string;spatial:DraftSpatial|null};
export function savedFeedbackMatches(note:SavedDirectFeedback|null,source:Pick<Source,'sourceId'|'metadata'>|null|undefined,timeMs:number,versionId:string|null):boolean{
  return !!note&&note.annotation.sourceId===source?.sourceId&&note.annotation.sourceSha256===source?.metadata.sha256
    &&note.annotation.timeMs===timeMs&&note.annotation.expectedActiveVersionId===versionId;
}
/** Discover resumable UI state only. Canonical scope and frame checks still run
 * when opened and extracted; the journal cannot grant training authority. */
export async function savedDirectFeedback(storage:Pick<Storage,'length'|'key'|'getItem'|'setItem'>,
 {ownerId,sessionId,versionId,sources}:{ownerId:string;sessionId:string;versionId:string;sources:Source[]}):Promise<{notes:SavedDirectFeedback[];unreadableCount:number}>{
  const scope=`${ownerId}:${sessionId}:${versionId}`,prefix=`${JOURNAL_PREFIX}${scope}:`,notes:SavedDirectFeedback[]=[];let unreadableCount=0;
  for(let index=0;index<storage.length;index++){
    const key=storage.key(index);if(!key?.startsWith(prefix))continue;
    try{
      const fingerprint=key.slice(prefix.length),progress=extractionProgressFor(storage,scope,fingerprint),a=progress.annotation;
      if(progress.linked||!a)continue;
      if(!/^[a-f0-9-]{36}$/.test(a.annotationId)||!/^[a-f0-9]{64}$/.test(a.annotationDigest)
        ||!/^[a-f0-9]{64}$/.test(a.frameSha256)||a.expectedActiveVersionId!==versionId
        ||typeof a.rawAnnotation!=='string'||!a.rawAnnotation.trim()||a.rawAnnotation.length>2000
        ||new TextEncoder().encode(a.rawAnnotation).length>8000)throw Error('invalid saved annotation');
      const source=sources.find(source=>source.sourceId===a.sourceId&&source.metadata.sha256===a.sourceSha256);
      if(!source||!Number.isSafeInteger(source.metadata.durationMs)||source.metadata.durationMs<0||!Number.isSafeInteger(a.timeMs)||a.timeMs<0
        ||(source.metadata.durationMs===0?a.timeMs!==0:a.timeMs>=source.metadata.durationMs))throw Error('saved source unavailable');
      const note=JSON.parse(a.rawAnnotation);
      if(note?.role!=='trainer_commentary'||note.sourceKind!=='upload'||note.sourceId!==a.sourceId||note.timeMs!==a.timeMs
        ||typeof note.feedback!=='string'||!note.feedback.trim())continue;
      const spatial=note.spatial??null;
      if(spatial!==null&&anchorError(buildSpatialAnchor({observedArtifactId:a.sourceId,observedArtifactSha256:a.sourceSha256,intent:{mode:INTENT_CHANGE},temporalStartMs:a.timeMs,geometry:spatial.geometry,sourceFrame:spatial.sourceFrame}))!==null)throw Error('invalid saved mark');
      const expected=await teachingDigest(new TextEncoder().encode(JSON.stringify({id:sessionId,version:versionId,sourceId:a.sourceId,sourceSha256:a.sourceSha256,rawAnnotation:a.rawAnnotation,frameTime:a.timeMs})));
      if(expected!==fingerprint)throw Error('saved identity mismatch');
      notes.push({fingerprint,annotation:a,feedback:note.feedback,spatial});
    }catch{unreadableCount++;}
  }
  return {notes:notes.sort((a,b)=>a.fingerprint.localeCompare(b.fingerprint)),unreadableCount};
}
export type FeedbackDraftRequest={key:string;fingerprint:string;annotationId:string;annotationDigest:string;acknowledgedUnknownPrior?:true};
/** This one-click authorization is never persisted. The extractor verifies it
 * only after opening the exact frame and checking the saved annotation. */
export function retryFeedbackDraft(progress:FeedbackExtractionProgress,fingerprint:string):FeedbackDraftRequest{
  if(!/^[a-f0-9]{64}$/.test(fingerprint)||progress.fingerprint!==fingerprint||!progress.annotation
    ||progress.suggestionStarted!==true||progress.suggestion||progress.record||progress.linked
    ||(progress.draftingRetries!==undefined&&(!Number.isSafeInteger(progress.draftingRetries)||progress.draftingRetries<0)))
    throw Error('This draft is not waiting for a new suggestion. Keep the existing saved training.');
  return {key:progress.key,fingerprint,annotationId:progress.annotation.annotationId,annotationDigest:progress.annotation.annotationDigest};
}
export function extractionFailure(value:Reply):string{
  if(value.reason==='idempotency_key_conflict')return 'This note has a conflicting saved draft. No duplicate was created; review its saved training.';
  if(value.reason==='teaching_suggestion_rate_limited')return `Drafting is busy. Retry in ${Number.isSafeInteger(value.retryAfter)?value.retryAfter:60} seconds; your notes and completed drafts are saved.`;
  return 'This note could not be analyzed. Your original feedback and saved drafts are preserved.';
}

/** Compose existing annotation, suggestion, native draft and link writers in order.
 * No acceptance occurs here. Progress survives a failed link so retry reuses its draft.
 */
export async function extractFeedbackTeaching({source,timeMs,rawAnnotation,versionId,retentionUntil,progress,call,send,check,newDraftRequest,analyzeSetup=false,directionScope=false,reviewBeforeSave=false,relationChoice,checkpoint=()=>{}}:{
  source:Source;timeMs:number;rawAnnotation:string;versionId:string;retentionUntil:string;progress:FeedbackExtractionProgress;
  call:(operation:string,args:unknown)=>Promise<Reply>;send:Send;check:()=>Promise<void>;newDraftRequest?:FeedbackDraftRequest;analyzeSetup?:boolean;directionScope?:boolean;reviewBeforeSave?:boolean;relationChoice?:TrainingRelation;checkpoint?:()=>void;
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
    const interrupted=progress.suggestionStarted===true;
    const scopeDirections=directionScope&&progress.analysisContract!=='training-teaching-suggestion.v7';
    if((!analyzeSetup||!['training-teaching-suggestion.v7','training-teaching-suggestion.v9'].includes(progress.analysisContract||''))&&interrupted&&(!newDraftRequest||newDraftRequest.key!==progress.key||newDraftRequest.fingerprint!==progress.fingerprint
      ||newDraftRequest.annotationId!==annotation.annotationId||newDraftRequest.annotationDigest!==annotation.annotationDigest
      ||progress.record||progress.linked))
      throw Error('This extraction was interrupted while drafting. Your note is saved. Review any existing draft before requesting another suggestion.');
    await check();const {feedbackSha256:_,...wire}=binding;
    const previous={suggestionStarted:progress.suggestionStarted,draftingRetries:progress.draftingRetries,priorDraftOutcome:progress.priorDraftOutcome,analysisContract:progress.analysisContract,analysisIntent:progress.analysisIntent};
    const explicitRetry=analyzeSetup&&newDraftRequest&&progress.analysisRequest&&(progress.analysisOutcome==='failed'||newDraftRequest.acknowledgedUnknownPrior===true)
      ?{requestEventId:progress.analysisRequest.requestEventId,requestDigest:progress.analysisRequest.requestDigest,
        ...(progress.analysisOutcome!=='failed'&&newDraftRequest.acknowledgedUnknownPrior===true?{acknowledgedUnknownPrior:true as const}:{})}:null;
    // Reconcile the exact already-approved request after a lost retry response.
    // Falling back to the initial identity would strand its superseding result.
    const retryOf=explicitRetry||progress.analysisIntent?.retryOf||null;
    progress.suggestionStarted=true;if(analyzeSetup){progress.analysisContract=scopeDirections?'training-teaching-suggestion.v9':'training-teaching-suggestion.v7';progress.analysisIntent={retryOf};}
    if(interrupted){progress.draftingRetries=(progress.draftingRetries||0)+1;progress.priorDraftOutcome='unconfirmed';}
    try{checkpoint();}catch(error){Object.assign(progress,previous);throw error;}
    const value=await send('suggestion',{...wire,mode:'demonstration',includeScope:true,image:preview.image,consent:true,
      ...(scopeDirections?{directionScopeContract:'training-direction-scope.v1'}:{}),
      ...(analyzeSetup?{analysis:{contractVersion:'training-annotation-analysis-request.v1',consentVersion:'training-annotation-taste-and-setup.v1',retryOf}}:{})});
    if(analyzeSetup&&analysisRequestReceipt(value.analysisRequest)){progress.analysisRequest=value.analysisRequest;progress.analysisOutcome=typeof value.reason==='string'&&value.reason.startsWith('teaching_suggestion_')&&value.unavailable===true?'failed':'pending';checkpoint();}
    if(!value.ok){if(value.reason==='teaching_suggestion_rate_limited'){progress.suggestionStarted=false;checkpoint();}throw Error(extractionFailure(value));}
    if(scopeDirections&&value.contractVersion!==(analyzeSetup?'training-teaching-suggestion.v9':'training-teaching-suggestion.v8'))throw Error('This analysis did not preserve creative direction. Your feedback is saved.');
    if(analyzeSetup){if(!annotationAnalysis(value,binding))throw Error('The proposed teaching did not match this note and frame.');}
    else if(!scopedTeachingSuggestion(value,binding))throw Error('The proposed teaching did not match this note and frame.');
    progress.suggestion=value as ScopedTeachingSuggestion|AnnotationAnalysis;progress.suggestionStarted=false;checkpoint();
  }
  const suggestion=progress.suggestion;
  if(!suggestion)throw Error('The saved suggestion is missing.');
  if(!(['training-teaching-suggestion.v7','training-teaching-suggestion.v9'].includes(suggestion.contractVersion)?annotationAnalysis(suggestion,binding):scopedTeachingSuggestion(suggestion,binding)))throw Error('The saved suggestion no longer matches this note and frame.');
  if(['training-teaching-suggestion.v8','training-teaching-suggestion.v9'].includes(suggestion.contractVersion)&&suggestion.creativeDirections===null)return {status:'held' as const,reason:'Which creative direction should this lesson apply to? Clarify it in your feedback.',suggestion,image:preview.image};
  if(suggestion.status==='insufficient'||!suggestion.fields||!suggestion.scopeSuggestion)return {status:'held' as const,reason:suggestion.reason||'Review the category and example type before saving this teaching.',suggestion,image:preview.image};
  const scope=suggestion.scopeSuggestion;
  if(!TRAINING_PROPERTY_CODES.includes(scope.property as any)||!TRAINING_RELATIONS.includes(scope.relation as any))throw Error('The proposed teaching scope is unsupported.');
  // Review only the source-example relation before the existing immutable writer.
  // A persisted choice resumes the same save; it never admits the teaching.
  const legacySaveStarted=!!progress.retentionUntil&&!progress.reviewedRelation;
  if(relationChoice!==undefined&&!TRAINING_RELATIONS.includes(relationChoice))throw Error('Choose an example type before saving.');
  if(progress.reviewedRelation!==undefined&&!TRAINING_RELATIONS.includes(progress.reviewedRelation))throw Error('The saved example choice needs review.');
  if(relationChoice!==undefined&&(legacySaveStarted||(progress.reviewedRelation!==undefined?progress.reviewedRelation!==relationChoice:!!progress.record)))throw Error('This teaching save has already started. Finish the saved choice before making a different draft.');
  if(reviewBeforeSave&&!progress.record&&!legacySaveStarted&&!progress.reviewedRelation&&relationChoice===undefined)return {status:'review' as const,suggestion,image:preview.image};
  if(relationChoice!==undefined&&!progress.reviewedRelation){
    progress.reviewedRelation=relationChoice;
    try{checkpoint();}catch(error){delete progress.reviewedRelation;throw error;}
  }
  const chosenRelation=progress.reviewedRelation||scope.relation;
  const stages=deriveTrainingStages(scope.property as TrainingPropertyCode);
  if(!progress.record){
    if(!progress.retentionUntil){
      progress.retentionUntil=retentionUntil;
      try{checkpoint();}catch(error){delete progress.retentionUntil;throw error;}
    }
    await check();const value=await call('annotate',{token:source.token,timeMs:frameTime,idempotencyKey:progress.key,decision:suggestion.fields,content:{
      relation:chosenRelation,properties:[scope.property],mustNotCopy:['source text','source logos','protected identity'],
      applicability:{taskFacts:['training-teaching-suggestion.v8','training-teaching-suggestion.v9'].includes(suggestion.contractVersion)?trainingDirectionFacts(suggestion.creativeDirections!):[],stages,exceptions:[],priority:50},
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
