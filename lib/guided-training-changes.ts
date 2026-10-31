/** Owner-private projection. Server receipts establish inclusion and test status;
 * a model statement is never evidence that a teaching was saved or applied. */
export type FeedbackOutcome='not_analysed'|'not_converted'|'partly'|'added';
export type TrainingChangeRecord={recordId:string;recordDigest:string;summary:string|null;state:'suggested'|'candidate'|'human_accepted'|'retired'|'revoked'|'discarded'|'unavailable'|'removed';included:boolean;admissionOrigin:'none'|'standing_policy'|'owner_candidate'|'human_decision';category:'taste'|'method_preference'|null;sourceKind:'trainer_feedback'|'creation_notes'|'legacy_evidence';policyReceiptId:string|null;policyReceiptDigest:string|null;sourceEventId:string|null;sourceEventDigest:string|null;model:string|null};
export type GuidedTrainingChanges={ok:true;contractVersion:'guided-training-changes.v1';
 binding:{sessionId:string;agentFamilyId:string;workflowVersionId:string;snapshotDigest:string};
 policy:{policyId:string|null;policyDigest:string|null;revision:number;enabled:boolean};
 feedback:Array<{eventId:string;eventDigest:string;text:string|null;sourceKind?:'creation_notes'|'trainer_feedback';analysisStatus:'not_requested'|'pending'|'answered'|'failed'|'unavailable';outcome:FeedbackOutcome;reason:string;uncoveredText:string[];recordIds:string[];proposalOutcomes?:Array<{candidateKey:string;status:'mapped'|'refused';reason:string}>}>;
 records:TrainingChangeRecord[];
 creationImports?:Array<{buildRequestId:string;replyId:string;replyDigest:string;noteCount:number;notes:string[];importedNoteIndices:number[]}>;
 test:{snapshotDigest:string|null;scope:'private_candidate'|'public_projection'|null;status:'not_run'|'running'|'delivered'|'stale'|'failed';runId:string|null;qualityScore:number|null;gaps:string[];canTest:boolean};
 publication:{canPublish:boolean;reason:string;servedSnapshotDigest:string|null;proposedSnapshotDigest?:string|null}};
