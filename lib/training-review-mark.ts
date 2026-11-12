import {TEACHING_FIELDS,TEACHING_MODEL,type TeachingFields} from './training-teaching-draft.ts';
import {TRAINING_PROPERTY_CODES,TRAINING_RELATIONS} from './training-local-ingress.ts';

export const REVIEW_MARK_BINDING_KEYS=['sourceId','reviewSessionId','issueId','evidenceId','expectedActiveVersionId','issueDigest','anchorDigest','artifactSha256','evidenceSha256'] as const;
export type ReviewMarkBinding=Record<typeof REVIEW_MARK_BINDING_KEYS[number],string>;
export type ReviewMarkContext={ok:true;contractVersion:'training-review-mark.v1'|'training-review-mark-evidence.v1';binding:ReviewMarkBinding;
 evidence:{evidenceId:string;sha256:string;sizeBytes:number;width:number;height:number;mediaType:'image/png';timeMs:number};
 feedback:string;source:{runId:string;artifactId:string;sourceRole:string}};
export type ReviewMarkSuggestion={ok:true;contractVersion:'training-teaching-suggestion.v7';model:string;binding:ReviewMarkBinding;
 status:'suggested'|'insufficient';fields:TeachingFields|null;reason:string;scopeSuggestion:{property:string;relation:string}|null;
 sources:{chosen:'observed_frame';why:'trainer_preference';process:'transferable_guidance';desiredBehavior:'transferable_guidance'}};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v:any,keys:readonly string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function reviewMarkBinding(value:any):value is ReviewMarkBinding {
 return exact(value,REVIEW_MARK_BINDING_KEYS)&&REVIEW_MARK_BINDING_KEYS.every(key=>key.endsWith('Digest')||key.endsWith('Sha256')?sha(value[key]):uuid(value[key]));
}
export function sameReviewMarkBinding(a:any,b:ReviewMarkBinding):boolean{return reviewMarkBinding(a)&&REVIEW_MARK_BINDING_KEYS.every(key=>a[key]===b[key]);}
export function reviewMarkContext(value:any,expected:{sourceId:string;reviewSessionId:string;issueId:string;versionId:string;runId:string;artifactId:string;artifactSha256:string;feedback:string}):value is ReviewMarkContext {
 if(!value||value.ok!==true||!['training-review-mark.v1','training-review-mark-evidence.v1'].includes(value.contractVersion)||!reviewMarkBinding(value.binding))return false;
 const b=value.binding,e=value.evidence,s=value.source;
 return b.sourceId===expected.sourceId&&b.reviewSessionId===expected.reviewSessionId&&b.issueId===expected.issueId&&b.expectedActiveVersionId===expected.versionId
  &&b.artifactSha256===expected.artifactSha256&&value.feedback===expected.feedback&&typeof value.feedback==='string'&&!!value.feedback.trim()&&value.feedback.length<=4000
  &&exact(e,['evidenceId','sha256','sizeBytes','width','height','mediaType','timeMs'])&&e.evidenceId===b.evidenceId&&e.sha256===b.evidenceSha256
  &&Number.isSafeInteger(e.sizeBytes)&&e.sizeBytes>=33&&e.sizeBytes<=8*1024*1024&&e.mediaType==='image/png'
  &&Number.isSafeInteger(e.width)&&e.width>0&&e.width<=2560&&Number.isSafeInteger(e.height)&&e.height>0&&e.height<=2560&&Number.isSafeInteger(e.timeMs)&&e.timeMs>=0
  &&exact(s,['runId','artifactId','sourceRole'])&&s.runId===expected.runId&&s.artifactId===expected.artifactId&&s.sourceRole==='same_agent_prior_work';
}
export function reviewMarkSuggestion(value:any,binding:ReviewMarkBinding):value is ReviewMarkSuggestion {
 if(!exact(value,['ok','contractVersion','model','binding','status','fields','reason','scopeSuggestion','sources'])||value.ok!==true||value.contractVersion!=='training-teaching-suggestion.v7'||value.model!==TEACHING_MODEL
  ||!sameReviewMarkBinding(value.binding,binding)||typeof value.reason!=='string'||value.reason.length>300
  ||!exact(value.sources,TEACHING_FIELDS)||value.sources.chosen!=='observed_frame'||value.sources.why!=='trainer_preference'||value.sources.process!=='transferable_guidance'||value.sources.desiredBehavior!=='transferable_guidance')return false;
 if(value.status==='insufficient')return value.fields===null&&value.scopeSuggestion===null&&!!value.reason.trim();
 return value.status==='suggested'&&value.reason===''&&exact(value.fields,TEACHING_FIELDS)&&TEACHING_FIELDS.every(k=>typeof value.fields[k]==='string'&&!!value.fields[k].trim()&&value.fields[k].length<=400)
  &&(value.scopeSuggestion===null||exact(value.scopeSuggestion,['property','relation'])&&TRAINING_PROPERTY_CODES.includes(value.scopeSuggestion.property)&&TRAINING_RELATIONS.includes(value.scopeSuggestion.relation));
}
/** Saved Review PNGs keep their exact bytes; the older demonstration image limit is unchanged. */
export function reviewMarkFrame(image:string,evidence:ReviewMarkContext['evidence']):Uint8Array {
 if(typeof image!=='string'||!image.startsWith('data:image/png;base64,')||image.length>12*1024*1024)throw Error('The saved teaching frame could not be opened.');
 const bytes=Uint8Array.from(atob(image.slice(22)),c=>c.charCodeAt(0));
 if(bytes.length!==evidence.sizeBytes||bytes.length<33||bytes.length>8*1024*1024||Array.from(bytes.slice(0,8)).join(',')!=='137,80,78,71,13,10,26,10'||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw Error('The saved teaching frame does not match its evidence.');
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(data.getUint32(16)!==evidence.width||data.getUint32(20)!==evidence.height)throw Error('The saved teaching frame dimensions changed.');
 return bytes;
}
export function reviewMarkApplied(value:any):value is {ok:true;contractVersion:'training-review-applied.v1';created:boolean;recordId:string;recordDigest:string;state:'accepted';acknowledgmentId:string;acknowledgmentDigest:string}{
 return exact(value,['ok','contractVersion','created','recordId','recordDigest','state','acknowledgmentId','acknowledgmentDigest'])&&value.ok===true&&value.contractVersion==='training-review-applied.v1'&&typeof value.created==='boolean'&&uuid(value.recordId)&&sha(value.recordDigest)&&value.state==='accepted'&&uuid(value.acknowledgmentId)&&sha(value.acknowledgmentDigest);
}
