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
 selectionCoverage?:{maxStandingReferences:2;eligibleTextByStage:Array<{stage:string;count:number}>};
 test:{snapshotDigest:string|null;scope:'private_candidate'|'public_projection'|null;status:'not_run'|'prepared'|'queued'|'running'|'delivered'|'stale'|'failed'|'cancelled'|'blocked';runId:string|null;requestId?:string|null;qualityScore:number|null;gaps:string[];canTest:boolean};
 activation?:{canActivate:boolean;reason:string|null;servedSnapshotDigest:string|null;withdrawnSinceTest:number;stoppedSinceTest?:number;testRequestId:string|null};
 publication:{canPublish:boolean;reason:string|null;servedSnapshotDigest:string|null;proposedSnapshotDigest?:string|null;canPrepare?:boolean;
 qualifyingTestRequestId?:string|null;qualifyingRunId?:string|null;qualifyingSnapshotDigest?:string|null}};
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
 const t=v.test,p=v.publication,a=v.activation;
 if(v.selectionCoverage!==undefined&&(!v.selectionCoverage||v.selectionCoverage.maxStandingReferences!==2
  ||!Array.isArray(v.selectionCoverage.eligibleTextByStage)||v.selectionCoverage.eligibleTextByStage.length>10
  ||new Set(v.selectionCoverage.eligibleTextByStage.map((s:any)=>s?.stage)).size!==v.selectionCoverage.eligibleTextByStage.length
  ||v.selectionCoverage.eligibleTextByStage.some((s:any)=>!text(s?.stage,80)||!/^[a-z][a-z_]*$/.test(s.stage)||!Number.isInteger(s.count)||s.count<0||s.count>100)))return false;
 if(a!==undefined&&(!a||typeof a.canActivate!=='boolean'||!(a.reason===null||text(a.reason,2000))||!(a.servedSnapshotDigest===null||sha(a.servedSnapshotDigest))
  ||!Number.isInteger(a.withdrawnSinceTest)||a.withdrawnSinceTest<0||!(a.testRequestId===null||id(a.testRequestId))
  ||a.stoppedSinceTest!==undefined&&(!Number.isInteger(a.stoppedSinceTest)||a.stoppedSinceTest<0)
  ||a.canActivate&&(!id(a.testRequestId)||t?.status!=='delivered'||!id(t?.runId)||t?.requestId!==a.testRequestId)))return false;
 return !!t&&['not_run','prepared','queued','running','delivered','stale','failed','cancelled','blocked'].includes(t.status)&&[null,'private_candidate','public_projection'].includes(t.scope)&&(t.snapshotDigest===null||sha(t.snapshotDigest))&&(t.runId===null||id(t.runId))
  &&(t.requestId===undefined||t.requestId===null||id(t.requestId))
  &&(t.status!=='delivered'||id(t.runId)&&sha(t.snapshotDigest)&&t.scope!==null)
  &&(t.qualityScore===null||Number.isFinite(t.qualityScore)&&t.qualityScore>=0&&t.qualityScore<=100)&&strings(t.gaps,2000,30)&&typeof t.canTest==='boolean'
  &&!!p&&typeof p.canPublish==='boolean'&&(p.canPrepare===undefined||typeof p.canPrepare==='boolean')&&(p.reason===null||text(p.reason,2000))&&(p.servedSnapshotDigest===null||sha(p.servedSnapshotDigest))
  &&(!p.canPublish||(id(p.qualifyingTestRequestId)&&id(p.qualifyingRunId)&&sha(p.proposedSnapshotDigest)&&p.qualifyingSnapshotDigest===p.proposedSnapshotDigest));
}

export type TrainingPublicationPreview={ok:true;contractVersion:'training-publication-preview.v1';publicationPreparationId:string;preparationDigest:string;
 sessionId:string;workflowVersionId:string;candidateSnapshotDigest:string;snapshotDigest:string;definition:{name:string;description:string};
 records:Array<{recordId:string;recordDigest:string;relation:string;properties:string[];summary:string;mustNotCopy:string[];attribution:string|null;deliveryMode:'standing'|'on_question';
  derivative:{kind:string;sha256:string;sizeBytes:number;mediaType:string;width?:number;height?:number}}>;
 publicationDelta:{publishedSnapshotDigest:string|null;definitionChanged:boolean;changes:Array<{recordId:string;change:'added'|'removed'|'changed'|'unchanged'}>};
 qualifyingTestRequestId:string|null;qualifyingRunId:string|null;qualifyingSnapshotDigest:string|null;canPublish:boolean;reason:string|null};
