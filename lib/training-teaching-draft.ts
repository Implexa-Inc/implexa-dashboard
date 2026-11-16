import {TRAINING_PROPERTY_CODES,TRAINING_RELATIONS,isTrainingDirectionScope,type TrainingDirectionScope} from './training-local-ingress.ts';
export const TEACHING_MODEL = 'claude-haiku-5-5';
export const MAX_TEACHING_FRAME_BYTES = 2 * 1024 * 1024;
// Coordinated wire pin; the Desktop producer test asserts this exact digest.
export const TOOL_FRAME_RECIPE_DIGEST = 'c2401d78ec3079f9292f36050d473ce7a3b2e0c0b5b002bcb2c90c01c3acc34f';
export type ToolFrame = {sourceId:string;timeMs:number;width:number;height:number;recipeDigest:string;receiptDigest:string};
export function toolSuggestionFrame(image:string,frame:ToolFrame|undefined,sourceId:string,timeMs:number):Uint8Array {
  const bytes=teachingFrame(image),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const width=view.getUint32(16),height=view.getUint32(20);
  if(!frame||!exact(frame,['sourceId','timeMs','width','height','recipeDigest','receiptDigest'])||frame.sourceId!==sourceId||frame.timeMs!==timeMs
    ||frame.recipeDigest!==TOOL_FRAME_RECIPE_DIGEST||!/^[a-f0-9]{64}$/.test(frame.receiptDigest)
    ||Array.from(bytes.slice(0,8)).join(',')!=='137,80,78,71,13,10,26,10'||String.fromCharCode(...bytes.slice(12,16))!=='IHDR'
    ||!width||!height||width>1024||height>1024||width!==frame.width||height!==frame.height)throw Error('Desktop did not return the supported tool-analysis frame. Update Desktop and try again.');
  return bytes;
}
export const TEACHING_FIELDS = ['chosen', 'why', 'process', 'desiredBehavior'] as const;
export type TeachingFields = Record<typeof TEACHING_FIELDS[number], string>;
type FrameBinding = { sourceId: string; sourceSha256: string; timeMs: number; frameSha256: string;
  expectedActiveVersionId: string; feedbackSha256: string };
export type SuggestionBinding = FrameBinding & ({ questionReceiptId: string; questionReceiptDigest: string }
  | { annotationId: string; annotationDigest: string });
export type DemoAnnotation = { annotationId: string; annotationDigest: string; rawAnnotation: string;
  sourceId: string; sourceSha256: string; timeMs: number; frameSha256: string; expectedActiveVersionId: string };
export type TeachingSuggestion = { ok: true; contractVersion: 'training-teaching-suggestion.v2' | 'training-teaching-suggestion.v3'; model: string;
  requestId: string;
  binding: SuggestionBinding; status: 'suggested' | 'insufficient'; fields: TeachingFields | null; reason: string;
  sources: { chosen: 'observed_frame'; why: 'trainer_preference'; process: 'transferable_guidance'; desiredBehavior: 'transferable_guidance' } };
export type ScopedTeachingSuggestion=Omit<TeachingSuggestion,'contractVersion'>&{contractVersion:'training-teaching-suggestion.v6'|'training-teaching-suggestion.v8';creativeDirections?:TrainingDirectionScope;scopeSuggestion:{property:string;relation:string}|null};
export type AnalysisRequestReceipt={requestEventId:string;requestDigest:string;attemptOrdinal:number};
export type OperatingGap={status:'suggested'|'present'|'incomplete'|'unsupported';kind:'procedure'|'tool';stepOrder:number|null;
  capability:'web_reference_research'|'presenter_background_removal'|'higgsfield_image_to_video'|null;evidenceExcerpt:string;privateRationale:string;genericDelta:string};
export type AnnotationAnalysis=Omit<ScopedTeachingSuggestion,'contractVersion'>&{contractVersion:'training-teaching-suggestion.v7'|'training-teaching-suggestion.v9';operatingGap:OperatingGap|null;
  analysisReceipt:AnalysisRequestReceipt&{resultEventId:string;resultDigest:string;setupDigest:string;setupState:'complete'|'incomplete';
    target:null|{stepOrder:number;stepDigest:string;methods:Array<{source:string;slug:string;contentDigest:string}>};
    usage:{status:'observed'|'unknown';inputTokens:number|null;outputTokens:number|null}}};