const id=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sha=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v:any,max:number)=>typeof v==='string'&&v.length<=max;
const strings=(v:any,max:number,count:number)=>Array.isArray(v)&&v.length<=count&&v.every(s=>text(s,max));
export function guidedTrainingChanges(v:any,expected:{sessionId:string;workflowVersionId:string}):v is GuidedTrainingChanges{
 if(v?.ok!==true||v.contractVersion!=='guided-training-changes.v1'||!v.binding||v.binding.sessionId!==expected.sessionId||v.binding.workflowVersionId!==expected.workflowVersionId
  ||!id(v.binding.agentFamilyId)||!sha(v.binding.snapshotDigest)||!v.policy||typeof v.policy.enabled!=='boolean'
  ||!Number.isSafeInteger(v.policy.revision)||v.policy.revision<0||!(v.policy.policyId===null&&v.policy.policyDigest===null||id(v.policy.policyId)&&sha(v.policy.policyDigest))||v.policy.enabled&&v.policy.policyId===null
  ||!Array.isArray(v.records)||v.records.length>100||!Array.isArray(v.feedback)||v.feedback.length>100)return false;
 const seen=new Set();for(const r of v.records){if(!id(r.recordId)||seen.has(r.recordId)||!sha(r.recordDigest)||!(r.summary===null&&!r.included&&['revoked','retired','discarded','unavailable'].includes(r.state)||text(r.summary,2000)&&r.summary.trim())
  ||typeof r.included!=='boolean'||!['none','standing_policy','owner_candidate','human_decision'].includes(r.admissionOrigin)
  ||![null,'taste','method_preference'].includes(r.category)||!['trainer_feedback','creation_notes','legacy_evidence'].includes(r.sourceKind)
  ||!(r.policyReceiptId===null&&r.policyReceiptDigest===null||id(r.policyReceiptId)&&sha(r.policyReceiptDigest))
  ||r.included&&r.admissionOrigin==='none'||r.state==='human_accepted'&&r.admissionOrigin!=='human_decision'
  ||!['suggested','candidate','human_accepted','retired','revoked','discarded','unavailable','removed'].includes(r.state)||!(r.sourceKind==='legacy_evidence'&&r.sourceEventId===null&&r.sourceEventDigest===null||id(r.sourceEventId)&&sha(r.sourceEventDigest))||!(r.model===null||text(r.model,100)))return false;seen.add(r.recordId);}
 const feedbackSeen=new Set();for(const f of v.feedback){if(!id(f.eventId)||feedbackSeen.has(f.eventId)||!sha(f.eventDigest)||!(f.text===null&&f.analysisStatus==='unavailable'||text(f.text,20000))
  ||!['not_requested','pending','answered','failed','unavailable'].includes(f.analysisStatus)||!['not_analysed','not_converted','partly','added'].includes(f.outcome)||!text(f.reason,2000)||!strings(f.uncoveredText,20000,20)||!Array.isArray(f.recordIds)||f.recordIds.length>20
  ||new Set(f.recordIds).size!==f.recordIds.length||f.recordIds.some((rid:any)=>!v.records.some((r:any)=>r.recordId===rid&&r.sourceEventId===f.eventId&&r.sourceEventDigest===f.eventDigest))
  ||f.sourceKind!==undefined&&!['creation_notes','trainer_feedback'].includes(f.sourceKind)
  ||f.analysisStatus==='unavailable'&&(f.text!==null||f.recordIds.some((id:any)=>v.records.some((r:any)=>r.recordId===id&&r.included)))
  ||['partly','added'].includes(f.outcome)&&!f.recordIds.length||f.outcome!=='not_analysed'&&f.analysisStatus!=='answered'&&!(f.analysisStatus==='unavailable'&&['added','partly'].includes(f.outcome)&&f.recordIds.length)
  ||f.proposalOutcomes!==undefined&&(!Array.isArray(f.proposalOutcomes)||f.proposalOutcomes.length>3||f.proposalOutcomes.some((o:any)=>!/^teaching-[123]$/.test(o?.candidateKey||'')||!['mapped','refused'].includes(o.status)||!text(o.reason,2000))))return false;feedbackSeen.add(f.eventId);}
 if(v.creationImports!==undefined&&(!Array.isArray(v.creationImports)||v.creationImports.length>20||v.creationImports.some((i:any)=>!id(i.buildRequestId)||!id(i.replyId)||!sha(i.replyDigest)
  ||!Number.isInteger(i.noteCount)||i.noteCount<1||i.noteCount>8||!strings(i.notes,400,8)||i.notes.length!==i.noteCount||!Array.isArray(i.importedNoteIndices)||new Set(i.importedNoteIndices).size!==i.importedNoteIndices.length
  ||i.importedNoteIndices.some((n:any)=>!Number.isInteger(n)||n<0||n>=i.noteCount))))return false;
 const t=v.test,p=v.publication;
 return !!t&&['not_run','running','delivered','stale','failed'].includes(t.status)&&[null,'private_candidate','public_projection'].includes(t.scope)&&(t.snapshotDigest===null||sha(t.snapshotDigest))&&(t.runId===null||id(t.runId))
  &&(t.status!=='delivered'||id(t.runId)&&sha(t.snapshotDigest)&&t.scope!==null)
  &&(t.qualityScore===null||Number.isFinite(t.qualityScore)&&t.qualityScore>=0&&t.qualityScore<=100)&&strings(t.gaps,2000,30)&&typeof t.canTest==='boolean'
  &&!!p&&typeof p.canPublish==='boolean'&&text(p.reason,2000)&&(p.servedSnapshotDigest===null||sha(p.servedSnapshotDigest))
  &&(!p.canPublish||(t.status==='delivered'&&id(t.runId)&&sha(p.proposedSnapshotDigest)&&t.snapshotDigest===p.proposedSnapshotDigest));
}