export function trainingPublicationPreview(v:any,expected:{sessionId:string;workflowVersionId:string;snapshotDigest:string;records:TrainingChangeRecord[]}):v is TrainingPublicationPreview{
 if(v?.ok!==true||v.contractVersion!=='training-publication-preview.v1'||!id(v.publicationPreparationId)||!sha(v.preparationDigest)
  ||v.sessionId!==expected.sessionId||v.workflowVersionId!==expected.workflowVersionId||v.candidateSnapshotDigest!==expected.snapshotDigest||!sha(v.snapshotDigest)
  ||!text(v.definition?.name,200)||!v.definition.name.trim()||!text(v.definition?.description,4000)
  ||!Array.isArray(v.records)||v.records.length!==expected.records.length||v.records.length>32||new Set(v.records.map((r:any)=>r?.recordId)).size!==v.records.length
  ||typeof v.canPublish!=='boolean'||!(v.qualifyingTestRequestId===null||id(v.qualifyingTestRequestId))
  ||!(v.qualifyingRunId===null||id(v.qualifyingRunId))||!(v.qualifyingSnapshotDigest===null||sha(v.qualifyingSnapshotDigest))
  ||v.canPublish&&(!id(v.qualifyingTestRequestId)||!id(v.qualifyingRunId)||v.qualifyingSnapshotDigest!==v.snapshotDigest)
  ||!(v.reason===null||text(v.reason,2000)))return false;
 const delta=v.publicationDelta;
 if(!delta||!(delta.publishedSnapshotDigest===null||sha(delta.publishedSnapshotDigest))||typeof delta.definitionChanged!=='boolean'
  ||!Array.isArray(delta.changes)||delta.changes.length>64||new Set(delta.changes.map((c:any)=>c?.recordId)).size!==delta.changes.length
  ||delta.changes.some((c:any)=>!id(c?.recordId)||!['added','removed','changed','unchanged'].includes(c.change)
   ||(c.change==='removed'?v.records.some((r:any)=>r.recordId===c.recordId):!v.records.some((r:any)=>r.recordId===c.recordId)))
  ||v.records.some((r:any)=>!delta.changes.some((c:any)=>c.recordId===r.recordId&&c.change!=='removed')))return false;
 return v.records.every((r:any)=>expected.records.some(e=>e.recordId===r.recordId&&e.recordDigest===r.recordDigest&&e.summary===r.summary)
  &&['accepted','rejected','contrast','exception'].includes(r.relation)&&strings(r.properties,500,15)&&text(r.summary,4000)&&strings(r.mustNotCopy,500,32)
  &&(r.attribution===null||text(r.attribution,4000))&&['standing','on_question'].includes(r.deliveryMode)&&sha(r.derivative?.sha256)
  &&Number.isInteger(r.derivative.sizeBytes)&&r.derivative.sizeBytes>0&&r.derivative.sizeBytes<=8388608
  &&(r.derivative.kind==='text_guidance'?r.derivative.mediaType==='application/json'&&r.derivative.width===undefined&&r.derivative.height===undefined
   :['review_png','training_png','released_training_png'].includes(r.derivative.kind)&&r.derivative.mediaType==='image/png'
    &&[r.derivative.width,r.derivative.height].every((n:any)=>Number.isInteger(n)&&n>0&&n<=2560)));
}

export function trainingSnapshotReason(reason:string|null):string{
 const copy:Record<string,string>={publication_test_required:'Test this exact public selection before publishing it.',training_test_not_ready:'The runtime cannot test this update yet. Nothing has started.',
 publication_base_changed:'The published version changed after this preview. Review the current additions and removals again.',publication_selection_required:'Prepare the exact public selection before testing it.',
 training_candidate_snapshot_changed:'Your private update changed after this test was prepared. Prepare the current update again.',training_delivered_test_required:'This exact update needs a delivered test before activation.',
 manager_text_guidance_codex_required:'This text-guidance test currently requires the Codex executor. Updating a Claude executor will not enable it.',manager_text_guidance_update_required:'Use the updated Implexa Desktop with Manager text-guidance support before testing this update.',
 training_test_lifecycle_contract_missing:'This run did not carry the managed lifecycle contract, so its delivery cannot qualify this training snapshot. Use the prepared Run now path.',training_delivered_test_unverified:'Delivery was recorded, but the verification receipts do not qualify this exact snapshot. Review the test details.',
 training_test_preparation_changed:'This prepared test no longer matches the current update. Return to Training to prepare it again.',training_test_preparation_spent:'This preparation already has a run request. Open that test result rather than starting it again.',
 training_material_unavailable:'The exact definition or teaching material is unavailable. Refresh Training before preparing a test.',agent_active_version_changed:'The agent changed while this action was being prepared. Reload its current Training workspace.',
 training_snapshot_changed:'Your training changed after this snapshot was prepared. Prepare the current update again.',training_test_material_mismatch:'The test does not match this exact definition and teaching set.',
 training_test_not_delivered:'This exact update has not delivered yet. Open its test result before proceeding.',training_publication_preparation_changed:'This public selection changed. Review and prepare the exact selection again.',
 training_feedback_unavailable:'Source feedback is withdrawn or unavailable; it cannot be used in a new update.',public_evidence_storage_required:'Save the exact selected example privately before preparing its public release.'};
 return reason?(copy[reason]||'This snapshot is not ready for that action. Refresh its saved state to see what remains.'):'No delivered test currently qualifies this exact public material.';
}