export type AnnotationGapReview={eventId:string;digest:string;revision:number;supersedes:{eventId:string;digest:string}|null};
export type AnnotationGapAnalysis={directionScopeContract?:'training-direction-scope.v1';analysisRequest:AnalysisRequestReceipt;annotation:{annotationId:string;annotationDigest:string};retry:{state:'none'|'after_failure'|'after_unknown';availableAt:string|null};outcome:'pending'|'answered'|'failed'|'refused'|'superseded';reason:string|null;result:AnnotationAnalysis|null;
  edit:{state:'available'|'reviewed_unqueued'|'not_applicable'|'dismissed'|'queued'|'stale'|'blocked';review:AnnotationGapReview|null;requestId:string|null;requestStatus:string|null;reviewedNote:string|null}};
export type AnnotationGapPage={ok:true;contractVersion:'training-annotation-gap-list.v1';analyses:AnnotationGapAnalysis[];nextCursor:null|{afterCreatedAt:string;afterId:string}};
export function analysisRequestReceipt(v:any):v is AnalysisRequestReceipt{
  return exact(v,['requestEventId','requestDigest','attemptOrdinal'])&&recordingUuid(v.requestEventId)&&recordingSha(v.requestDigest)&&Number.isSafeInteger(v.attemptOrdinal)&&v.attemptOrdinal>=1;
}
/** Opt-in extension of the existing teaching decoder. Never relax v6 for older producers. */
export function annotationAnalysis(v:any,expected:SuggestionBinding):v is AnnotationAnalysis{
  if(v?.contractVersion==='training-teaching-suggestion.v9'){
    if(!Object.hasOwn(v,'creativeDirections')||!isTrainingDirectionScope(v.creativeDirections)||v.status==='insufficient'&&v.creativeDirections!==null)return false;
    const {creativeDirections,...legacy}=v;
    return annotationAnalysis({...legacy,contractVersion:'training-teaching-suggestion.v7'},expected);
  }
  if(!v||v.contractVersion!=='training-teaching-suggestion.v7'||!Object.hasOwn(v,'operatingGap')||!Object.hasOwn(v,'analysisReceipt'))return false;
  const {operatingGap:g,analysisReceipt:r,...taste}=v;
  if(!scopedTeachingSuggestion({...taste,contractVersion:'training-teaching-suggestion.v6'},expected))return false;
  if(!exact(r,['requestEventId','requestDigest','attemptOrdinal','resultEventId','resultDigest','setupDigest','setupState','target','usage'])
    ||!analysisRequestReceipt({requestEventId:r.requestEventId,requestDigest:r.requestDigest,attemptOrdinal:r.attemptOrdinal})
    ||!recordingUuid(r.resultEventId)||!recordingSha(r.resultDigest)||!recordingSha(r.setupDigest)||!['complete','incomplete'].includes(r.setupState))return false;
  const t=r.target,u=r.usage;
  if(t!==null&&(!exact(t,['stepOrder','stepDigest','methods'])||!Number.isSafeInteger(t.stepOrder)||t.stepOrder<1||!recordingSha(t.stepDigest)
    ||!Array.isArray(t.methods)||!t.methods.every((m:any)=>exact(m,['source','slug','contentDigest'])&&typeof m.source==='string'&&!!m.source&&typeof m.slug==='string'&&!!m.slug&&recordingSha(m.contentDigest))))return false;
  if(!exact(u,['status','inputTokens','outputTokens'])||!(u.status==='unknown'?u.inputTokens===null&&u.outputTokens===null:
    u.status==='observed'&&[u.inputTokens,u.outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)))return false;
  if(g===null)return true;
  return exact(g,['status','kind','stepOrder','capability','evidenceExcerpt','privateRationale','genericDelta'])
    &&['suggested','present','incomplete','unsupported'].includes(g.status)&&['procedure','tool'].includes(g.kind)
    &&(g.stepOrder===null||Number.isSafeInteger(g.stepOrder)&&g.stepOrder>=1)
    &&(g.capability===null||['web_reference_research','presenter_background_removal','higgsfield_image_to_video'].includes(g.capability))
    &&Object.entries({evidenceExcerpt:400,privateRationale:500,genericDelta:1000}).every(([k,max])=>typeof g[k]==='string'&&Array.from(g[k]).length<=max)
    &&!!g.evidenceExcerpt.trim()&&!!g.privateRationale.trim()
    &&(g.kind!=='procedure'||g.capability===null)&&(g.kind!=='tool'||g.status==='unsupported'||g.capability!==null)
    &&(g.status==='suggested'?!!g.genericDelta.trim():g.genericDelta==='')
    &&(g.stepOrder===null||t!==null&&t.stepOrder===g.stepOrder)
    &&(!['suggested','present'].includes(g.status)||r.setupState==='complete'&&t!==null&&t.stepOrder===g.stepOrder);
}
export function annotationGapPage(v:any,versionId:string):v is AnnotationGapPage{
  return exact(v,['ok','contractVersion','analyses','nextCursor'])&&v.ok===true&&v.contractVersion==='training-annotation-gap-list.v1'
    &&Array.isArray(v.analyses)&&v.analyses.length<=50&&v.analyses.every((a:any)=>{
      if(!exact(a,['analysisRequest','annotation','retry','outcome','reason','result','edit',...(Object.hasOwn(a,'directionScopeContract')?['directionScopeContract']:[])])||Object.hasOwn(a,'directionScopeContract')&&a.directionScopeContract!=='training-direction-scope.v1'||!analysisRequestReceipt(a.analysisRequest)||!['pending','answered','failed','refused','superseded'].includes(a.outcome)
        ||!(a.reason===null||typeof a.reason==='string'&&a.reason.length<=500))return false;
      const r=a.result,b=r?.binding,e=a.edit;
      if(!exact(a.annotation,['annotationId','annotationDigest'])||!recordingUuid(a.annotation.annotationId)||!recordingSha(a.annotation.annotationDigest)
        ||!exact(a.retry,['state','availableAt'])||!['none','after_failure','after_unknown'].includes(a.retry.state)
        ||!(a.retry.availableAt===null||typeof a.retry.availableAt==='string'&&Number.isFinite(Date.parse(a.retry.availableAt))))return false;
      if(r!==null&&(r.contractVersion!==(a.directionScopeContract?'training-teaching-suggestion.v9':'training-teaching-suggestion.v7')||!b||!exact(b,['sourceId','sourceSha256','timeMs','frameSha256','expectedActiveVersionId','feedbackSha256','annotationId','annotationDigest'])
        ||!['sourceId','annotationId'].every(k=>recordingUuid(b[k]))||!['sourceSha256','frameSha256','feedbackSha256','annotationDigest'].every(k=>recordingSha(b[k]))
        ||b.annotationId!==a.annotation.annotationId||b.annotationDigest!==a.annotation.annotationDigest||!Number.isSafeInteger(b.timeMs)||b.timeMs<0||b.expectedActiveVersionId!==versionId||!annotationAnalysis(r,b)
        ||!(['requestEventId','requestDigest','attemptOrdinal'] as const).every(k=>r.analysisReceipt[k]===a.analysisRequest[k])))return false;
      return (a.outcome==='answered'?r!==null:r===null)&&exact(e,['state','review','requestId','requestStatus','reviewedNote'])
        &&(e.review===null||exact(e.review,['eventId','digest','revision','supersedes'])&&recordingUuid(e.review.eventId)&&recordingSha(e.review.digest)
          &&Number.isSafeInteger(e.review.revision)&&e.review.revision>=1&&(e.review.supersedes===null||exact(e.review.supersedes,['eventId','digest'])&&recordingUuid(e.review.supersedes.eventId)&&recordingSha(e.review.supersedes.digest)))
        &&['available','reviewed_unqueued','not_applicable','dismissed','queued','stale','blocked'].includes(e.state)
        &&(e.requestId===null||recordingUuid(e.requestId))&&(e.requestStatus===null||typeof e.requestStatus==='string'&&e.requestStatus.length<=100)
        &&(e.reviewedNote===null||typeof e.reviewedNote==='string'&&e.reviewedNote.length<=2000&&new TextEncoder().encode(e.reviewedNote).length<=8000)
        &&(!['available','reviewed_unqueued'].includes(e.state)||(r?.operatingGap?.kind==='procedure'||r?.operatingGap?.kind==='tool'&&r.operatingGap.capability==='higgsfield_image_to_video')&&r.operatingGap.status==='suggested'&&r.analysisReceipt.target!==null);
    })&&(v.nextCursor===null||exact(v.nextCursor,['afterCreatedAt','afterId'])&&recordingUuid(v.nextCursor.afterId)&&typeof v.nextCursor.afterCreatedAt==='string'&&Number.isFinite(Date.parse(v.nextCursor.afterCreatedAt)));
}
/** The workspace opts in; older callers keep their exact v2/v3 contract. */
export function scopedTeachingSuggestion(value:any,expected:SuggestionBinding):value is ScopedTeachingSuggestion{
  if(value?.contractVersion==='training-teaching-suggestion.v8'){
    if(!Object.hasOwn(value,'creativeDirections')||!isTrainingDirectionScope(value.creativeDirections)||value.status==='insufficient'&&value.creativeDirections!==null)return false;
    const {creativeDirections,...legacy}=value;
    return scopedTeachingSuggestion({...legacy,contractVersion:'training-teaching-suggestion.v6'},expected);
  }
  if(!value||value.contractVersion!=='training-teaching-suggestion.v6'||!Object.hasOwn(value,'scopeSuggestion'))return false;
  const {scopeSuggestion,...legacy}=value;
  if(!teachingSuggestion({...legacy,contractVersion:'training-teaching-suggestion.v3'},expected))return false;
  if(value.status==='insufficient')return scopeSuggestion===null;
  return scopeSuggestion===null || (exact(scopeSuggestion,['property','relation'])&&TRAINING_PROPERTY_CODES.includes(scopeSuggestion.property as any)&&TRAINING_RELATIONS.includes(scopeSuggestion.relation as any));
}
const exact = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export async function teachingDigest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function teachingFrame(image: string): Uint8Array {
  if (!image.startsWith('data:image/png;base64,') || image.length > 2800000) throw Error('This frame is too large for suggestions. Keep drafting manually; no frame was sent.');
  const bytes = Uint8Array.from(atob(image.slice(22)), c => c.charCodeAt(0));
  if (bytes.length > MAX_TEACHING_FRAME_BYTES || bytes.length < 33) throw Error('This frame cannot be used for suggestions. Keep drafting manually; no frame was sent.');
  return bytes;
}
export function teachingSuggestion(v: any, expected: SuggestionBinding): v is TeachingSuggestion {
  if (!exact(v, ['ok', 'contractVersion', 'model', 'requestId', 'binding', 'status', 'fields', 'reason', 'sources']) || v.ok !== true
    || typeof v.requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.requestId)
    || v.contractVersion !== ('annotationId' in expected ? 'training-teaching-suggestion.v3' : 'training-teaching-suggestion.v2') || typeof v.model !== 'string' || v.model !== TEACHING_MODEL
    || !exact(v.binding, Object.keys(expected)) || Object.entries(expected).some(([k, value]) => v.binding[k] !== value)
    || typeof v.reason !== 'string' || v.reason.length > 300 || !exact(v.sources, [...TEACHING_FIELDS])
    || v.sources.chosen !== 'observed_frame' || v.sources.why !== 'trainer_preference'
    || v.sources.process !== 'transferable_guidance' || v.sources.desiredBehavior !== 'transferable_guidance') return false;
  return v.status === 'insufficient' ? v.fields === null && Boolean(v.reason.trim())
    : v.status === 'suggested' && v.reason === '' && exact(v.fields, [...TEACHING_FIELDS])
      && TEACHING_FIELDS.every(k => typeof v.fields[k] === 'string' && v.fields[k].trim() && v.fields[k].length <= 400);
}
export function demoAnnotationReceipt(v: any, expected: Omit<DemoAnnotation, 'annotationId' | 'annotationDigest'>): v is { ok: true; annotationId: string; annotationDigest: string; annotation: Record<string, unknown> } {
  return v?.ok === true && v.contractVersion === 'training-demo-annotation.v1'
    && typeof v.annotationId === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.annotationId)
    && typeof v.annotationDigest === 'string' && /^[a-f0-9]{64}$/.test(v.annotationDigest)
    && v.annotation?.contractVersion === 'training-demo-annotation.v1'
    && Object.entries(expected).every(([key,value]) => v.annotation[key === 'expectedActiveVersionId' ? 'targetVersionId' : key] === value);
}
export function teachingFailure(value: unknown, status: number): string {
  const messages: Record<string, string> = {
    scope_session: 'The training session could not be verified.', scope_version: 'The active agent version could not be verified.',
    scope_source: 'The selected source could not be verified.', scope_question: 'The recorded question could not be read through its authorized scope.',
    scope_annotation: 'The saved demonstration annotation could not be verified.',
    provider_not_configured: 'The drafting provider is not configured.', provider_auth: 'The drafting provider rejected its credentials.',
    provider_refused: 'The drafting provider declined this request.',
    provider_model_unavailable: 'The configured drafting model is unavailable.', provider_rejected: 'The drafting provider rejected the request.',
    provider_rate_limited: 'The drafting provider is rate-limited.', provider_unavailable: 'The drafting provider is unavailable.',
    provider_timeout: 'The drafting request timed out.', cancelled: 'The drafting request was cancelled.',
    response_format_invalid: 'The drafting reply was not valid JSON.', response_schema_invalid: 'The drafting reply did not fit the teaching fields.',
    proxy_response_invalid: 'The Training backend returned an unreadable reply.', proxy_timeout: 'The Training proxy timed out.', backend_unreachable: 'The Training backend could not be reached.',
    rate_limited: 'Too many drafting requests were made recently.', invalid: 'The selected frame or drafting request is invalid.',
  };
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const suffix = typeof v.reason === 'string' ? v.reason.replace(/^teaching_suggestion_/, '') : '';
  const aliases: Record<string, string> = { session_not_found: 'scope_session', agent_active_version_changed: 'scope_version', source_not_found: 'scope_source', question_not_found: 'scope_question', demo_annotation_not_found: 'scope_annotation', demo_annotation_scope_invalid: 'scope_annotation' };
  const code = Object.hasOwn(messages, suffix) ? suffix : Object.hasOwn(aliases, suffix) ? aliases[suffix] : undefined;
  const reference = typeof v.requestId === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.requestId) ? ` · reference ${v.requestId}` : '';
  return `${code ? messages[code] : 'Suggestions are unavailable or did not match this frame.'} Your answer and manual draft are preserved. (HTTP ${status}${code ? ` · ${code}` : ''}${reference})`;
}

export type RecordingFrame = {timeMs:number;frameSha256:string;image:string};
export type RecordingExcerpt = {sourceId:string;sourceSha256:string;targetVersionId:string;startIndex:number;endIndex:number;startMs:number;endMs:number;text:string;
  segments:Array<{index:number;startMs:number;endMs:number;text:string}>};
export type RecordingSuggestion = {ok:true;contractVersion:'training-teaching-suggestion.v4';requestId:string;model:string;status:'suggested';fields:TeachingFields;reason:'';
  frameIndex:number;suggestionId:string;suggestionDigest:string;sources:Record<typeof TEACHING_FIELDS[number],string>;
  binding:{sourceId:string;sourceSha256:string;targetVersionId:string;excerptId:string;excerptDigest:string;frames:Array<{timeMs:number;frameSha256:string}>}};
export type RecordingAgentCapability = 'web_reference_research'|'presenter_background_removal'|'higgsfield_image_to_video';
export function isRecordingAgentCapability(v:unknown):v is RecordingAgentCapability {
 return typeof v==='string'&&['web_reference_research','presenter_background_removal','higgsfield_image_to_video'].includes(v);
}
export function recordingLocatorCapability(v:any,requested:RecordingAgentCapability|'auto'):{ok:true;capability:RecordingAgentCapability|null}|{ok:false} {
 if(!['located','insufficient'].includes(v?.status))return {ok:false};
 if(requested==='auto')return v.status==='insufficient'
  ? v.capability===null?{ok:true,capability:null}:{ok:false}
  : isRecordingAgentCapability(v.capability)?{ok:true,capability:v.capability}:{ok:false};
 return isRecordingAgentCapability(requested)&&(v.capability===undefined||v.capability===(v.status==='located'?requested:null))
  ?{ok:true,capability:v.status==='located'?requested:null}:{ok:false};
}

export type RecordingAgentSuggestion = {ok:true;contractVersion:'training-recording-agent-suggestion.v1';requestId:string;model:string;status:'suggested';
  capability:RecordingAgentCapability;frameIndex:number;reason:'';limitations:string[];suggestionId:string;suggestionDigest:string;
  proposedChange:string;application:'not_applied';methodSelection:'pending_existing_binder'|'agent_change_required';binding:RecordingSuggestion['binding']};
export function recordingAgentSuggestion(v:any,expected:RecordingSuggestion['binding'],capability:RecordingAgentCapability='web_reference_research'):v is RecordingAgentSuggestion {
  return exact(v,['ok','contractVersion','requestId','model','status','capability','frameIndex','reason','limitations','suggestionId','suggestionDigest','proposedChange','application','methodSelection','binding'])
    && v.ok===true&&v.contractVersion==='training-recording-agent-suggestion.v1'&&v.model===TEACHING_MODEL&&recordingUuid(v.requestId)
    &&v.status==='suggested'&&v.capability===capability&&['web_reference_research','presenter_background_removal','higgsfield_image_to_video'].includes(v.capability)&&v.reason===''&&Number.isInteger(v.frameIndex)&&v.frameIndex>=0&&v.frameIndex<3
    &&recordingUuid(v.suggestionId)&&recordingSha(v.suggestionDigest)&&typeof v.proposedChange==='string'&&v.proposedChange.length>0&&v.proposedChange.length<=2000
    &&v.application==='not_applied'&&(v.methodSelection==='pending_existing_binder'||v.methodSelection==='agent_change_required'&&v.capability==='higgsfield_image_to_video')&&Array.isArray(v.limitations)&&v.limitations.length<=5
    &&v.limitations.every((s:unknown)=>typeof s==='string'&&!!s.trim()&&s.length<=200)
    &&exact(v.binding,Object.keys(expected))&&JSON.stringify(v.binding)===JSON.stringify(expected);
}
const recordingUuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const recordingSha=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function recordingSuggestion(v:any,expected:RecordingSuggestion['binding']):v is RecordingSuggestion {
  return exact(v,['ok','contractVersion','requestId','model','status','fields','reason','frameIndex','suggestionId','suggestionDigest','sources','binding'])
    && v.ok===true && v.contractVersion==='training-teaching-suggestion.v4' && v.model===TEACHING_MODEL && recordingUuid(v.requestId)
    && recordingUuid(v.suggestionId) && recordingSha(v.suggestionDigest) && v.status==='suggested' && v.reason===''
    && Number.isInteger(v.frameIndex) && v.frameIndex>=0 && v.frameIndex<3 && exact(v.fields,[...TEACHING_FIELDS])
    && TEACHING_FIELDS.every(k=>typeof v.fields[k]==='string'&&v.fields[k].trim()&&v.fields[k].length<=400)
    && exact(v.sources,[...TEACHING_FIELDS]) && v.sources.chosen==='observed_frame' && v.sources.why==='inferred_from_recognized_narration'
    && v.sources.process==='transferable_guidance' && v.sources.desiredBehavior==='transferable_guidance'
    && exact(v.binding,Object.keys(expected)) && ['sourceId','sourceSha256','targetVersionId','excerptId','excerptDigest'].every(k=>v.binding[k]===expected[k as keyof typeof expected])
    && Array.isArray(v.binding.frames)&&v.binding.frames.length===3 && v.binding.frames.every((f:any,i:number)=>exact(f,['timeMs','frameSha256'])&&f.timeMs===expected.frames[i].timeMs&&f.frameSha256===expected.frames[i].frameSha256);
}
