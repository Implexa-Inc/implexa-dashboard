'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import PublisherTeachingRelease,{GuidedPublicationReview} from './publisher-teaching-release';
import TrainingChat,{type TrainingChatRequest} from './training-chat';
import TrainingChanges from './training-changes';
import NewReview from '../../review/new/new-review';
import Modal from '../../_components/modal';
import {guidedTrainingChanges,trainingPublicationPreview,type TrainingPublicationPreview,type GuidedTrainingChanges,type TrainingChangeRecord} from '@/lib/guided-training-changes';
import {TrainingEntry,TrainingInfo,TrainingImage,TrainingDetails,revealTrainingElement,type TrainingView,type TrainingRun} from './training-workspace';
import { useEffect, useMemo, useRef, useState } from 'react';
import { answerReceipt, questionGroups, questionsPage, type QuestionAnswer, type QuestionsPage } from '@/lib/trainer-questions';
import { teachingDigest, teachingFrame, teachingSuggestion, teachingFailure, demoAnnotationReceipt, TEACHING_FIELDS, type TeachingSuggestion, type DemoAnnotation, recordingSuggestion, recordingAgentSuggestion, type RecordingAgentSuggestion, type RecordingSuggestion, type RecordingFrame, type RecordingExcerpt } from '@/lib/training-teaching-draft';
import {
  deriveTrainingStages,
  isTrainingEvidenceStorage,
  type TrainingEvidenceStorage,
  formatTrainingTime,
  isManagerTrainingCoverage,
  isManagerTrainingRequirements,
  isTrainingSuccessorProjection,
  normalizeTrainingStages,
  previewMatches,
  trainingStageLabel,
  TRAINING_LOCAL_CONTRACT_VERSION,
  TRAINING_PROPERTY_CODES,
  TRAINING_RELATIONS,
  TRAINING_STAGE_OPTIONS,
  TRAINING_STAGE_ROUTING_VERSION,
  requiredStagesForDecision,
  type ManagerTrainingRequirements,
  type ManagerTrainingCoverage,
  type TrainingPropertyCode,
  type TrainingRelation,
  type TrainingStage,
  type TrainingSuccessorProjection,
} from '@/lib/training-local-ingress';

type DecisionState = 'draft' | 'accepted' | 'retired' | 'unavailable' | 'revoked';
type DeliveryMode = 'standing' | 'on_question';
type Decision = {
  recordId: string;
  recordDigest: string;
  state: DecisionState;
  deliveryMode?: DeliveryMode;
  deliveryReceiptDigest?: string | null;
  content: { relation: TrainingRelation; properties: TrainingPropertyCode[]; summary: string; anchor: { startMs: number }; derivatives?: Array<{ sha256: string }>; applicability?: { stages?: string[]; priority?: number } };
  decision: { chosen: string; why: string; process: string; desiredBehavior: string };
};
type Source = {
  sourceId: string;
  sourceReferenceDigest: string;
  token: string | null;
  localName?: string;
  metadata: { durationMs: number; mediaType: string; sha256: string; width: number; height: number };
  decisions: Decision[];
};
type LocalDraft = { token: string; key?: string; retryable: boolean; reason: string };
type Home = {
  agent: { name?: string; currentVersionId: string | null };
  recentSessions: Array<{ sessionId: string; sourceMode: string; terminal: boolean; agent: { baseVersionId: string } }>;
  successorProjection: TrainingSuccessorProjection;
  managerTrainingRequirements?: ManagerTrainingRequirements;
};
type Scope = {
  installationId?: string;
  agent: { name?: string; currentVersionId: string | null };
  session?: { sessionId: string; baseVersionId: string; parentSessionId?: string | null; terminal: boolean };
};
type Result = {
  ok: boolean;
  reason?: string;
  sessionId?: string;
  sourceId?: string;
  token?: string;
  baseVersionId?: string;
  parentSessionId?: string | null;
  home?: Home;
  scope?: Scope;
  sources?: Source[];
  image?: string;
  recordId?: string;
  recordDigest?: string;
  state?: DecisionState;
  mode?: DeliveryMode;
  receiptDigest?: string;
  storage?: TrainingEvidenceStorage | null;
  cleanup?: 'deleted' | 'pending';
  failedDrafts?: LocalDraft[];
  pendingDecisions?: LocalDraft[];
  managerCoverage?: ManagerTrainingCoverage;
  managerTrainingRequirements?: ManagerTrainingRequirements;
};
type Bridge = {
  trainingLocalContractVersion?: string;
  trainingRecordingContractVersion?: string;
  trainingRecordingLibraryContractVersion?: string;
  trainingEvidenceStorageContractVersion?: string;
  trainingLocal: (operation: string, args: unknown) => Promise<Result>;
};
type Preview = { token: string; timeMs: number; image: string };
type ReviewedDecision = { source: Source; decision: Decision; image: string | null; readOnly?: boolean };
type VersionTransition = { fromVersion: string; sources: Source[] };

class TrainingError extends Error {
  constructor(readonly reason: string, message?: string) { super(message || reason); }
}

const bridge = () => (window as unknown as { implexaDesktop?: Bridge }).implexaDesktop;
const shortId = (value: string | null | undefined) => value ? value.slice(0, 8) : 'none';
const relationLabel = (relation: TrainingRelation) => ({ accepted: 'Positive example', rejected: 'Negative example', contrast: 'Contrastive example', exception: 'Exception' })[relation];
const reasonLabel = (reason: string) => reason.replaceAll('_', ' ');
const legacyControls='[&_button]:rounded-md [&_button]:border [&_button]:border-ink-700 [&_button]:px-3 [&_button]:py-1.5 [&_button]:text-xs [&_button:disabled]:opacity-40';
const coveragePairKey = (pair: { stage: string; property: string; relation: string }) => `${pair.stage}:${pair.property}:${pair.relation}`;

function resolveBridge() {
  const candidate = bridge();
  if (!candidate?.trainingLocal) throw new TrainingError('training_desktop_required', 'Open this page in an updated Implexa Desktop to select a local training source.');
  if (candidate.trainingLocalContractVersion !== TRAINING_LOCAL_CONTRACT_VERSION) {
    throw new TrainingError('training_desktop_update_required', 'Update Implexa Desktop before training. This page requires the local training v2 bridge.');
  }
  return candidate;
}

export default function TrainingSource({ slug, installationId, forkPermission,ownerId,recordingSelection,lastRunId,recentRuns=[],runsUnavailable=false }: { slug: string;recentRuns?:TrainingRun[];runsUnavailable?:boolean;lastRunId?:string|null; ownerId?:string;recordingSelection?:{recordingId:string;momentId:string|null}; installationId?: string; forkPermission?: {lineageId:string;parentVersionId:string} }) {
  const router=useRouter();
  const [retention] = useState(() => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCMilliseconds(0); return d.toISOString(); });
  const [view,setView]=useState<TrainingView>(recordingSelection?'teach':forkPermission?'settings':'start');
  const [chatExpanded,setChatExpanded]=useState(false);
  const showTeaching=()=>setView('teach');
  const focusChat=()=>{setChatExpanded(true);requestAnimationFrame(()=>document.getElementById('training-chat-message')?.focus());};
  const reveal=(id:string)=>{setChatExpanded(false);setView('teach');requestAnimationFrame(()=>revealTrainingElement(id));};
  const [session, setSession] = useState('');
  const [sessionVersion, setSessionVersion] = useState('');
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [agentName, setAgentName] = useState(slug);
  const [versionChanged, setVersionChanged] = useState(false);
  const [publication,setPublication]=useState<{versionId:string;shared:boolean;publicUrl:string}|null>(null);
  const [publishConfirmed,setPublishConfirmed]=useState(false);
  useEffect(()=>{setPublication(null);setPublishConfirmed(false);},[slug,currentVersion]);
  const [transitionConfirmed, setTransitionConfirmed] = useState(false);
  const [versionTransition, setVersionTransition] = useState<VersionTransition | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [recentSessions,setRecentSessions]=useState<Home['recentSessions']>([]);
  const [history,setHistory]=useState<{sessionId:string;versionId:string;sources:Source[]}|null>(null),[historyBusy,setHistoryBusy]=useState(false),[historyError,setHistoryError]=useState('');
  const historyRead=useRef(0);
  useEffect(()=>{historyRead.current++;setHistory(null);setHistoryBusy(false);setHistoryError('');},[session,currentVersion]);
  const earlierSessions=recentSessions.filter((item,index,all)=>item.sourceMode==='raw_input'&&item.agent.baseVersionId!==currentVersion&&all.findIndex(other=>other.agent.baseVersionId===item.agent.baseVersionId)===index).slice(0,3);
  async function showHistory(item:Home['recentSessions'][number]){
    const request=++historyRead.current;setHistoryBusy(true);setHistoryError('');
    try{
      const scoped=await call('scope',{slug,sessionId:item.sessionId});
      if(scoped.scope?.session?.sessionId!==item.sessionId||scoped.scope.session.baseVersionId!==item.agent.baseVersionId)throw Error('Historical training could not be verified.');
      const result=await call('list',{sessionId:item.sessionId});
      if(request===historyRead.current)setHistory({sessionId:item.sessionId,versionId:item.agent.baseVersionId,sources:result.sources||[]});
    }catch{if(request===historyRead.current)setHistoryError('This earlier version could not load. Your current training is unchanged.');}
    finally{if(request===historyRead.current)setHistoryBusy(false);}
  }
  function currentTraining(){historyRead.current++;setHistory(null);setHistoryBusy(false);setHistoryError('');}
  const versionPicker=<nav className="flex items-center gap-4 text-xs" aria-label="Learning versions"><button type="button" aria-current={!history?'page':undefined} onClick={currentTraining} className={!history?'text-ink-100':'text-ink-500'}>Current</button>{earlierSessions.map((item,i)=><button type="button" key={item.sessionId} disabled={historyBusy} aria-current={history?.sessionId===item.sessionId?'page':undefined} title={`Agent version ${shortId(item.agent.baseVersionId)}`} onClick={()=>void showHistory(item)} className={history?.sessionId===item.sessionId?'text-ink-100':'text-ink-500'}>Earlier {i+1}</button>)}</nav>;
  function savedExample(record:TrainingChangeRecord){
    if(!record.summary||record.sourceKind!=='legacy_evidence'||['revoked','unavailable','discarded','retired'].includes(record.state))return null;
    for(const [inventory,readOnly] of [[sources,false],[versionTransition?.sources||[],true]] as const){
      const source=inventory.find(s=>s.decisions.some(d=>d.recordId===record.recordId&&d.recordDigest===record.recordDigest&&['draft','accepted'].includes(d.state)));
      const decision=source?.decisions.find(d=>d.recordId===record.recordId&&d.recordDigest===record.recordDigest);
      if(source&&decision)return {source,decision,readOnly};
    }
    return null;
  }
  function learningCaption(record:TrainingChangeRecord){
    return record.summary?savedExample(record)?.decision.decision.desiredBehavior||record.summary:null;
  }
  function learningExample(record:TrainingChangeRecord,index:number){
    if(index>=8)return null;const example=savedExample(record);
    const sha=example?.decision.content.derivatives?.[0]?.sha256;
    return example?.source.token&&sha?<TrainingImage key={`${record.recordId}:${record.recordDigest}`} token={example.source.token} recordId={record.recordId} recordDigest={record.recordDigest} frameSha256={sha} enabled={!busy&&!changesBusy} context={`${session}:${currentVersion}`} alt="Saved teaching example"/>:null;
  }
  const [selected, setSelected] = useState<Source | null>(null);
  const [busy, setBusy] = useState('');
  const [changes,setChanges]=useState<GuidedTrainingChanges|null>(null),[changesError,setChangesError]=useState('');
  const [changesBusy,setChangesBusy]=useState(false),[chatRequest,setChatRequest]=useState<TrainingChatRequest|null>(null);
  const [publicationReviewOpen,setPublicationReviewOpen]=useState(false);
  const changesInFlight=useRef(false),changeIntent=useRef<{fingerprint:string;key:string}|null>(null);
  const changesIdentity=useRef('');changesIdentity.current=`${session}:${currentVersion}`;
  async function loadChanges(signal?:AbortSignal){
    if(!session||!currentVersion||installationId)return;
    const captured=changesIdentity.current;
    try{const response=await fetch(`/api/agent-training/changes?sessionId=${encodeURIComponent(session)}`,{cache:'no-store',signal});
      const value=await response.json();if(signal?.aborted||changesIdentity.current!==captured)return;
      if(!response.ok||!guidedTrainingChanges(value,{sessionId:session,workflowVersionId:currentVersion}))throw Error(value.reason||'training_changes_unavailable');
      setChanges(value);setChangesError('');
    }catch(e){if(!signal?.aborted&&changesIdentity.current===captured){setChanges(null);setChangesError(e instanceof Error?e.message:'training_changes_unavailable');}}
  }
  useEffect(()=>{setChanges(null);setChangesError('');setChatRequest(null);changeIntent.current=null;const controller=new AbortController();void loadChanges(controller.signal);return()=>controller.abort();},[session,currentVersion,installationId]);
  async function mutateChanges(operation:'policy'|'records'|'creation-import'|'withdraw'|'tests/prepare'|'activate'|'publication/prepare'|'publication/publish',body:unknown){
    if(changesInFlight.current||!session||!changes)return;const captured=changesIdentity.current;
    const fingerprint=JSON.stringify({identity:captured,operation,body});
    if(changeIntent.current?.fingerprint!==fingerprint)changeIntent.current={fingerprint,key:crypto.randomUUID()};
    changesInFlight.current=true;setChangesBusy(true);setChangesError('');
    try{const response=await fetch(`/api/agent-training/changes?sessionId=${encodeURIComponent(session)}&operation=${operation}`,{
      method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','Idempotency-Key':changeIntent.current.key},body:JSON.stringify(body)});
      const value=await response.json();if(changesIdentity.current!==captured)return;
      if(!response.ok||value.ok!==true)throw Error(value.reason||'training_change_unconfirmed');
      changeIntent.current=null;await loadChanges();return value;
    }catch(e){if(changesIdentity.current===captured)setChangesError(e instanceof Error?e.message:'training_change_unconfirmed');}
    finally{changesInFlight.current=false;setChangesBusy(false);}
  }
  function requestLearning(target:TrainingChatRequest['target'],prompt:string){
    setChatRequest({key:crypto.randomUUID(),target,prompt});focusChat();
  }
  function editCandidate(record:TrainingChangeRecord){
    if(!record.summary)return;
    if(record.sourceKind==='legacy_evidence'){
      const example=savedExample(record);
      if(example)void reviewDecision(example.source,example.decision,example.readOnly);
      else setChangesError('training_source_review_unavailable');
      return;
    }
    requestLearning({kind:'record',id:record.recordId,digest:record.recordDigest},'Please revise the selected teaching. I would like to change: ');
  }
  async function prepareCandidateTest(snapshotDigest:string,scope:'private_candidate'|'public_projection'='private_candidate',resultSnapshotDigest=snapshotDigest,publicationPreview?:TrainingPublicationPreview){
    if(!changes||snapshotDigest!==changes.binding.snapshotDigest||!currentVersion)return;
    if(scope==='public_projection'&&(!publicationPreview||publicationPreview.snapshotDigest!==resultSnapshotDigest||publicationPreview.candidateSnapshotDigest!==snapshotDigest))return;
    const prepared=await mutateChanges('tests/prepare',{expectedActiveVersionId:currentVersion,expectedSnapshotDigest:snapshotDigest,scope,
      ...(scope==='public_projection'?{publicationPreparationId:publicationPreview!.publicationPreparationId,preparationDigest:publicationPreview!.preparationDigest}:{})});
    if(!prepared)return;
    if(prepared.sessionId!==session||prepared.workflowVersionId!==currentVersion||prepared.snapshotDigest!==resultSnapshotDigest
      ||prepared.scope!==scope||typeof prepared.testPreparationId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(prepared.testPreparationId)
      ||typeof prepared.preparationDigest!=='string'||!/^[a-f0-9]{64}$/.test(prepared.preparationDigest)){
      setChangesError('training_test_preparation_unconfirmed');return;
    }
    router.push(`/workflows/${encodeURIComponent(slug)}?source=generated&trainingPreparationId=${prepared.testPreparationId}&trainingPreparationDigest=${prepared.preparationDigest}`);
  }
  async function activateCandidate(snapshotDigest:string,testRequestId:string){
    if(!changes||!currentVersion||snapshotDigest!==changes.binding.snapshotDigest||!changes.activation?.canActivate||testRequestId!==changes.activation.testRequestId)return;
    const activated=await mutateChanges('activate',{expectedActiveVersionId:currentVersion,expectedSnapshotDigest:snapshotDigest,testRequestId});
    if(activated&&(activated.contractVersion!=='training-snapshot-activation.v1'||typeof activated.activationId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(activated.activationId)
      ||typeof activated.activationDigest!=='string'||!/^[a-f0-9]{64}$/.test(activated.activationDigest)||activated.sessionId!==session||activated.workflowVersionId!==currentVersion
      ||activated.snapshotDigest!==snapshotDigest||activated.testRequestId!==testRequestId)){
      await loadChanges();setChangesError('This update may have applied, but the receipt could not be confirmed. Refresh to check the served training before trying again.');
    }
  }
  async function preparePublication(recordIds:string[]):Promise<TrainingPublicationPreview|null>{
    if(!changes||!currentVersion)return null;
    const selectedRecords=changes.records.filter(r=>recordIds.includes(r.recordId)&&r.included&&r.summary);
    if(selectedRecords.length!==recordIds.length)return null;
    const captured={sessionId:session,workflowVersionId:currentVersion,snapshotDigest:changes.binding.snapshotDigest,records:selectedRecords};
    const result=await mutateChanges('publication/prepare',{expectedActiveVersionId:currentVersion,expectedSnapshotDigest:captured.snapshotDigest,recordIds});
    if(!result)return null;
    if(!trainingPublicationPreview(result,captured)){setChangesError('training_publication_preview_unconfirmed');return null;}
    return result;
  }
  async function publishPreparedSnapshot(preview:TrainingPublicationPreview){
    if(!changes||!currentVersion||preview.candidateSnapshotDigest!==changes.binding.snapshotDigest||preview.sessionId!==session
      ||preview.workflowVersionId!==currentVersion||!preview.canPublish||!preview.qualifyingTestRequestId)return false;
    const result=await mutateChanges('publication/publish',{expectedActiveVersionId:currentVersion,publicationPreparationId:preview.publicationPreparationId,
      preparationDigest:preview.preparationDigest,testRequestId:preview.qualifyingTestRequestId,releaseConsent:true});
    if(!result)return false;
    if(result.published!==true||result.contractVersion!=='training-snapshot-publication.v1'||result.workflowVersionId!==currentVersion||result.snapshotDigest!==preview.snapshotDigest
      ||result.publicationPreparationId!==preview.publicationPreparationId||result.preparationDigest!==preview.preparationDigest||result.qualifyingTestRequestId!==preview.qualifyingTestRequestId
      ||typeof result.publishedSnapshotDigest!=='string'||!/^[a-f0-9]{64}$/.test(result.publishedSnapshotDigest)){setChangesError('training_publication_unconfirmed');return false;}
    return true;
  }
  async function reviewPublicationExample(recordId:string){
    const record=changes?.records.find(r=>r.recordId===recordId),example=record?savedExample(record):null;
    if(!example){setChangesError('training_publication_source_review_unavailable');return;}
    setPublicationReviewOpen(false);await reviewDecision(example.source,example.decision,example.readOnly);
  }
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [directSource,setDirectSource]=useState(false),[uploadOpen,setUploadOpen]=useState(false),[discardDraftConfirmed,setDiscardDraftConfirmed]=useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState<ReviewedDecision | null>(null);
  const reviewedIsVisible=!!reviewed&&(!reviewed.readOnly||changes?.records.some(r=>r.recordId===reviewed.decision.recordId&&r.recordDigest===reviewed.decision.recordDigest&&r.summary&&!['revoked','unavailable','discarded','retired'].includes(r.state)));
  useEffect(()=>{if(reviewed?.readOnly&&!reviewedIsVisible)setReviewed(null);},[reviewed,reviewedIsVisible]);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const [acceptConfirmed, setAcceptConfirmed] = useState(false);
  const [retireConfirmed, setRetireConfirmed] = useState(false);
  const [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const [serverConsent, setServerConsent] = useState(false);
  const [serverWithdrawal, setServerWithdrawal] = useState(false);
  const [serverStorage, setServerStorage] = useState<TrainingEvidenceStorage | null | undefined>(undefined);
  const [serverStorageNote, setServerStorageNote] = useState('');
  const [serverStorageSupported, setServerStorageSupported] = useState(false);
  useEffect(()=>{setServerStorageSupported(bridge()?.trainingEvidenceStorageContractVersion==='1');},[]);
  useEffect(()=>{setServerConsent(false);setServerWithdrawal(false);setServerStorage(undefined);setServerStorageNote('');},[reviewed?.decision.recordId]);
  const pendingDelivery = useRef<{ sessionId: string; recordId: string; digest: string; mode: DeliveryMode; key: string } | null>(null);
  const [time, setTime] = useState(0);
  const [relation, setRelation] = useState<TrainingRelation>(installationId?'rejected':'accepted');
  const [property, setProperty] = useState<TrainingPropertyCode>(installationId?'information_hierarchy':'motion_rhythm');
  const [stages, setStages] = useState<TrainingStage[]>(() => deriveTrainingStages(installationId?'information_hierarchy':'motion_rhythm')
    .filter(stage=>!installationId||['planning','build'].includes(stage)));
  const [managerCoverage, setManagerCoverage] = useState<ManagerTrainingCoverage | null>(null);
  const [managerTrainingRequirements, setManagerTrainingRequirements] = useState<ManagerTrainingRequirements | null>(null);
  const [successorStageExpansion, setSuccessorStageExpansion] = useState<{ required: TrainingStage[]; missing: TrainingStage[] } | null>(null);
  const [chosen, setChosen] = useState('');
  const [why, setWhy] = useState('');
  const [process, setProcess] = useState('');
  const [behavior, setBehavior] = useState('');
  const [wordingOpened,setWordingOpened]=useState(false);
  useEffect(()=>setWordingOpened(false),[selected?.sourceId]);
  useEffect(()=>{if([chosen,why,process,behavior].every(value=>value.trim()))setWordingOpened(true);},[selected?.sourceId,chosen,why,process,behavior]);
  const [selectionPriority, setSelectionPriority] = useState('50');
  const priorityIsValid = /^\d{1,3}$/.test(selectionPriority) && Number(selectionPriority) <= 100;
  const [pending, setPending] = useState<LocalDraft[]>([]);
  const [failed, setFailed] = useState<LocalDraft[]>([]);
  const [sessionKey] = useState(() => crypto.randomUUID());
  const [successorSessionKey] = useState(() => crypto.randomUUID());
  const [decisionKey, setDecisionKey] = useState(() => crypto.randomUUID());
  const [questions, setQuestions] = useState<QuestionsPage | null>(null);
  const [questionsBusy, setQuestionsBusy] = useState(false);
  const [questionsError, setQuestionsError] = useState('');
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [rawAnswer, setRawAnswer] = useState('');
  const [questionAnswer, setQuestionAnswer] = useState<QuestionAnswer | null>(null);
  const [linkRecordId, setLinkRecordId] = useState('');
  const [pendingAnswerLinks, setPendingAnswerLinks] = useState<{ answer: QuestionAnswer; sessionId: string; recordId: string; recordDigest: string } | null>(null);
  const [demoText, setDemoText] = useState('');
  const [demoAnnotation, setDemoAnnotation] = useState<{ value: DemoAnnotation; previewIdentity: string } | null>(null);
  const pendingDemoSave = useRef<{ fingerprint: string; key: string } | null>(null);
  const [pendingDemoLink, setPendingDemoLink] = useState<{ annotation: DemoAnnotation; sessionId: string; recordId: string; recordDigest: string } | null>(null);
  const [recordingConsent,setRecordingConsent] = useState(false);
  const [agentAnalysisConsent,setAgentAnalysisConsent] = useState(false);
  const [agentProposal,setAgentProposal] = useState<RecordingAgentSuggestion|null>(null);
  const [agentChangeConfirmed,setAgentChangeConfirmed] = useState(false);
  const [agentChange,setAgentChange] = useState<{requestId:string;status:string;sourceLinkRecorded?:boolean;warning?:string}|null>(null);
  const [method,setMethod] = useState<{id:string;slug:string;name:string;content:string;contentDigest:string;status:string;scope:string;model:string|null}|null>(null);
  const [recordingSupported,setRecordingSupported] = useState(false);
  useEffect(()=>{setRecordingSupported(bridge()?.trainingRecordingContractVersion==='1');},[]);
  const [recording,setRecording] = useState<{excerptId:string;excerptDigest:string;excerpt:RecordingExcerpt;frames:RecordingFrame[];suggestion:RecordingSuggestion|null;purpose?:'taste'|'agent'}|null>(null);
  const [pendingRecordingLink,setPendingRecordingLink] = useState<{body:Record<string,unknown>;sessionId:string;key:string}|null>(null);
  useEffect(()=>{setRecording(null);setRecordingConsent(false);},[selected?.sourceId,session,currentVersion]);
  useEffect(()=>{setAgentProposal(null);setAgentChangeConfirmed(false);setAgentAnalysisConsent(false);setAgentChange(null);setMethod(null);},[selected?.sourceId,session,currentVersion]);
  const [draftConsent, setDraftConsent] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<{ value: TeachingSuggestion; snapshot: string } | null>(null);
  const [suggestionNote, setSuggestionNote] = useState('');
  const appliedSuggestion = useRef<TeachingSuggestion | null>(null);
  const previewIdentity = useMemo(() => crypto.randomUUID(), [preview]);
  const draftSnapshot = JSON.stringify({ session, sessionVersion, currentVersion, versionChanged, token: selected?.token, sourceId: selected?.sourceId,
    time, previewIdentity, property, stages, relation, chosen, why, process, behavior, answer: questionAnswer, demoText, demoAnnotation });
  const latestDraft = useRef(draftSnapshot); latestDraft.current = draftSnapshot;
  useEffect(() => { setDraftConsent(false); }, [preview?.image, selected?.sourceId, time, questionAnswer, demoText, demoAnnotation, session, currentVersion]);
  const previewIsCurrent = useMemo(() => previewMatches(preview, selected?.token, time), [preview, selected, time]);
  const demoAnnotationIsCurrent = Boolean(demoAnnotation && demoAnnotation.previewIdentity === previewIdentity && previewIsCurrent
    && demoAnnotation.value.sourceId === selected?.sourceId && demoAnnotation.value.sourceSha256 === selected?.metadata.sha256
    && demoAnnotation.value.timeMs === time && demoAnnotation.value.expectedActiveVersionId === currentVersion
    && demoAnnotation.value.rawAnnotation === demoText);
  const acceptedEvidenceCount = useMemo(() => sources.reduce((count, source) => count + source.decisions.filter((decision) => decision.state === 'accepted').length, 0), [sources]);
  const coverageIsCurrent = Boolean(isManagerTrainingCoverage(managerCoverage, sessionVersion)
    && managerCoverage
    && managerCoverage.listedSessionAcceptedRecordCount === acceptedEvidenceCount
    && managerCoverage.acceptedLocalRecordCount >= managerCoverage.listedSessionAcceptedRecordCount,
  );
  const coverageCanClaimReady = Boolean(
    coverageIsCurrent
    && managerCoverage?.readiness === 'ready'
    && managerCoverage.classified
    && (managerCoverage.contractVersion === 'manager-training-coverage.v2'
      || (managerCoverage.uncoveredPairs.length === 0
        && managerCoverage.acceptedPairs.every((pair) => managerCoverage.coveredPairs.some((covered) => coveragePairKey(covered) === coveragePairKey(pair))))),
  );
  const coverageNeedsUpdate = Boolean(coverageIsCurrent && managerCoverage?.readiness === 'agent_update_required' && managerCoverage.reason);
  const requirementsAreCurrent = isManagerTrainingRequirements(managerTrainingRequirements, sessionVersion || currentVersion);
  const activeRequirementsAreCurrent = isManagerTrainingRequirements(managerTrainingRequirements, currentVersion);
  const activeVersionTrainingIsReady = Boolean(versionChanged && activeRequirementsAreCurrent && managerTrainingRequirements
    && (managerTrainingRequirements.readiness === 'reference_training_ready' || managerTrainingRequirements.readiness === 'not_applicable'));
  const trainingIsReady = Boolean(!versionChanged && requirementsAreCurrent && managerTrainingRequirements
    && (managerTrainingRequirements.readiness === 'reference_training_ready' || managerTrainingRequirements.readiness === 'not_applicable'));
  const trainingNeedsCoach = Boolean(!versionChanged && requirementsAreCurrent && managerTrainingRequirements?.readiness === 'coach_reference_training_required');
  // Progressive disclosure must never hide a warning that training is ineffective
  // or a preserved operation still needs the owner. These use the original facts.
  const readinessNeedsAttention=Boolean((currentVersion&&!requirementsAreCurrent&&!activeVersionTrainingIsReady)||trainingNeedsCoach||coverageNeedsUpdate
    ||((acceptedEvidenceCount>0||(managerCoverage?.acceptedLocalRecordCount||0)>0)&&!coverageCanClaimReady&&!coverageNeedsUpdate));
  const preservedWorkCount=failed.length+pending.length+Number(!!pendingAnswerLinks)+Number(!!pendingDemoLink)+Number(!!pendingRecordingLink);
  const trainingNeedsAttention=readinessNeedsAttention||preservedWorkCount>0;

  async function call(operation: string, args: unknown) {
    if(installationId&&['scope','create'].includes(operation)){
      const values=args as {sessionId?:string;key?:string;expectedVersionId?:string};
      const write=operation==='create';
      const query=new URLSearchParams({installationId,...(!write&&values.sessionId?{sessionId:values.sessionId}:{})});
      const response=await fetch(`/api/agent-training/installation-preferences?${query}`,{method:write?'POST':'GET',cache:'no-store',
        ...(write?{headers:{'Content-Type':'application/json','Idempotency-Key':values.key||''},body:JSON.stringify({expectedVersionId:values.expectedVersionId})}:{})});
      const result=await response.json();
      if(!response.ok||result.ok!==true||result.scope?.installationId!==installationId||result.scope?.agent?.slug!==slug)
        throw new TrainingError(result.reason||'installation_preference_unavailable','This installed agent is unavailable for private preferences.');
      return result as Result;
    }
    const result = await resolveBridge().trainingLocal(operation, args);
    if (!result.ok) throw new TrainingError(result.reason || 'training_unavailable', result.reason==='recording_annotation_too_large'?'These saved notes exceed the existing annotation limit. Shorten or split the moment deliberately; all original notes remain in your recording.':result.reason || 'Training is unavailable. Your draft is preserved.');
    return result;
  }

  async function work(label: string, fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label); setError('');
    try { await fn(); }
    catch (caught) {
      if (!(caught instanceof TrainingError && caught.reason === 'selection_cancelled')) setError(caught instanceof Error ? caught.message : 'Training is unavailable.');
    } finally { busyRef.current = false; setBusy(''); }
  }

  async function changePublication(publish=false,makePrivate=false) {
    if(publish&&(!publishConfirmed||!publication||publication.versionId!==currentVersion))return;
    if(makePrivate&&(!publication||publication.versionId!==currentVersion))return;
    const write=publish||makePrivate;
    await work(publish?'Publishing the agent definition':makePrivate?'Making the agent private':'Checking public visibility',async()=>{
      const response=await fetch(`/api/agent-training/publication?slug=${encodeURIComponent(slug)}`,{
        method:write?'POST':'GET',cache:'no-store',...(write?{headers:{'Content-Type':'application/json'},
          body:JSON.stringify(makePrivate?{expectedVersionId:publication!.versionId,makePrivate:true}:{expectedVersionId:publication!.versionId,definitionOnlyConfirmed:true})}:{})});
      const result=await response.json();
      if(!response.ok||result.ok!==true)throw new Error(result.error||reasonLabel(result.reason||'agent_publication_unavailable'));
      if(write){setPublication(prior=>prior?{...prior,shared:publish}:prior);setPublishConfirmed(false);return;}
      const p=result.publication;
      if(!p||p.versionId!==currentVersion||typeof p.shared!=='boolean'||typeof p.publicUrl!=='string'
        ||!p.publicUrl.startsWith('https://'))throw new Error('Publication status does not match the current agent version.');
      setPublication({versionId:p.versionId,shared:p.shared,publicUrl:p.publicUrl});setPublishConfirmed(false);
    });
  }

  function rememberList(result: Result) {
    const next = result.sources || [];
    setSources(next);
    setSelected((prior) => prior ? next.find((source) => source.sourceId === prior.sourceId) || null : null);
    setFailed(result.failedDrafts || []);
    setPending(result.pendingDecisions || []);
    setManagerCoverage(result.managerCoverage || null);
    setManagerTrainingRequirements(result.managerTrainingRequirements || null);
  }

  async function load(id: string) {
    const result = await call('list', { sessionId: id });
    rememberList(result);
    return result;
  }

  async function loadQuestions(cursor: QuestionsPage['nextCursor'] = null) {
    setQuestionsBusy(true); setQuestionsError('');
    try {
      const query = new URLSearchParams({ slug, limit: '20', ...(cursor ? { afterCreatedAt: cursor.createdAt, afterId: cursor.id } : {}) });
      const response = await fetch(`/api/agent-training/questions?${query}`, { cache: 'no-store' });
      const page: unknown = await response.json();
      if (!response.ok || !questionsPage(page)) throw new Error('Recorded questions are unavailable. This does not mean no questions were asked.');
      if (cursor && questions && (page.agentFamilyId !== questions.agentFamilyId || page.activeVersionId !== questions.activeVersionId)) throw new Error('The agent changed while loading questions. Refresh recorded questions before continuing.');
      setQuestions({ ...page, items: cursor && questions ? [...new Map([...questions.items, ...page.items].map(q => [q.id, q])).values()] : page.items });
    } catch (caught) { setQuestionsError(caught instanceof Error ? caught.message : 'Recorded questions are unavailable.'); }
    finally { setQuestionsBusy(false); }
  }

  function prepareQuestionAnswer() {
    const selectedQuestions = questions?.items.filter(q => questionIds.includes(q.id)) || [];
    if (!selectedQuestions.length || !rawAnswer.trim() || !questions?.activeVersionId) return;
    if (new Set(selectedQuestions.map(q => q.property)).size !== 1) { setQuestionsError('Choose questions about one visual property for one teaching.'); return; }
    if (currentVersion !== questions.activeVersionId || (session && sessionVersion !== currentVersion)) { setQuestionsError('Start or select a training session for the active version, then prepare this answer.'); return; }
    setQuestionAnswer({ questions: selectedQuestions, rawAnswer, expectedActiveVersionId: questions.activeVersionId });
    setSelected(null); setPreview(null); setReviewed(null); setLinkRecordId('');
    setProperty(selectedQuestions[0].property); setStages(normalizeTrainingStages(selectedQuestions.map(q => q.stage))); setRelation('accepted');
    setChosen(''); setWhy(''); setProcess(''); setBehavior(''); setSuggested(null); appliedSuggestion.current = null;
    setDraftConsent(false); setSuggestionNote('Your full answer is preserved below. Choose a frame, then draft the four fields manually or request an optional suggestion.');
    setDemoText(''); setDemoAnnotation(null);
    setDecisionKey(crypto.randomUUID()); setQuestionsError('');
  }

  async function linkAnswers(pending: NonNullable<typeof pendingAnswerLinks>) {
    let remaining = pending.answer.questions;
    setPendingAnswerLinks(pending);
    for (const q of pending.answer.questions) {
      const body = { questionReceiptId: q.id, questionReceiptDigest: q.receiptDigest, recordId: pending.recordId,
        expectedRecordDigest: pending.recordDigest, rawAnswer: pending.answer.rawAnswer, expectedActiveVersionId: pending.answer.expectedActiveVersionId };
      const response = await fetch(`/api/agent-training/questions?sessionId=${encodeURIComponent(pending.sessionId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `question-answer:${q.id}:${pending.recordId}` }, body: JSON.stringify(body), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !answerReceipt(result, body)) throw new TrainingError('question_answer_link_unavailable', 'The evidence draft is preserved, but its answer link could not be verified. Retry linking; do not create the draft again.');
      remaining = remaining.slice(1);
      setPendingAnswerLinks(remaining.length ? { ...pending, answer: { ...pending.answer, questions: remaining } } : null);
    }
    setQuestionAnswer(null); setRawAnswer(''); setQuestionIds([]); await loadQuestions();
  }

  async function linkExistingTeaching() {
    if (!questionAnswer || !linkRecordId || !session || sessionVersion !== questionAnswer.expectedActiveVersionId) return;
    const record = sources.flatMap(source => source.decisions).find(d => d.recordId === linkRecordId && ['draft', 'accepted'].includes(d.state));
    if (!record) return;
    await work('Linking the answer to the existing teaching', () => linkAnswers({ answer: questionAnswer, sessionId: session, recordId: record.recordId, recordDigest: record.recordDigest }));
  }

  function acceptedCount(result: Result) {
    return (result.sources || []).reduce((count, source) => count + source.decisions.filter((decision) => decision.state === 'accepted').length, 0);
  }

  function rememberScope(scope: Scope) {
    setAgentName(scope.agent.name || slug); setCurrentVersion(scope.agent.currentVersionId);
    if (scope.session) setSessionVersion(scope.session.baseVersionId);
  }

  async function requireCurrentScope(id = session) {
    const result = await call('scope', { slug, ...(id ? { sessionId: id } : {}) });
    if (!result.scope?.agent.currentVersionId) throw new TrainingError('no_immutable_version', 'Activate an immutable agent version before adding training evidence.');
    rememberScope(result.scope);
    if (id) {
      if (!result.scope.session || result.scope.session.sessionId !== id || result.scope.session.terminal) throw new TrainingError('training_session_unavailable', 'This training session is no longer open. Start a new session.');
      if (result.scope.session.baseVersionId !== result.scope.agent.currentVersionId) {
        setVersionChanged(true);
        throw new TrainingError('training_version_changed', 'The active agent version changed. Start a new training session so evidence is not attached to an older version.');
      }
    }
    setVersionChanged(false);
    return result.scope;
  }

  useEffect(() => {
    let live = true;
    void work('Loading training evidence', async () => {
      if(installationId){
        const result=await call('scope',{slug});
        if(!live||!result.scope)return;
        rememberScope(result.scope);
        if(result.scope.session){setSession(result.scope.session.sessionId);await load(result.scope.session.sessionId);}
        return;
      }
      const result = await call('home', { slug });
      if (!live || !result.home) return;
      const home = result.home;
      setRecentSessions(home.recentSessions);
      if (!isTrainingSuccessorProjection(home.successorProjection, home.agent.currentVersionId)) {
        throw new TrainingError('training_successor_projection_unavailable', 'Update Implexa Desktop before training. The version-transition evidence projection could not be verified.');
      }
      const projection = home.successorProjection;
      if (projection.activeVersionId) {
        if (!isManagerTrainingRequirements(home.managerTrainingRequirements, projection.activeVersionId)) {
          throw new TrainingError('manager_training_requirements_unavailable', 'Implexa cannot verify the active version’s required visual-reference training coverage. Reload after the backend and Dashboard are updated.');
        }
        setManagerTrainingRequirements(home.managerTrainingRequirements);
      } else setManagerTrainingRequirements(null);
      setAgentName(home.agent.name || slug); setCurrentVersion(projection.activeVersionId);
      const predecessor = projection.eligiblePredecessor;
      const open = home.recentSessions.filter((item) => item.sourceMode === 'raw_input' && !item.terminal);
      let active: { item: Home['recentSessions'][number]; scope: Scope } | null = null;
      for (const item of open.filter((candidate) => candidate.agent.baseVersionId === projection.activeVersionId)) {
        const scoped = await call('scope', { slug, sessionId: item.sessionId });
        if (!live || !scoped.scope?.session || scoped.scope.session.sessionId !== item.sessionId
          || scoped.scope.session.terminal || scoped.scope.session.baseVersionId !== scoped.scope.agent.currentVersionId) continue;
        if (!predecessor || scoped.scope.session.parentSessionId === predecessor.sessionId) { active = { item, scope: scoped.scope }; break; }
      }
      if (active) {
        setSession(active.item.sessionId); rememberScope(active.scope); await load(active.item.sessionId);
        if (predecessor) {
          const scoped = await call('scope', { slug, sessionId: predecessor.sessionId });
          if (!live || !scoped.scope?.session || scoped.scope.session.sessionId !== predecessor.sessionId
            || scoped.scope.session.baseVersionId !== predecessor.baseVersionId
            || scoped.scope.agent.currentVersionId !== projection.activeVersionId) throw new TrainingError('training_successor_projection_unavailable');
          const prior = await call('list', { sessionId: predecessor.sessionId });
          if (acceptedCount(prior) !== predecessor.acceptedLocalRecordCount) throw new TrainingError('training_successor_projection_unavailable');
          if (live) {
            setVersionTransition({ fromVersion: predecessor.baseVersionId, sources: prior.sources || [] });
          }
        }
      } else if (predecessor) {
        const scoped = await call('scope', { slug, sessionId: predecessor.sessionId });
        if (!live || !scoped.scope?.session || scoped.scope.session.sessionId !== predecessor.sessionId
          || scoped.scope.session.baseVersionId !== predecessor.baseVersionId
          || scoped.scope.agent.currentVersionId !== projection.activeVersionId) throw new TrainingError('training_successor_projection_unavailable');
        const prior = await call('list', { sessionId: predecessor.sessionId });
        if (acceptedCount(prior) !== predecessor.acceptedLocalRecordCount) throw new TrainingError('training_successor_projection_unavailable');
        setSession(predecessor.sessionId); rememberScope(scoped.scope); rememberList(prior); setVersionChanged(true);
      } else if (open.length) {
        for (const item of open.filter((candidate) => candidate.agent.baseVersionId === projection.activeVersionId)) {
          const scoped = await call('scope', { slug, sessionId: item.sessionId });
          if (!live || !scoped.scope?.session || scoped.scope.session.sessionId !== item.sessionId
            || scoped.scope.session.terminal || scoped.scope.session.baseVersionId !== scoped.scope.agent.currentVersionId) continue;
          setSession(item.sessionId); rememberScope(scoped.scope); await load(item.sessionId); break;
        }
      }
    });
    return () => { live = false; };
    // The slug is the route identity. A new slug remounts the authoritative scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug,installationId]);

  useEffect(() => { if (reviewed) reviewHeadingRef.current?.focus(); }, [reviewed]);
  useEffect(()=>{if(!installationId&&view==='teach')document.getElementById(directSource?'recording-analysis':'training-demonstration')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});},[view,installationId,directSource]);

  async function startPrivateTraining(){
    if(session||installationId||versionChanged)return;
    await work('Opening private Training',async()=>{
      const before=await requireCurrentScope('');
      if(!currentVersion||before.agent.currentVersionId!==currentVersion)throw new TrainingError('training_version_changed');
      const created=await call('create',{slug,key:sessionKey});
      if(!created.sessionId)throw new TrainingError('training_session_unavailable');
      const after=await requireCurrentScope(created.sessionId);
      if(after.agent.currentVersionId!==currentVersion||after.session?.baseVersionId!==currentVersion)throw new TrainingError('training_version_changed');
      setSession(created.sessionId);rememberScope(after);await load(created.sessionId);
      focusChat();
    });
  }

  async function add(directUpload=false) {
    if(!consent)return;
    await work('Verifying the selected source and saving its identity', async () => {
      let id = session;
      if (!id) {
        const before = await requireCurrentScope('');
        const created = await call('create', { slug, key: sessionKey,...(installationId?{expectedVersionId:before.agent.currentVersionId}:{}) });
        if (!created.sessionId) throw new TrainingError('training_session_unavailable');
        id = created.sessionId; setSession(id);
        const after = await requireCurrentScope(id);
        if (after.agent.currentVersionId !== before.agent.currentVersionId) throw new TrainingError('training_version_changed');
      } else await requireCurrentScope(id);
      const consents={localCustody:true,boundedEvidence:true,futureSelection:true};
      if(recordingSelection&&!directUpload){
        if(bridge()?.trainingRecordingLibraryContractVersion!=='1'||!ownerId)throw new TrainingError('training_desktop_update_required','Update Desktop to use this saved recording.');
        const result=await call('selectRecording',{sessionId:id,...recordingSelection,expectedOwnerId:ownerId,consent:consents}) as Result & {sourceId:string;token:string;recordingDraft:{recordingId:string;momentId:string|null;timeMs:number;rawAnnotation:string}};
        const note=result.recordingDraft;
        if(!note||note.recordingId!==recordingSelection.recordingId||note.momentId!==recordingSelection.momentId
          || !Number.isSafeInteger(note.timeMs)||note.timeMs<0||typeof note.rawAnnotation!=='string'||note.rawAnnotation.length>2000)
          throw new TrainingError('training_source_scope_mismatch','The saved recording handoff could not be verified.');
        await requireCurrentScope(id);const listed=await load(id);
        const source=listed.sources?.find(value=>value.sourceId===result.sourceId&&value.token===result.token);
        if(!source)throw new TrainingError('training_source_scope_mismatch');
        chooseSource(source);setTime(note.timeMs);setDemoText(note.rawAnnotation);
        setSuggestionNote('Saved moment notes are preserved verbatim as draft annotation. Preview this exact frame, save its annotation, then review and accept any teaching separately.');
      }else{
        const added=await call('select',{sessionId:id,consent:consents});
        await requireCurrentScope(id);const listed=await load(id);
        const source=listed.sources?.find(s=>s.sourceId===added.sourceId&&s.token===added.token);
        if(!source)throw new TrainingError('training_source_scope_mismatch','The source is saved but could not be opened for annotation. Find it in Saved sources & original decisions.');
        if(!chooseSource(source,directUpload&&discardDraftConfirmed))return;
        if(directUpload&&source.token){
          setDirectSource(true);setConsent(false);
          const frame=await call('preview',{token:source.token,timeMs:0});
          if(frame.image)setPreview({token:source.token,timeMs:0,image:frame.image});
        }
      }
      setConsent(false);
    });
    setConsent(false);
  }

  function chooseSource(source: Source,allowDiscard=false) {
    if(selected&&selected.sourceId!==source.sourceId&&[demoText,chosen,why,process,behavior].some(s=>s.trim())&&!allowDiscard){setError('Save or discard your current annotation before choosing another source.');return false;}
    showTeaching();
    setSelected(source); setTime(0); setPreview(null); setReviewed(null); setSuccessorStageExpansion(null); setDecisionKey(crypto.randomUUID());
    setSelectionPriority('50');return true;
  }
  function toggleStage(stage: TrainingStage) {
    setStages((current) => {
      const next = current.includes(stage) ? current.filter((item) => item !== stage) : [...current, stage];
      setSuccessorStageExpansion((expansion) => expansion
        ? { ...expansion, missing: expansion.required.filter((required) => !next.includes(required)) } : null);
      return next;
    });
    setDecisionKey(crypto.randomUUID());
  }
  function createPlanningSuccessor(source: Source, decision: Decision) {
    showTeaching();
    const nextProperty = decision.content.properties[0] || 'motion_rhythm';
    setSelected(source); setTime(decision.content.anchor.startMs); setPreview(null); setReviewed(null);
    setRelation(decision.content.relation); setProperty(nextProperty);
    setChosen(decision.decision.chosen); setWhy(decision.decision.why); setProcess(decision.decision.process); setBehavior(decision.decision.desiredBehavior);
    setSelectionPriority(String(decision.content.applicability?.priority ?? 50));
    setStages(deriveTrainingStages(nextProperty)); setDecisionKey(crypto.randomUUID());
  }
  async function beginVersionSuccessor() {
    if (!versionChanged || !transitionConfirmed || !currentVersion || !sessionVersion) return;
    const predecessor = { fromVersion: sessionVersion, sources };
    await work('Starting a successor training session for the active version', async () => {
      const active = await call('scope', { slug });
      if (!active.scope?.agent.currentVersionId || active.scope.agent.currentVersionId !== currentVersion) throw new TrainingError('training_version_changed', 'The active version changed again. Reload before starting the successor session.');
      const predecessorSessionId = session;
      const created = await call('create', { slug, key: successorSessionKey, parentSessionId: predecessorSessionId });
      if (!created.sessionId || created.parentSessionId !== predecessorSessionId || created.baseVersionId !== active.scope.agent.currentVersionId) {
        throw new TrainingError('training_successor_lineage_unavailable', 'Implexa could not prove the successor session is linked to this exact prior training session. No evidence was copied.');
      }
      const scoped = await call('scope', { slug, sessionId: created.sessionId });
      if (!scoped.scope?.session || scoped.scope.session.sessionId !== created.sessionId || scoped.scope.session.terminal
        || scoped.scope.session.baseVersionId !== active.scope.agent.currentVersionId) throw new TrainingError('training_version_changed', 'The successor session was not bound to the active immutable version.');
      setVersionTransition(predecessor); setSession(created.sessionId); rememberScope(scoped.scope);
      setSources([]); setSelected(null); setPreview(null); setReviewed(null); setManagerCoverage(null); setPending([]); setFailed([]); setSuccessorStageExpansion(null);
      setConsent(false); setTransitionConfirmed(false); setVersionChanged(false);
      await load(created.sessionId);
    });
  }
  function prepareVersionSuccessor(source: Source, decision: Decision) {
    showTeaching();
    const nextProperty = decision.content.properties[0] || 'motion_rhythm';
    setSelected(source); setTime(decision.content.anchor.startMs); setPreview(null); setReviewed(null);
    setRelation(decision.content.relation); setProperty(nextProperty);
    setChosen(decision.decision.chosen); setWhy(decision.decision.why); setProcess(decision.decision.process); setBehavior(decision.decision.desiredBehavior);
    setSelectionPriority(String(decision.content.applicability?.priority ?? 50));
    const preserved = normalizeTrainingStages(decision.content.applicability?.stages);
    const required = requiredStagesForDecision(managerTrainingRequirements, nextProperty, decision.content.relation);
    setStages(preserved);
    setSuccessorStageExpansion({ required, missing: required.filter((stage) => !preserved.includes(stage)) });
    setDecisionKey(crypto.randomUUID());
  }
  function changeTime(next: number) {
    if (!selected || !Number.isFinite(next)) return;
    setTime(Math.min(Math.max(0, Math.round(next)), Math.max(0, selected.metadata.durationMs - 1)));
    setPreview(null); setDecisionKey(crypto.randomUUID());
  }
  function addRequiredSuccessorStages() {
    if (!successorStageExpansion?.missing.length) return;
    setStages(normalizeTrainingStages([...stages, ...successorStageExpansion.missing]));
    setSuccessorStageExpansion({ ...successorStageExpansion, missing: [] });
    setDecisionKey(crypto.randomUUID());
  }

  async function showPreview() {
    if (!selected?.token) return;
    const source = selected; const requestedTime = time;
    await work('Verifying and extracting this frame', async () => {
      await requireCurrentScope();
      const result = await call('preview', { token: source.token, timeMs: requestedTime });
      setPreview({ token: source.token!, timeMs: requestedTime, image: result.image || '' });
    });
  }

  async function requestRecordingDraft(prepared:NonNullable<typeof recording>,snapshot:string,agent=prepared.purpose==='agent') {
    const source=selected;
    if(!source || !currentVersion || latestDraft.current!==snapshot) throw Error('The source or draft changed. No recording suggestion was requested.');
    const binding={sourceId:source.sourceId,sourceSha256:source.metadata.sha256,targetVersionId:currentVersion,
      excerptId:prepared.excerptId,excerptDigest:prepared.excerptDigest,frames:prepared.frames.map(({timeMs,frameSha256})=>({timeMs,frameSha256}))};
    const response=await fetch(`/api/agent-training/teaching-suggestion?sessionId=${encodeURIComponent(session)}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mode:agent?'recording-agent-draft':'recording-draft',sourceId:source.sourceId,sourceSha256:source.metadata.sha256,expectedActiveVersionId:currentVersion,
        excerptId:prepared.excerptId,excerptDigest:prepared.excerptDigest,frames:prepared.frames,consent:true})});
    const value=await response.json();
    if(latestDraft.current!==snapshot) throw Error('The source or draft changed. The previous recording suggestion was not applied.');
    if(response.ok && value?.ok===true && value.status==='insufficient' && typeof value.reason==='string' && value.reason.length<=300) {
      setSuggestionNote(value.reason);return;
    }
    if(agent){
      if(!response.ok||!recordingAgentSuggestion(value,binding))throw Error(teachingFailure(value,response.status));
      setRecording(prepared);setAgentProposal(value);setAgentChangeConfirmed(false);setAgentChange(null);
      setSuggestionNote('Capability suggestion only. Review it separately from private taste training. No agent version or operating method has been changed.');return;
    }
    if(!response.ok || !recordingSuggestion(value,binding))throw Error(teachingFailure(value,response.status));
    const selectedFrame=prepared.frames[value.frameIndex];
    setRecording({...prepared,suggestion:value});setTime(selectedFrame.timeMs);setPreview({token:source.token!,timeMs:selectedFrame.timeMs,image:selectedFrame.image});
    setSuggested(null);appliedSuggestion.current=null;setDemoText('');setDemoAnnotation(null);setQuestionAnswer(null);
    setSuggestionNote('Review the recognized narration and all three frames. The marked frame is the model’s choice. Nothing has been saved as a teaching or admitted.');
  }
  async function findRecordingTeaching(agent=false) {
    if(!selected?.token || !currentVersion || !(agent?agentAnalysisConsent:recordingConsent) || !recordingSupported)return;
    const source=selected,version=currentVersion,snapshot=draftSnapshot;
    await work(agent?'Finding a demonstrated tool or method':'Transcribing recording and locating one taste example',async()=>{
      await requireCurrentScope();
      if(latestDraft.current!==snapshot)throw Error('The draft changed. Start again from the selected recording.');
      const local=await resolveBridge().trainingLocal('recording',{token:source.token}) as Result & {manifest:any;segments:any[];storyboard:RecordingFrame[];manifestId:string;manifestDigest:string};
      if(!local.ok)throw Error(local.reason||'Recording analysis unavailable.');
      if(latestDraft.current!==snapshot)throw Error('The draft changed. No narration was sent to the model.');
      if(local.manifest?.sourceId!==source.sourceId || local.manifest.sourceSha256!==source.metadata.sha256 || local.manifest.targetVersionId!==version)throw Error('The recording scope changed.');
      const response=await fetch(`/api/agent-training/teaching-suggestion?sessionId=${encodeURIComponent(session)}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:agent?'recording-agent-locate':'recording-locate',
        sourceId:source.sourceId,sourceSha256:source.metadata.sha256,expectedActiveVersionId:version,manifestId:local.manifestId,manifestDigest:local.manifestDigest,
        segments:local.segments,storyboard:local.storyboard,consent:true})});
      const value=await response.json();
      if(latestDraft.current!==snapshot)throw Error('The draft changed. The located excerpt was not applied.');
      if(response.ok && value?.ok===true && value.status==='insufficient' && typeof value.reason==='string' && value.reason.length<=300){setSuggestionNote(value.reason);return;}
      if(!response.ok || value?.ok!==true || value.status!=='located' || typeof value.excerptId!=='string' || !/^[a-f0-9]{64}$/.test(value.excerptDigest||''))throw Error(teachingFailure(value,response.status));
      const e=value.excerpt as RecordingExcerpt,segments=local.segments.slice(e.startIndex,e.endIndex+1);
      if(e.sourceId!==source.sourceId || e.sourceSha256!==source.metadata.sha256 || e.targetVersionId!==version
        || !Number.isInteger(e.startIndex)||!Number.isInteger(e.endIndex)||e.startIndex<0||e.endIndex<e.startIndex||!segments.length||segments.length>48
        || !Array.isArray(e.segments) || e.segments.length!==segments.length || e.segments.some((s,i)=>['index','startMs','endMs','text'].some(k=>s[k as keyof typeof s]!==segments[i][k])) || e.text!==segments.map(s=>s.text).join(' ')
        || e.startMs!==segments[0].startMs || e.endMs!==Math.max(...segments.map(s=>s.endMs)) || e.endMs-e.startMs>120000)throw Error('The located narration did not match this recording.');
      const frames:RecordingFrame[]=[];let bytes=0;
      for(const timeMs of [e.startMs,Math.floor((e.startMs+e.endMs)/2),e.endMs-1]) {
        await requireCurrentScope();if(latestDraft.current!==snapshot)throw Error('The draft changed. Evidence extraction stopped.');
        const frame=await call('preview',{token:source.token,timeMs});const image=frame.image||'',data=teachingFrame(image);
        bytes+=data.length;if(bytes>2*1024*1024)throw Error('The three exact frames exceed the suggestion budget. No draft call was sent.');
        frames.push({timeMs,image,frameSha256:await teachingDigest(data)});
      }
      const prepared={excerptId:value.excerptId,excerptDigest:value.excerptDigest,excerpt:e,frames,suggestion:null,purpose:agent?'agent' as const:'taste' as const};setRecording(prepared);
      await requestRecordingDraft(prepared,snapshot);
    });
  }
  async function retryRecordingDraft() {
    if(!recording || !(recording.purpose==='agent'?agentAnalysisConsent:recordingConsent))return;
    await work('Drafting from the retained excerpt and frames',async()=>{await requireCurrentScope();await requestRecordingDraft(recording,draftSnapshot);});
  }
  async function queueAgentChange() {
    if(!agentProposal||!method||method.status!=='active'||!agentChangeConfirmed||agentChange||versionChanged||agentProposal.binding.targetVersionId!==currentVersion)return;
    const proposal=agentProposal;
    await work('Queuing the reviewed agent update',async()=>{
      await requireCurrentScope();
      const response=await fetch(`/api/agent-training/teaching-suggestion?operation=agent-change&sessionId=${encodeURIComponent(session)}`,{
        method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({suggestionId:proposal.suggestionId,
          suggestionDigest:proposal.suggestionDigest,expectedActiveVersionId:proposal.binding.targetVersionId,consent:true,methodId:method.id,methodDigest:method.contentDigest})});
      const value=await response.json();
      if(!response.ok||value?.ok!==true||!/^[-a-f0-9]{36}$/.test(value.requestId||'')||typeof value.status!=='string')
        throw Error(value?.reason==='recording_method_public_compatibility_required'
          ?'This public agent needs a publicly available generic operating method. Use the existing method sharing action, then refresh its exact body here. Private trainer teachings stay separate.'
          :'The edit response was not confirmed. Retry this same proposal; do not start another edit.');
      setAgentChange(value);setAgentChangeConfirmed(false);
    });
  }
  async function draftMethod() {
    if(!agentProposal||agentChange)return;
    const proposal=agentProposal;
    await work('Preparing the baseline operating method',async()=>{
      await requireCurrentScope();
      const response=await fetch(`/api/agent-training/teaching-suggestion?operation=method-draft&sessionId=${encodeURIComponent(session)}`,{
        method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({suggestionId:proposal.suggestionId,
          suggestionDigest:proposal.suggestionDigest,expectedActiveVersionId:proposal.binding.targetVersionId,consent:true})});
      const value=await response.json(),m=value?.method;
      if(!response.ok||value?.ok!==true||!m||!/^[-a-f0-9]{36}$/.test(m.id||'')||!/^[-a-z0-9]+$/.test(m.slug||'')
        ||typeof m.content!=='string'||m.content.length>30000||!/^[a-f0-9]{64}$/.test(m.contentDigest||'')||!['draft','active'].includes(m.status))
        throw Error('The method draft was not confirmed. Check the existing method library before requesting another candidate.');
      setMethod(m);setAgentChangeConfirmed(false);
    });
  }
  async function useRecordingSuggestion() {
    const suggestion=recording?.suggestion,frame=suggestion && recording.frames[suggestion.frameIndex];
    if(!suggestion || !frame || !previewIsCurrent || time!==frame.timeMs || preview?.image!==frame.image)return;
    await work('Using the reviewed recording suggestion',async()=>{
      await requireCurrentScope();
      setChosen(suggestion.fields.chosen);setWhy(suggestion.fields.why);setProcess(suggestion.fields.process);setBehavior(suggestion.fields.desiredBehavior);
      setDecisionKey(crypto.randomUUID());setSuggestionNote('Copied into editable fields. Review and save, then accept separately.');
    });
  }
  async function linkRecording(pending:NonNullable<typeof pendingRecordingLink>) {
    setPendingRecordingLink(pending);
    const response=await fetch(`/api/agent-training/teaching-suggestion?operation=recording&sessionId=${encodeURIComponent(pending.sessionId)}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','Idempotency-Key':pending.key},body:JSON.stringify(pending.body)});
    const value=await response.json();
    if(!response.ok || value?.ok!==true || value.event!=='recording_teaching_linked' || value.detail?.recordId!==pending.body.recordId || value.detail?.recordDigest!==pending.body.expectedRecordDigest
      || value.detail?.parentId!==pending.body.suggestionId || value.detail?.parentDigest!==pending.body.suggestionDigest)throw Error('The teaching is saved. Retry its recording link instead of creating another teaching.');
    setPendingRecordingLink(null);setRecording(null);setSuggestionNote('Teaching linked to the exact recognized excerpt and saved frame. Review it before accepting.');
  }

  async function saveDemoAnnotation() {
    if (!selected || !previewIsCurrent || !preview || !demoText.trim() || questionAnswer || !currentVersion) return;
    const source = selected, frame = preview, annotationText = demoText, identity = previewIdentity, version = currentVersion;
    await work('Saving your demonstration annotation', async () => {
      await requireCurrentScope();
      const frameSha256 = await teachingDigest(teachingFrame(frame.image));
      const expected = {sourceId:source.sourceId,sourceSha256:source.metadata.sha256,timeMs:frame.timeMs,frameSha256,
        rawAnnotation:annotationText,expectedActiveVersionId:version};
      const fingerprint = JSON.stringify({session,...expected});
      if (pendingDemoSave.current?.fingerprint !== fingerprint) pendingDemoSave.current = {fingerprint,key:crypto.randomUUID()};
      const response = await fetch(`/api/agent-training/teaching-suggestion?operation=annotation&sessionId=${encodeURIComponent(session)}`, {
        method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':pendingDemoSave.current.key},cache:'no-store',
        body:JSON.stringify({action:'save',...expected})});
      const value = await response.json();
      if (!response.ok || !demoAnnotationReceipt(value,expected)) throw Error('The annotation could not be verified. Your text is preserved; retry saving the same annotation.');
      setDemoAnnotation({value:{...expected,annotationId:value.annotationId,annotationDigest:value.annotationDigest},previewIdentity:identity});
      setSuggestionNote('Your complete annotation is saved privately. You can now request a teaching suggestion for this frame. Nothing has been admitted.');
    });
  }

  async function linkDemoAnnotation(pending: NonNullable<typeof pendingDemoLink>) {
    setPendingDemoLink(pending);
    const {annotation,recordId,recordDigest} = pending;
    const response = await fetch(`/api/agent-training/teaching-suggestion?operation=annotation&sessionId=${encodeURIComponent(pending.sessionId)}`, {
      method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':`demo-link:${annotation.annotationId}:${recordId}`},cache:'no-store',
      body:JSON.stringify({action:'link',annotationId:annotation.annotationId,annotationDigest:annotation.annotationDigest,
        recordId,expectedRecordDigest:recordDigest,expectedActiveVersionId:annotation.expectedActiveVersionId})});
    const value = await response.json();
    if (!response.ok || value?.ok !== true || value.contractVersion !== 'training-demo-link.v1'
      || value.annotationId !== annotation.annotationId || value.annotationDigest !== annotation.annotationDigest
      || value.recordId !== recordId || value.recordDigest !== recordDigest || typeof value.linkReceiptId !== 'string')
      throw Error('Your teaching draft and raw annotation are preserved. Retry the annotation link; do not save another draft.');
    setPendingDemoLink(null); setDemoAnnotation(null); setDemoText('');
    setSuggestionNote('The saved teaching is linked to your original private annotation. Review its exact evidence and wording before accepting it.');
  }

  async function suggestTeaching() {
    if (!selected?.token || !previewIsCurrent || !preview || (!questionAnswer && !demoAnnotationIsCurrent) || !draftConsent || suggesting) return;
    const source = selected, frame = preview, answer = questionAnswer, demo = demoAnnotation?.value, snapshot = draftSnapshot;
    setSuggesting(true); setSuggestionNote(''); setSuggested(null);
    try {
      await requireCurrentScope();
      if (latestDraft.current !== snapshot) throw Error('The frame or draft changed. No suggestion was requested.');
      const [frameSha256, feedbackSha256] = await Promise.all([teachingDigest(teachingFrame(frame.image)), teachingDigest(new TextEncoder().encode(answer?.rawAnswer ?? demo!.rawAnnotation))]);
      if (latestDraft.current !== snapshot) throw Error('The frame or draft changed. No suggestion was requested.');
      const binding = { sourceId: source.sourceId, sourceSha256: source.metadata.sha256, timeMs: frame.timeMs, frameSha256, feedbackSha256,
        ...(answer ? {questionReceiptId:answer.questions[0].id,questionReceiptDigest:answer.questions[0].receiptDigest}
          : {annotationId:demo!.annotationId,annotationDigest:demo!.annotationDigest}),expectedActiveVersionId:answer?.expectedActiveVersionId ?? demo!.expectedActiveVersionId };
      const { feedbackSha256: _localHash, ...wire } = binding;
      const response = await fetch(`/api/agent-training/teaching-suggestion?sessionId=${encodeURIComponent(session)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ ...wire, image: frame.image, ...(answer ? {feedback:answer.rawAnswer} : {mode:'demonstration'}), consent: true }) });
      const value: unknown = await response.json();
      if (!response.ok || !teachingSuggestion(value, binding)) throw Error(teachingFailure(value, response.status));
      setSuggested({ value, snapshot });
      setSuggestionNote(latestDraft.current !== snapshot ? 'Suggestion for a previous frame or edit — not applied. Keep your current draft or request a new suggestion.'
        : value.status === 'insufficient' ? value.reason : 'Review the suggestion before using it. Nothing was saved or admitted.');
    } catch (caught) { setSuggestionNote(caught instanceof Error ? caught.message : 'Suggestion unavailable. Your draft is preserved.'); }
    finally { setSuggesting(false); setDraftConsent(false); }
  }

  async function useSuggestion() {
    if (!suggested?.value.fields || suggested.snapshot !== latestDraft.current) return;
    try {
      await requireCurrentScope();
      if (suggested.snapshot !== latestDraft.current) throw Error('The frame or draft changed. Request a new suggestion.');
      const fields = suggested.value.fields;
      setChosen(fields.chosen); setWhy(fields.why); setProcess(fields.process); setBehavior(fields.desiredBehavior);
      appliedSuggestion.current = suggested.value; setSuggested(null); setDecisionKey(crypto.randomUUID());
      setSuggestionNote('Suggestion copied into the editable fields. Review your wording, save the draft, then accept it separately.');
    } catch (caught) { setSuggestionNote(caught instanceof Error ? caught.message : 'The suggestion was not applied.'); }
  }

  async function annotate() {
    if (!selected?.token || !previewIsCurrent || !priorityIsValid || (installationId&&!demoAnnotationIsCurrent)) return;
    const source = selected; const requestedTime = time; const requestedPreview = preview;
    await work('Saving the visual decision draft', async () => {
      const scope = await requireCurrentScope();
      if (!questionAnswer && demoText.trim() && !demoAnnotationIsCurrent) throw Error('Save the annotation for this exact frame and active version before saving its teaching.');
      if (pendingRecordingLink) throw Error('Finish linking the saved recording teaching before saving another.');
      if (pendingDemoLink) throw Error('Finish linking the preserved teaching draft before saving another.');
      const recordingDraft=recording?.suggestion && recording.excerpt.sourceId===source.sourceId && recording.excerpt.targetVersionId===scope.agent.currentVersionId
        && recording.frames.some(f=>f.timeMs===requestedTime && f.image===requestedPreview?.image) ? recording.suggestion : null;
      const demo = !questionAnswer && demoAnnotationIsCurrent ? demoAnnotation!.value : null;
      if (!requestedPreview || requestedPreview.token !== source.token || requestedPreview.timeMs !== requestedTime) throw new TrainingError('training_preview_stale', 'Preview this exact timestamp again before saving.');
      if (questionAnswer && questionAnswer.expectedActiveVersionId !== scope.agent.currentVersionId) throw new TrainingError('training_version_changed');
      const drafted = await call('annotate', {
        token: source.token, timeMs: requestedTime, idempotencyKey: decisionKey,
        decision: { chosen, why, process, desiredBehavior: behavior },
        content: {
          relation, properties: [property], mustNotCopy: ['source text', 'source logos', 'protected identity'],
          applicability: { taskFacts: [], stages: normalizeTrainingStages(stages), exceptions: [], priority: Number(selectionPriority) },
          governance: { rightsBasis: installationId?'permission_granted':'owner_created', rightsReceipt: installationId?'Customer confirms permission for this output and bounded private preference evidence':'Coach confirms ownership and grants bounded evidence use', disclosure: 'owner_private', retentionUntil: retention, deletionPolicy: 'revoke_then_delete_derivatives', consent: true, attribution: '' },
        },
      });
      const answerLink = questionAnswer && drafted.recordId && drafted.recordDigest
        ? { answer: questionAnswer, sessionId: session, recordId: drafted.recordId, recordDigest: drafted.recordDigest } : null;
      if (answerLink) setPendingAnswerLinks(answerLink);
      const demoLink = demo && drafted.recordId && drafted.recordDigest ? {annotation:demo,sessionId:session,recordId:drafted.recordId,recordDigest:drafted.recordDigest} : null;
      if (demoLink) setPendingDemoLink(demoLink);
      const recordingLink=recordingDraft && drafted.recordId && drafted.recordDigest ? {sessionId:session,key:`recording-link:${recordingDraft.suggestionId}:${drafted.recordId}`,body:{action:'link',
        sourceId:source.sourceId,sourceSha256:source.metadata.sha256,expectedActiveVersionId:scope.agent.currentVersionId,suggestionId:recordingDraft.suggestionId,
        suggestionDigest:recordingDraft.suggestionDigest,recordId:drafted.recordId,expectedRecordDigest:drafted.recordDigest}} : null;
      if(recordingLink)setPendingRecordingLink(recordingLink);
      setDecisionKey(crypto.randomUUID()); setPreview(null); setChosen(''); setWhy(''); setProcess(''); setBehavior(''); setWordingOpened(false); setSelectionPriority('50'); setStages(deriveTrainingStages(property)); setSuccessorStageExpansion(null);
      const saved = await load(session);
      if (appliedSuggestion.current) {
        const record = saved.sources?.flatMap(s => s.decisions).find(d => d.recordId === drafted.recordId);
        setSuggestionNote(record?.content.derivatives?.[0]?.sha256 === appliedSuggestion.current.binding.frameSha256
          ? 'Saved teaching evidence matches the suggestion frame. The saved text remains your reviewed draft; model authorship is not durably recorded.'
          : 'The draft was saved, but its evidence could not be matched to the suggestion frame. Do not treat the suggestion as describing this saved evidence.');
        appliedSuggestion.current = null;
      }
      if(recordingLink)await linkRecording(recordingLink);
      if (questionAnswer) {
        if (!drafted.recordId || !drafted.recordDigest) throw new TrainingError('question_answer_link_unavailable', 'The draft was saved, but no verifiable teaching identity was returned. Select that existing draft to link the answer.');
        await linkAnswers(answerLink!);
      }
      if (demo) {
        if (!demoLink) throw Error('The teaching draft was saved without a verifiable identity; the raw annotation is preserved.');
        await linkDemoAnnotation(demoLink);
      }
    });
  }

  async function reviewDecision(source: Source, decision: Decision,readOnly=false) {
    if (!source.token) {if(readOnly)setReviewed({source,decision,image:null,readOnly:true});return;}
    await work('Opening the exact saved evidence', async () => {
      await requireCurrentScope();
      let image:string|null=null;
      try{
        const result = await call('decisionPreview', { token: source.token, recordId: decision.recordId });
        if (result.recordId !== decision.recordId || result.recordDigest !== decision.recordDigest || !result.image) throw new TrainingError('training_decision_preview_mismatch', 'The saved evidence identity could not be verified.');
        image=result.image;
      }catch(error){if(!readOnly)throw error;}
      if(!readOnly)showTeaching();setReviewed({ source, decision, image,readOnly });setAcceptConfirmed(false);setRetireConfirmed(false);setRevokeConfirmed(false);
    });
  }

  function manageDecision(source: Source, decision: Decision) {
    showTeaching();setReviewed({ source, decision, image: null }); setAcceptConfirmed(false); setRetireConfirmed(false); setRevokeConfirmed(false);
  }

  async function acceptReviewed() {
    if (!reviewed?.source.token || !acceptConfirmed || reviewed.decision.state !== 'draft') return;
    await work('Revalidating source and accepting decision', async () => {
      await requireCurrentScope();
      await call('accept', { token: reviewed.source.token, recordId: reviewed.decision.recordId, expectedDigest: reviewed.decision.recordDigest });
      await load(session); setReviewed(null);
      if (questions) await loadQuestions();
    });
  }

  async function changeServerStorage(action: 'status' | 'store' | 'withdraw') {
    if (!reviewed || !serverStorageSupported || (action==='store' && (!serverConsent || !reviewed.source.token))
      || (action==='withdraw' && !serverWithdrawal)) return;
    const target=reviewed;
    await work(action==='store'?'Saving this teaching image privately':'Checking this teaching image',async()=>{
      const args=action==='store' ? {action,token:target.source.token,recordId:target.decision.recordId,expectedDigest:target.decision.recordDigest,consent:true}
        : {action,sessionId:session,recordId:target.decision.recordId,expectedDigest:target.decision.recordDigest};
      const result=await call('serverStorage',args);
      if (result.storage!==null && !isTrainingEvidenceStorage(result.storage,target.decision.recordId,target.decision.recordDigest))
        throw new TrainingError('training_storage_response_invalid','The stored-image status could not be verified.');
      if(action==='store' && (!result.storage?.storedAt || result.storage.withdrawnAt || result.storage.deletedAt))
        throw new TrainingError('training_storage_response_invalid','The image has not been confirmed as stored.');
      setServerStorage(result.storage);setServerConsent(false);setServerWithdrawal(false);
      setServerStorageNote(action==='withdraw' ? result.cleanup==='deleted'?'Server copy removed. The original teaching and local source are unchanged.':'Further access is withdrawn. Server deletion is pending and will retry.'
        : action==='store'?'This exact teaching image is stored privately for your own runs. It is not released to customers.':'');
    });
  }

  async function reduceReviewedAuthority(operation: 'retire' | 'revoke') {
    if (!reviewed || (operation === 'retire' ? !retireConfirmed || reviewed.decision.state !== 'accepted'
      : !revokeConfirmed || !['accepted', 'retired'].includes(reviewed.decision.state))) return;
    await work(operation === 'retire' ? 'Stopping selection in new runs' : 'Withdrawing permission', async () => {
      const result = await call(operation, { sessionId: session, recordId: reviewed.decision.recordId, expectedDigest: reviewed.decision.recordDigest });
      if (result.recordId !== reviewed.decision.recordId || result.recordDigest !== reviewed.decision.recordDigest
        || result.state !== (operation === 'retire' ? 'retired' : 'revoked')) throw new TrainingError('training_authority_response_invalid', 'The teaching authority change could not be verified.');
      const acknowledged = reviewed.decision;
      const state: DecisionState = operation === 'retire' ? 'retired' : 'revoked';
      setSources(prior => prior.map(source => ({ ...source, decisions: source.decisions.map(decision =>
        decision.recordId === acknowledged.recordId && decision.recordDigest === acknowledged.recordDigest
          ? { ...decision, state } : decision) })));
      setReviewed(null);
      try { await load(session); if (questions) await loadQuestions(); }
      catch { setError('The change was applied, but the teaching list could not refresh. Reload Training to update the list.'); }
    });
  }

  async function setReviewedDelivery(mode: DeliveryMode) {
    if (!reviewed || reviewed.decision.state !== 'accepted' || versionChanged
      || !['accepted', 'rejected'].includes(reviewed.decision.content.relation)
      || (reviewed.decision.deliveryMode || 'on_question') === mode) return;
    const decision = reviewed.decision;
    const pending = pendingDelivery.current;
    // Retain one request key after an uncertain response; a later toggle is a new event.
    const key = pending?.sessionId === session && pending.recordId === decision.recordId
      && pending.digest === decision.recordDigest && pending.mode === mode ? pending.key : crypto.randomUUID();
    pendingDelivery.current = { sessionId: session, recordId: decision.recordId, digest: decision.recordDigest, mode, key };
    await work('Updating teaching delivery for new runs', async () => {
      await requireCurrentScope();
      let result: Result;
      try {
        result = await call('delivery', { sessionId: session, recordId: decision.recordId,
          expectedDigest: decision.recordDigest, mode, idempotencyKey: key });
      } catch (caught) {
        if (caught instanceof TrainingError && caught.reason === 'competence_not_accepted') {
          throw new TrainingError(caught.reason, 'Stage-start delivery requires a current accepted positive or negative full-frame PNG teaching, without a selected region. Reload Training to check its status. Your existing teaching is unchanged.');
        }
        throw caught;
      }
      if (result.recordId !== decision.recordId || result.recordDigest !== decision.recordDigest
        || result.mode !== mode || !/^[a-f0-9]{64}$/.test(result.receiptDigest || '')) {
        throw new TrainingError('training_delivery_response_invalid', 'The delivery change could not be verified. Retry to check this same request.');
      }
      const acknowledged = { ...decision, deliveryMode: mode, deliveryReceiptDigest: result.receiptDigest! };
      setSources(prior => prior.map(source => ({ ...source, decisions: source.decisions.map(item =>
        item.recordId === decision.recordId && item.recordDigest === decision.recordDigest ? acknowledged : item) })));
      setReviewed(prior => prior?.decision.recordId === decision.recordId && prior.decision.recordDigest === decision.recordDigest
        ? { ...prior, decision: acknowledged } : prior);
      pendingDelivery.current = null;
      try { await load(session); }
      catch { setError('Delivery was updated for new runs, but the teaching list could not refresh. The acknowledged setting is shown below.'); }
    });
  }

  async function discardDraft(draft: LocalDraft) {
    await work('Discarding the local draft', async () => {
      await call('discardDraft', { token: draft.token, ...(draft.key ? { decisionKey: draft.key } : {}) });
      if (session) await load(session);
    });
  }

  async function chatAction(action:string,binding:{versionId:string;sourceId:string|null;sourceSha256:string|null}) {
    if(versionChanged||binding.versionId!==currentVersion||binding.sourceId!==(selected?.sourceId||null)
      ||binding.sourceSha256!==(selected?.metadata.sha256||null)||busyRef.current)return;
    try {await requireCurrentScope();}catch(e){setError(e instanceof Error?e.message:'The current agent could not be verified.');return;}
    if(action==='test_agent'&&changes){setChatExpanded(false);currentTraining();setView('start');requestAnimationFrame(()=>document.querySelector('[aria-label="Test this update"]')?.scrollIntoView({block:'center',behavior:'smooth'}));return;}
    if(action==='analyse_tool_method'||action==='analyse_taste'){
      const agent=action==='analyse_tool_method';
      if(!(agent?agentAnalysisConsent:recordingConsent)){
        setSuggestionNote('Review the recording-analysis consent below, then choose its analysis action. Chat has not sent the recording or started analysis.');
        reveal('recording-analysis');return;
      }
      setChatExpanded(false);await findRecordingTeaching(agent);return;
    }
    if(action==='review_teaching'&&selected){
      const d=selected.decisions.find(d=>d.state==='draft')||selected.decisions.find(d=>d.state==='accepted');
      if(d){setChatExpanded(false);await reviewDecision(selected,d);return;}
    }
    const id=action==='review_method'?'training-chat-methods':'recording-analysis';
    if(action==='review_method')revealTrainingElement(id);else reveal(id);
    if(action==='review_agent_update')setSuggestionNote('Review the recording proposal, exact method and agent-change confirmation below. Nothing has been queued by chat.');
  }

  return <main id="main-content" tabIndex={-1} className={`mx-auto px-6 py-10 space-y-6 ${installationId?'max-w-3xl':'max-w-7xl lg:px-10'}`}>
    <Link className="text-xs text-ink-400 hover:text-ink-100" href={installationId?`/workflows/${encodeURIComponent(slug)}`:"/training"}>{installationId?"← Agent":"← Your agents"}</Link>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-800 pb-7"><div className="space-y-3"><p className="text-xs text-ink-500">{installationId?'Your private preferences':'Training'}</p><h1 className="max-w-2xl text-2xl font-medium tracking-tight sm:text-3xl">{installationId?'Private preferences for ':''}{agentName}</h1>{installationId&&<p className="text-xs text-ink-500">Active version: {shortId(currentVersion)}{sessionVersion?` · Session version: ${shortId(sessionVersion)}`:''}</p>}</div>
      {!installationId&&<div className="flex items-center gap-4"><button id="training-chat-toggle" type="button" className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:border-ink-500" aria-expanded={chatExpanded} aria-controls="training-companion" onClick={()=>chatExpanded?setChatExpanded(false):focusChat()}>Chat with Implexa</button><Link className="text-xs text-ink-400 hover:text-ink-100" href={`/workflows/${encodeURIComponent(slug)}?source=generated`}>Open agent →</Link></div>}
    </header>
    <div className={installationId?'':`grid items-start gap-10 ${chatExpanded?'lg:grid-cols-[minmax(0,1fr)_360px]':''}`}>
    <div className={`min-w-0 space-y-7 ${installationId?legacyControls:''}`}>
    {!installationId&&trainingNeedsAttention&&<section role="status" className={`rounded-xl border border-amber-700/60 bg-amber-950/20 p-4 text-sm space-y-2 ${legacyControls}`} aria-label="Training needs attention">
      <p className="font-medium text-amber-200">Training needs attention</p>
      {readinessNeedsAttention&&<><p className="text-ink-300">Some saved evidence may not yet guide this agent’s runs. Review its current training status.</p><button type="button" onClick={()=>reveal('training-readiness')}>Review training status</button></>}
      {preservedWorkCount>0&&<><p>{preservedWorkCount} preserved operation{preservedWorkCount===1?' needs':'s need'} attention. Nothing has been discarded.</p><button type="button" onClick={()=>setView('history')}>Review preserved work</button></>}
      {pendingRecordingLink&&<button type="button" onClick={()=>reveal('recording-analysis')}>Review recording link</button>}
    </section>}
    {!installationId&&<TrainingEntry slug={slug} lastRunId={lastRunId} runs={recentRuns} runsUnavailable={runsUnavailable} actions={<NewReview presentation="training" ownerId={ownerId||''} trainingSlug={slug} onTrainingUpload={()=>{setConsent(false);setDiscardDraftConfirmed(false);setUploadOpen(true);}} uploadDisabled={!!busy||changesBusy||versionChanged||!currentVersion} uploading={busy==='Verifying the selected source and saving its identity'}/>}/>}
    {!installationId&&(historyBusy||historyError)&&<p role="status" className="text-sm text-ink-400">{historyBusy?'Loading earlier training…':historyError}</p>}
    {!installationId&&history&&<section aria-label="Earlier training" className="space-y-5"><header className="flex items-center justify-between gap-4"><h2 className="text-xl font-medium">Learnings</h2>{versionPicker}</header><p className="text-xs text-ink-500">Earlier version · read-only</p>{history.sources.flatMap(source=>source.decisions.map(d=><details key={d.recordId} className="border-b border-ink-800 py-4"><summary className="cursor-pointer text-sm">{['draft','accepted'].includes(d.state)?d.decision.desiredBehavior||d.content.summary:'This teaching is no longer available for use.'}</summary><div className="space-y-3 pt-4 text-sm leading-6 text-ink-400">{source.token&&d.content.derivatives?.[0]?.sha256&&['draft','accepted'].includes(d.state)&&<TrainingImage token={source.token} recordId={d.recordId} recordDigest={d.recordDigest} frameSha256={d.content.derivatives[0].sha256} enabled={!busy} context={`${history.sessionId}:${history.versionId}`} alt="Earlier teaching example"/>}{['draft','accepted'].includes(d.state)&&<p>{d.content.summary}</p>}<p>{d.state} · {relationLabel(d.content.relation)}</p></div></details>))}{!history.sources.length&&<p className="text-sm text-ink-500">No examples were returned for this version.</p>}</section>}
    {!installationId&&!session&&!busy&&<button type="button" className="text-sm text-ink-300 disabled:opacity-40" disabled={!currentVersion||versionChanged} onClick={()=>{focusChat();}}>Start teaching →</button>}
    {!installationId&&session&&!history&&<>
      {changes?<TrainingChanges value={changes} versionPicker={versionPicker} renderExample={learningExample} captionFor={learningCaption} busy={!!busy||changesBusy||versionChanged}
        onActivate={activateCandidate}
        onWithdraw={target=>mutateChanges('withdraw',{sourceEventId:target.eventId,expectedEventDigest:target.eventDigest})}
        onImport={(build,noteIndex)=>mutateChanges('creation-import',{buildRequestId:build.buildRequestId,replyId:build.replyId,replyDigest:build.replyDigest,noteIndex})}
        onPolicy={(enabled,policy)=>mutateChanges('policy',{expectedActiveVersionId:currentVersion,expectedPolicyDigest:policy.policyDigest,enabled})}
        onForce={target=>requestLearning({kind:'feedback',id:target.eventId,digest:target.eventDigest},'Please prepare a private learning from this selected feedback, preserving my meaning. If my preference is unclear, ask instead of inventing it.')}
        onEdit={editCandidate}
        onRecord={(record,action)=>mutateChanges('records',{expectedActiveVersionId:currentVersion,recordId:record.recordId,expectedRecordDigest:record.recordDigest,expectedSnapshotDigest:changes.binding.snapshotDigest,action})}
        onTest={digest=>prepareCandidateTest(digest)}
        onPublish={()=>setPublicationReviewOpen(true)}/>:<p className="text-sm text-ink-500">{changesError?'Saved training changes are unavailable; existing evidence is preserved.':'Loading saved training changes…'}</p>}
      {changesError&&<p role="status" className="text-xs text-ink-400">{changesError.replaceAll('_',' ')} <button type="button" disabled={changesBusy} onClick={()=>loadChanges()}>Refresh saved changes</button></p>}
    </>}
    <div hidden={!installationId&&view!=='settings'} className={`space-y-6 ${legacyControls}`}>
    <p>Teach visual decisions from your own video or image without starting a run. Accepted decisions are eligible only for the exact agent version and stages shown here, and can later be stopped for new runs or have permission withdrawn.</p>
    {!installationId && !changes?.publication.canPrepare&&<section className="rounded border border-ink-700 p-4 space-y-3" aria-label="Public agent definition">
      <h2 className="font-semibold">Public agent definition</h2>
      <p>Let other people use this agent’s steps and input requirements. It will appear on Implexa’s public site and in community search. Your recordings, run outputs, feedback and private teachings are not published by this action. Sharing selected teachings requires a separate release.</p>
      <button disabled={!!busy||!currentVersion} onClick={()=>changePublication()}>Check public visibility</button>
      {publication&&<><p>{publication.shared?'This agent definition is public.':'This agent definition is private.'}</p>
        {publication.shared?<><a href={publication.publicUrl} target="_blank" rel="noreferrer">Open public agent</a>
          <button disabled={!!busy||publication.versionId!==currentVersion} onClick={()=>changePublication(false,true)}>Make agent private</button></>:<>
          <label className="flex gap-3"><input type="checkbox" checked={publishConfirmed} disabled={!!busy} onChange={event=>setPublishConfirmed(event.target.checked)}/>Publish this agent definition for other people to use. I have reviewed its steps and inputs for private information.</label>
          <button disabled={!!busy||!publishConfirmed||publication.versionId!==currentVersion} onClick={()=>changePublication(true)}>Make agent public</button>
        </>}
      </>}
    </section>}
    {installationId && <p>Only your installation can select these preferences. The trainer’s agent and teachings stay unchanged. Images remain on this Mac. Review suggested wording before admitting it; keep your exact feedback separately and label any agent-written options.</p>}
    {suggestionNote && <p role="status">{suggestionNote}</p>}
    {!installationId && (changes?.publication.canPrepare?<TrainingDetails title="Advanced image custody and fork permissions" open={!!forkPermission}><PublisherTeachingRelease slug={slug} versionId={currentVersion} forkPermission={forkPermission}/></TrainingDetails>:<PublisherTeachingRelease slug={slug} versionId={currentVersion} forkPermission={forkPermission}/>)}
    </div>
    {suggestionNote&& !installationId&&view!=='settings'&&<p role="status" className="rounded-lg border border-ink-700 p-3 text-sm">{suggestionNote}</p>}
    <div hidden={!installationId&&view!=='history'} className={`space-y-5 ${legacyControls}`}>
    {!installationId && <section className="rounded border border-ink-700 p-4 space-y-3" aria-labelledby="trainer-questions-heading">
      <h2 id="trainer-questions-heading" className="font-semibold">Questions from runs</h2>
      <p>Review actual recorded consultations, including failed or cancelled runs. A returned reference is not proof that it answered the question or was applied.</p>
      <button disabled={questionsBusy || !!busy} onClick={() => loadQuestions()}>{questions ? 'Refresh recorded questions' : 'Load recorded questions'}</button>
      {questionsBusy && <p role="status">Loading recorded questions…</p>}{questionsError && <p role="alert">{questionsError}</p>}
      {questions && questions.items.length === 0 && <p>No recorded questions were returned for this agent.</p>}
      {questions && questionGroups(questions.items).map(group => <section key={`${group[0].questionVersionId}:${group[0].stage}:${group[0].property}`} className="rounded border border-ink-800 p-3 space-y-2">
        <h3>{trainingStageLabel(group[0].stage)} · {group[0].property.replaceAll('_', ' ')} · question version {shortId(group[0].questionVersionId)}</h3>
        <p>{Math.max(...group.map(q => q.recurrenceCount))} recorded questions for this version, stage and property; {group.length} loaded here. These are not necessarily the same question.</p>
        {group.map(q => <article key={q.id} className="border-t border-ink-800 pt-2 space-y-1">
          <label className="flex gap-2"><input type="checkbox" aria-label={`Select question ${q.questionId}`} checked={questionIds.includes(q.id)} onChange={event => setQuestionIds(ids => event.target.checked ? [...ids, q.id] : ids.filter(id => id !== q.id))} />{q.question}</label>
          <p><Link href={`/runs/${q.runId}`}>Run {shortId(q.runId)}</Link> · {q.runState || q.runStatus || 'State not recorded'} · {q.sceneElement}</p>
          <p>{q.outcome === 'matched' ? 'References returned; usefulness and application are unverified.' : 'No selected guidance matched. This is not proof the trainer never taught it.'}</p>
          <p>Returned reference IDs: {q.returnedReferenceIds.length ? q.returnedReferenceIds.map(shortId).join(', ') : 'none'}.</p>
          <p>Fallback and linked frame evidence were not recorded. Choose your own authorized teaching frame below; no run frame is imported.</p>
          {q.teachings.map(t => <p key={`${t.sessionId}:${t.recordId}`}>
            {t.state === 'taught' ? 'Taught — currently eligible, not proof of selection or application' : t.state === 'prepared' ? 'Prepared — review and accept the evidence draft separately' : `Not currently eligible${t.reason ? `: ${reasonLabel(t.reason)}` : ''}`} · teaching {shortId(t.recordId)} · target {shortId(t.targetVersionId)}.
          </p>)}
        </article>)}
      </section>)}
      {questions?.nextCursor && <button disabled={questionsBusy || !!busy} onClick={() => loadQuestions(questions.nextCursor)}>Load more recorded questions</button>}
      {questions && <>
        <label className="block">Private answer<textarea className="block w-full rounded border bg-ink-900 p-2" maxLength={2000} value={rawAnswer} onChange={event => setRawAnswer(event.target.value)} /></label>
        <p>The raw answer stays in private answer history once linked. It is not automatically delivered to workers. Prepare an editable teaching excerpt, then choose and review an owner-created example.</p>
        <button disabled={!!busy || questionsBusy || !!pendingAnswerLinks || !questionIds.length || !rawAnswer.trim() || !questions.activeVersionId} onClick={prepareQuestionAnswer}>Answer and prepare teaching</button>
        <p>Answers target active version {shortId(questions.activeVersionId)}; the original question versions remain shown above. Eligible teaching may still be shadowed by other examples or selection limits.</p>
      </>}
      {questionAnswer && <div className="rounded border border-brand-500 p-3 space-y-2">
        <h3>Worker-visible draft guidance — edit before saving</h3>
        <blockquote className="whitespace-pre-wrap">{questionAnswer.rawAnswer}</blockquote>
        <p>Your complete answer is preserved here and saved privately when linked to a teaching. Write an editable excerpt below, or request a suggestion after previewing your chosen frame. Only the reviewed teaching may be delivered if admitted.</p>
        <label>Or link an existing teaching that already expresses this answer<select value={linkRecordId} onChange={event => setLinkRecordId(event.target.value)}><option value="">Choose a saved draft or teaching</option>{sources.flatMap(source => source.decisions.filter(d => ['draft', 'accepted'].includes(d.state)).map(d => <option key={d.recordId} value={d.recordId}>{shortId(d.recordId)} · {d.state} · {d.content.summary.slice(0, 80)}</option>))}</select></label>
        <p>Linking preserves the existing teaching; it does not edit its text or evidence. This also resumes a draft saved before an interrupted answer link.</p>
        <button disabled={!!busy || !linkRecordId || sessionVersion !== questionAnswer.expectedActiveVersionId} onClick={linkExistingTeaching}>Link answer to selected teaching</button>
      </div>}
      {pendingAnswerLinks && <div role="status"><p>The evidence draft is preserved. {pendingAnswerLinks.answer.questions.length} answer link(s) remain unverified.</p><button disabled={!!busy} onClick={() => work('Retrying the saved answer links', () => linkAnswers(pendingAnswerLinks))}>Retry answer links</button></div>}
      {pendingDemoLink && <div role="status"><p>The teaching draft and original demonstration annotation are preserved. Their link remains unverified.</p><button disabled={!!busy} onClick={() => work('Retrying the saved demonstration link', () => linkDemoAnnotation(pendingDemoLink))}>Retry demonstration link</button></div>}
    </section>}
    </div>
    {installationId && versionChanged && <p role="alert">This preference session belongs to another installed version. Reopen your agent’s private preferences; no teaching is moved automatically.</p>}
    {installationId && pendingDemoLink && <button disabled={!!busy} onClick={() => work("Linking the preserved preference feedback", () => linkDemoAnnotation(pendingDemoLink))}>Retry feedback link</button>}
    {!installationId && versionChanged && <section role={activeVersionTrainingIsReady ? 'status' : 'alert'} className={`rounded border p-4 space-y-3 ${legacyControls} ${activeVersionTrainingIsReady ? 'border-emerald-600' : 'border-amber-500'}`}><h2 className="font-semibold">{activeVersionTrainingIsReady ? 'Active-version Manager training is ready' : 'Move reviewed evidence to the active version explicitly'}</h2>{activeVersionTrainingIsReady ? <><p>This historical session and its accepted decisions remain immutable on {shortId(sessionVersion)}. The active version {shortId(currentVersion)} can select the same evidence through explicit immutable adoption receipts; all {managerTrainingRequirements?.requiredPairs.length || 0} critical request-admission visual-reference routes are fulfilled. First launch still verifies every declared reference.</p><p>No new successor training session is required to run this Agent. Start one only when you want to change or add training evidence for the active version.</p></> : <><p>This session and its accepted decisions remain immutable on {shortId(sessionVersion)}. The active version is {shortId(currentVersion)} and cannot select those records. Start a separate successor session, re-select the exact source, and review each new decision before accepting it.</p><label className="flex gap-3"><input type="checkbox" checked={transitionConfirmed} disabled={!!busy} onChange={(event) => setTransitionConfirmed(event.target.checked)} />I understand this creates new evidence records for the active version and does not change or automatically accept the existing records.</label><button disabled={!!busy || !transitionConfirmed || !currentVersion} onClick={beginVersionSuccessor}>Start successor training session</button></>}</section>}
    <div id="training-demonstration" hidden={!installationId&&(view!=='teach'||directSource)} className={`space-y-4 rounded-xl border border-ink-800 p-5 ${legacyControls}`}>
    {!installationId&&<div><h2 className="text-lg font-medium">Your demonstration</h2><p className="mt-2 text-sm text-ink-400">Choose a recording or image, then select the moment you want to teach.</p></div>}
    <label className="flex gap-3 text-sm leading-6"><input type="checkbox" checked={consent} disabled={!!busy || versionChanged} onChange={(event) => setConsent(event.target.checked)} />{installationId?"I have permission to use this output and save bounded private preference evidence for one year":"I created this source and consent to local custody, saving bounded frame evidence for one year, and relevant future evidence selection."} The original stays on this computer. I can stop future selection or withdraw permission below.</label>

    {recordingSelection && <p>Use the selected saved recording and moment notes. Notes over the existing annotation limit must be shortened or split deliberately; the full saved moment remains on this Mac.</p>}
    <button className="btn-primary" disabled={!consent || !!busy || versionChanged || !currentVersion} onClick={()=>void add()}>{recordingSelection?"Use selected recording":"Add training source"}</button>
    </div>
    {busy && <p role="status" aria-live="polite">{busy}… Large files can take several minutes.</p>}{error && <p role="alert">{reasonLabel(error)}</p>}
    <div id="training-readiness"><TrainingDetails title="Training readiness & version details" open={readinessNeedsAttention}>
    {acceptedEvidenceCount > 0 && <p role="status" className="rounded border border-emerald-600 p-3">Evidence accepted: {acceptedEvidenceCount} immutable decision{acceptedEvidenceCount === 1 ? '' : 's'} in this session. Acceptance preserves the teaching; Agent readiness is verified separately below.</p>}
    {currentVersion && !requirementsAreCurrent && !activeVersionTrainingIsReady && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Manager reference training readiness unavailable</h2><p>Implexa cannot verify the required stage and quality-reference pairs for this exact active version. Accepted evidence remains preserved. Decision, procedure, criterion, and machine-custody requirements are verified separately at run prelaunch.</p></section>}
    {!installationId && trainingNeedsCoach && managerTrainingRequirements && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Evidence accepted — reference training not ready</h2><p>The immutable Agent policy still requires accepted visual-reference evidence at the stage/property routes below. Create or explicitly expand successor drafts, review their exact evidence, and accept each new digest. Implexa does not silently widen an accepted record. Other Manager families are verified separately before a run starts.</p><ul className="list-disc pl-5">{managerTrainingRequirements.missingPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)}</li>)}</ul></section>}
    {(acceptedEvidenceCount > 0 || (managerCoverage?.acceptedLocalRecordCount || 0) > 0) && !coverageCanClaimReady && !coverageNeedsUpdate && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Manager coverage status unavailable</h2><p>Implexa cannot prove that this exact agent version can consume the accepted evidence across its training sessions. Update Desktop or reload after the coverage service is available. The evidence remains preserved, but this page will not describe it as ready for a run.</p></section>}
    {coverageNeedsUpdate && managerCoverage && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Agent update required before this evidence can guide runs</h2><p>{managerCoverage.reason === 'manager_quality_coverage_unclassified_training' ? 'This version has no Manager training-coverage policy.' : 'This version does not cover every accepted evidence property, relation, and stage.'} This is the version-wide result across all training sessions for this immutable agent version. Your accepted evidence remains immutable and preserved, but uncovered decisions cannot be selected at planning or any other uncovered stage.</p><p>Publish a new immutable agent version with Manager v3 coverage for the listed evidence. Existing accepted records will not be rewritten.</p>{managerCoverage.uncoveredPairs.length > 0 && <ul className="list-disc pl-5">{managerCoverage.uncoveredPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)}</li>)}</ul>}</section>}
    {coverageCanClaimReady && managerCoverage?.contractVersion === 'manager-training-coverage.v1' && <p role="status" className="rounded border border-emerald-600 p-3">This immutable agent version classifies all {managerCoverage.acceptedPairs.length} accepted stage-scoped evidence routes across all training sessions.</p>}
    {coverageCanClaimReady && managerCoverage?.contractVersion === 'manager-training-coverage.v2' && <section role="status" className="rounded border border-ink-700 p-3 space-y-2"><h2 className="font-semibold">Private training routing available</h2><p>{managerCoverage.coveredPairs.length} required-policy routes · {managerCoverage.optionalPairs.length} optional taste routes. Optional taste can guide supported decisions without editing this agent. Each run selects a bounded set; eligibility does not mean an example was selected or applied.</p>{managerCoverage.optionalPairs.length > 0 && <ul className="list-disc pl-5">{managerCoverage.optionalPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)} · Optional taste</li>)}</ul>}{managerCoverage.unsupportedPairs.length > 0 && <div className="text-amber-400"><p>{managerCoverage.unsupportedPairs.length} accepted routes are not supported by this routing policy. They remain saved, are not selected through optional routing, and do not block other supported training.</p><ul className="list-disc pl-5">{managerCoverage.unsupportedPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)} · Unsupported</li>)}</ul></div>}</section>}
    {coverageCanClaimReady && trainingIsReady && managerTrainingRequirements && <p role="status" className="rounded border border-emerald-600 p-3">Manager reference training ready: all {managerTrainingRequirements.requiredPairs.length} critical request-admission visual-reference routes are explicitly fulfilled for this immutable version. This preflight does not cover every declared reference; first launch verifies all declared references, decisions, procedures, criteria, custody, and the exact selected evidence set.</p>}

    </TrainingDetails></div>
    <div hidden={!installationId&&view!=='teach'&&view!=='history'} className="space-y-5">
    {!installationId && versionTransition && <section className={`rounded border border-brand-500 p-4 space-y-3 ${legacyControls}`} aria-labelledby="version-successor-heading"><h2 id="version-successor-heading" className="font-semibold">Recreate reviewed decisions for {shortId(sessionVersion)}</h2><p>The records below remain bound to {shortId(versionTransition.fromVersion)}. Re-add the exact source file; Implexa enables a successor only after its SHA-256 matches. The copied text and stages are only a draft. You must preview the exact frame, save it, review the new immutable digest, and accept it again before Manager readiness can include it.</p><ul className="space-y-3">{versionTransition.sources.flatMap((oldSource) => oldSource.decisions.filter((decision) => decision.state === 'accepted').map((decision) => { const matched = sources.find((candidate) => candidate.metadata.sha256 === oldSource.metadata.sha256); const alreadyCreated = matched?.decisions.some((candidate) => candidate.content.relation === decision.content.relation && candidate.content.anchor.startMs === decision.content.anchor.startMs && candidate.content.summary === decision.content.summary); return <li key={decision.recordId} className="rounded border border-ink-700 p-3 space-y-2"><p>{formatTrainingTime(decision.content.anchor.startMs)} · {decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')} · from digest {shortId(decision.recordDigest)}</p>{!matched && <p>Re-add source SHA-256 {shortId(oldSource.metadata.sha256)} to continue.</p>}{alreadyCreated ? <p role="status">A distinct successor draft or accepted record already exists in this session.</p> : <button disabled={!!busy || !matched} onClick={() => matched && prepareVersionSuccessor(matched, decision)}>Prepare new-version successor draft</button>}</li>; }))}</ul></section>}

    {failed.map((draft) => <section key={draft.token} className="rounded border border-ink-700 p-3" aria-label="Preserved source draft"><p>Preserved source draft: {reasonLabel(draft.reason)}</p>{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying registration', async () => { await requireCurrentScope(); await call('register', { token: draft.token }); await load(session); })}>Retry registration</button> : <p>This refusal cannot be fixed by retrying the same file. Choose a different source or discard this local draft.</p>}{!draft.retryable && <button disabled={!!busy} onClick={() => discardDraft(draft)}>Discard local draft</button>}</section>)}
    {pending.map((draft) => <section key={`${draft.token}:${draft.key}`} className="rounded border border-ink-700 p-3" aria-label="Preserved decision draft"><p>Preserved decision: {reasonLabel(draft.reason)}</p>{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying saved decision', async () => { await requireCurrentScope(); await call('retryDraft', { token: draft.token, key: draft.key }); await load(session); })}>Retry saved decision</button> : <><p>This refusal cannot be fixed by sending the same decision again.</p><button disabled={!!busy} onClick={() => discardDraft(draft)}>Discard local draft</button></>}</section>)}

    <TrainingDetails title="Saved sources & original decisions" open={Boolean(installationId)||view==='teach'}>{sources.map((source, index) => <section key={source.sourceId} className="rounded border border-ink-700 p-4 space-y-3"><h2>Source {index + 1} · Owner demonstration · {source.metadata.mediaType}</h2><p className="text-sm text-ink-400">{source.localName ? `${source.localName} · ` : ''}{source.metadata.width}×{source.metadata.height} · {formatTrainingTime(source.metadata.durationMs)} · SHA-256 {shortId(source.metadata.sha256)}</p><button disabled={!source.token || !!busy || versionChanged} onClick={() => chooseSource(source)}>Annotate source</button>{!source.token && <p>Local evidence is on another computer or unavailable.</p>}
      <ul className="divide-y divide-ink-800">{source.decisions.map((decision) => { const decisionStages = normalizeTrainingStages(decision.content.applicability?.stages); return <li key={decision.recordId} className="py-3 space-y-2"><p>{formatTrainingTime(decision.content.anchor.startMs)} · {decision.state} · {relationLabel(decision.content.relation)}</p><p>{decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')}</p><p><span className="font-semibold">Eligible stages:</span> {decisionStages.length ? decisionStages.map(trainingStageLabel).join(', ') : 'Not recorded'}</p>{decision.state === 'accepted' && !decisionStages.includes('planning') && <p className="text-amber-400">This accepted record cannot guide planning before tools or paid actions. Create a new planning-scoped decision to preserve the original record.</p>}<p>{decision.content.summary}</p><p className="text-xs text-ink-500">Evidence digest {shortId(decision.recordDigest)}</p>{(decision.state === 'draft' || decision.state === 'accepted') && <button disabled={!!busy || !source.token || versionChanged} onClick={() => reviewDecision(source, decision)}>{decision.state === 'draft' ? 'Review before accepting' : 'Review accepted evidence'}</button>}{(decision.state === 'accepted' || decision.state === 'retired') && <button disabled={!!busy} onClick={() => manageDecision(source, decision)}>Manage teaching</button>}</li>; })}</ul>
    </section>)}</TrainingDetails>

    </div>
    {reviewed && reviewedIsVisible && <section className={`rounded border border-brand-500 p-4 space-y-4 ${legacyControls}`} aria-labelledby="decision-review-heading"><h2 ref={reviewHeadingRef} id="decision-review-heading" tabIndex={-1}>{reviewed.image ? 'Exact saved evidence' : 'Saved teaching'}</h2>{reviewed.readOnly&&<p className="text-xs text-ink-400">Original example · read-only. Current training is unchanged.</p>}{reviewed.readOnly&&!reviewed.image&&<p role="status" className="text-sm text-ink-400">Saved frame unavailable on this computer. The original teaching text is preserved.</p>}{reviewed.image && <img src={reviewed.image} alt={`Saved evidence at ${formatTrainingTime(reviewed.decision.content.anchor.startMs)}`} className="w-full" />}<dl className="grid gap-2 text-sm"><div><dt className="font-semibold">Source</dt><dd>{reviewed.source.localName || `SHA-256 ${shortId(reviewed.source.metadata.sha256)}`}</dd></div><div><dt className="font-semibold">Timestamp</dt><dd>{formatTrainingTime(reviewed.decision.content.anchor.startMs)}</dd></div><div><dt className="font-semibold">Relation</dt><dd>{relationLabel(reviewed.decision.content.relation)}</dd></div><div><dt className="font-semibold">Visual properties</dt><dd>{reviewed.decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')}</dd></div><div><dt className="font-semibold">Eligible stages</dt><dd>{normalizeTrainingStages(reviewed.decision.content.applicability?.stages).length ? normalizeTrainingStages(reviewed.decision.content.applicability?.stages).map(trainingStageLabel).join(', ') : 'Not recorded'}</dd></div><div><dt className="font-semibold">Decision</dt><dd>{reviewed.decision.content.summary}</dd></div><div><dt className="font-semibold">Immutable digest</dt><dd className="break-all">{reviewed.decision.recordDigest}</dd></div></dl>
      <p><span className="font-semibold">Selection priority:</span> {reviewed.decision.content.applicability?.priority ?? 'Not recorded'}. Higher priorities rank first among eligible examples for the same quality property and relation; equal priorities retain the existing tie-break. This does not guarantee selection or override checks, criteria or facts.</p>
      {!reviewed.readOnly&&<>
      {reviewed.decision.state === 'draft' && <><label className="flex gap-3"><input type="checkbox" checked={acceptConfirmed} disabled={!!busy} onChange={(event) => setAcceptConfirmed(event.target.checked)} />{installationId?"I reviewed this exact frame and confirm this preference wording, including any agent-suggested wording, for my future runs only.":"I reviewed this exact frame and decision and want it eligible for future Manager selection."}</label><button disabled={!!busy || !acceptConfirmed} onClick={acceptReviewed}>Accept this exact decision</button></>}
      {reviewed.decision.state === 'accepted' && <>
        {!installationId && <section className="rounded border border-ink-700 p-3 space-y-2" aria-labelledby="teaching-delivery-heading">
          <h3 id="teaching-delivery-heading" className="font-semibold">When to share this teaching</h3>
          <p>Current delivery: {reviewed.decision.deliveryMode === 'standing' ? 'At stage start' : 'On question'}.</p>
          <p className="text-sm">Applies to new runs when this teaching is selected for an eligible stage. Up to two selected teachings can be shared at stage start, within the existing image budget; others stay available on question. This does not change selection priority, stage eligibility or quality gates. Active runs keep their frozen setting.</p>
          <div className="flex flex-wrap gap-3">
            <button disabled={!!busy || versionChanged || !['accepted', 'rejected'].includes(reviewed.decision.content.relation) || reviewed.decision.deliveryMode === 'standing'} onClick={() => setReviewedDelivery('standing')}>Use at stage start</button>
            <button disabled={!!busy || versionChanged || !['accepted', 'rejected'].includes(reviewed.decision.content.relation) || (reviewed.decision.deliveryMode || 'on_question') === 'on_question'} onClick={() => setReviewedDelivery('on_question')}>Use only on question</button>
          </div>
          {!['accepted', 'rejected'].includes(reviewed.decision.content.relation) && <p>Stage-start delivery currently supports positive and negative full-frame image examples. This teaching keeps its existing delivery behavior.</p>}
          {reviewed.decision.deliveryReceiptDigest && <p className="text-xs text-ink-500">Delivery receipt {shortId(reviewed.decision.deliveryReceiptDigest)}</p>}
        </section>}
        <label className="flex gap-3"><input type="checkbox" checked={retireConfirmed} disabled={!!busy} onChange={(event) => setRetireConfirmed(event.target.checked)} />Stop selecting this teaching for new runs. Runs already using a frozen selection keep it.</label>
        <p className="text-sm text-ink-400">A future run may need replacement training if this teaching fulfils a required reference.</p>
        <button disabled={!!busy || !retireConfirmed} onClick={() => reduceReviewedAuthority('retire')}>Stop using in new runs</button>
        {!installationId && !normalizeTrainingStages(reviewed.decision.content.applicability?.stages).includes('planning') && <div className="rounded border border-amber-500 p-3 space-y-2"><p>This immutable record does not apply during planning. Start a separate planning-scoped successor using the same decision as a draft; you must preview, save, and accept it independently.</p><button disabled={!!busy || versionChanged} onClick={() => createPlanningSuccessor(reviewed.source, reviewed.decision)}>Create planning-scoped successor</button></div>}
      </>}
      {reviewed.decision.state === 'retired' && <p>This teaching is stopped for new runs. Existing run selections remain frozen; permission can still be withdrawn below.</p>}
      {(reviewed.decision.state === 'accepted' || reviewed.decision.state === 'retired') && <>
        {!installationId && serverStorageSupported && <section className="rounded border border-ink-700 p-3 space-y-3">
          <h3 className="font-semibold">Use this teaching image on your other devices</h3>
          <p>Only this selected image is stored privately in Implexa. Your original recording stays on this Mac. The image keeps this teaching’s existing expiry and is removed after permission withdrawal or expiry. Copies already delivered to a run cannot be recalled. This does not release the teaching to other customers.</p>
          <button disabled={!!busy} onClick={()=>changeServerStorage('status')}>Check stored image</button>
          {serverStorage!==undefined && <p>{serverStorage===null?'No server copy recorded.':serverStorage.deletedAt?'Server copy removed.':serverStorage.withdrawnAt?'Further server access withdrawn. Deletion is pending.':serverStorage.storedAt?'Exact image verified and stored.':'Upload not yet confirmed.'}</p>}
          {reviewed.decision.state==='accepted' && <><label className="flex gap-3"><input type="checkbox" checked={serverConsent} disabled={!!busy} onChange={event=>setServerConsent(event.target.checked)} />Store this teaching image privately for my own future runs on other devices.</label>
          <button disabled={!!busy || !serverConsent || !reviewed.source.token || versionChanged} onClick={()=>changeServerStorage('store')}>Save teaching image to Implexa</button></>}
          <label className="flex gap-3"><input type="checkbox" checked={serverWithdrawal} disabled={!!busy} onChange={event=>setServerWithdrawal(event.target.checked)} />Stop server access and remove this server copy. Keep the original teaching and local source.</label>
          <button disabled={!!busy || !serverWithdrawal} onClick={()=>changeServerStorage('withdraw')}>Remove server copy</button>
          {serverStorageNote && <p role="status">{serverStorageNote}</p>}
        </section>}
        {!reviewed.image && <button disabled={!!busy || !reviewed.source.token || versionChanged} onClick={() => reviewDecision(reviewed.source, reviewed.decision)}>Preview exact saved frame</button>}
        <label className="flex gap-3"><input type="checkbox" checked={revokeConfirmed} disabled={!!busy} onChange={(event) => setRevokeConfirmed(event.target.checked)} />Withdraw permission for further use now, including active runs. This may interrupt them; already disclosed material cannot be recalled.</label>
        <button disabled={!!busy || !revokeConfirmed} onClick={() => reduceReviewedAuthority('revoke')}>Withdraw permission now</button>
      </>}
      </>}
      <button disabled={!!busy} onClick={() => setReviewed(null)}>Close evidence review</button>
    </section>}

    <div hidden={!installationId&&view!=='teach'}>
    {selected && <section id="recording-analysis" className={`rounded border border-ink-700 p-4 space-y-4 ${legacyControls}`}><h2>Timestamped visual decision</h2>{successorStageExpansion && <section role="status" className="rounded border border-brand-500 p-3 space-y-2"><h3 className="font-semibold">Successor stage diff</h3><p>The predecessor stages were preserved exactly. This active Agent requires this decision at: {successorStageExpansion.required.length ? successorStageExpansion.required.map(trainingStageLabel).join(', ') : 'no additional stages'}.</p>{successorStageExpansion.missing.length > 0 ? <><p>Still missing: {successorStageExpansion.missing.map(trainingStageLabel).join(', ')}. They have not been added automatically.</p><button type="button" disabled={!!busy} onClick={addRequiredSuccessorStages}>Add required stages to this successor draft</button></> : <p>All required stages are now explicitly selected. Preview and accept the new digest separately.</p>}</section>}<fieldset disabled={!!busy || versionChanged} className="space-y-4"><legend className="sr-only">Choose and explain an exact visual decision</legend><label className="block">Frame timestamp<input className="block w-full" type="range" min="0" max={Math.max(0, selected.metadata.durationMs - 1)} step="1" value={time} aria-valuetext={formatTrainingTime(time)} onChange={(event) => changeTime(Number(event.target.value))} /></label><div className="flex flex-wrap items-end gap-2"><label>Exact timestamp in milliseconds<input className="block rounded bg-ink-900 border p-2" type="number" min="0" max={Math.max(0, selected.metadata.durationMs - 1)} value={time} onChange={(event) => changeTime(Number(event.target.value))} /></label>{[-1000, -100, 100, 1000].map((delta) => <button type="button" key={delta} onClick={() => changeTime(time + delta)}>{delta > 0 ? '+' : '−'}{Math.abs(delta)} ms</button>)}</div><p aria-live="polite">Selected time {formatTrainingTime(time)} of {formatTrainingTime(selected.metadata.durationMs)}</p><button type="button" onClick={showPreview}>Preview this exact frame</button>{previewIsCurrent && preview?.image && <img src={preview.image} alt={`Training source frame at ${formatTrainingTime(preview.timeMs)}`} className="w-full" />}
      <label className="block">Evidence relation<select value={relation} onChange={(event) => { setRelation(event.target.value as TrainingRelation); setSuccessorStageExpansion(null); setDecisionKey(crypto.randomUUID()); }}>{TRAINING_RELATIONS.filter(item=>!installationId||['accepted','rejected'].includes(item)).map((item) => <option key={item} value={item}>{relationLabel(item)}</option>)}</select></label><label className="block">Visual property<select value={property} onChange={(event) => { const next = event.target.value as TrainingPropertyCode; setProperty(next); setStages(deriveTrainingStages(next).filter(stage=>!installationId||['planning','build'].includes(stage))); setSuccessorStageExpansion(null); setDecisionKey(crypto.randomUUID()); }}>{TRAINING_PROPERTY_CODES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="block">Selection priority<input className="block rounded bg-ink-900 border p-2" type="number" min="0" max="100" step="1" value={selectionPriority} aria-describedby="training-priority-help" aria-invalid={!priorityIsValid} onChange={(event) => { setSelectionPriority(event.target.value); setDecisionKey(crypto.randomUUID()); }} /></label>
      <p id="training-priority-help" className="text-sm">50 is normal. Prefer this example by choosing a higher number, up to 100. Higher priorities rank first among eligible examples for the same quality property and relation; equal priorities retain the existing tie-break. This does not widen eligible stages or properties, guarantee selection, or override checks, criteria or facts. Saved decisions stay immutable; changing a preference requires a new reviewed and accepted draft.</p>
      {!priorityIsValid && <p role="alert">Choose a whole-number priority from 0 to 100.</p>}
      {!installationId && recordingSupported && selected.metadata.mediaType==='video/mp4' && selected.metadata.durationMs<=600000 && <section className="rounded border border-ink-700 p-3 space-y-3">
        <h3>Learn from this recording</h3>
        <label className="flex gap-2"><input type="checkbox" checked={recordingConsent} onChange={event=>setRecordingConsent(event.target.checked)} />Recognize narration locally, then send the whole transcript and 12 storyboard frames to Anthropic Claude Haiku 5.5 to locate one visual preference; send its excerpt and three exact frames for an editable suggestion. The selected excerpt and lineage are kept in the private append-only Training history. Nothing is automatically admitted.</label>
        <button disabled={!!busy || suggesting || !recordingConsent || !selected.token || versionChanged || !!pendingRecordingLink} onClick={()=>findRecordingTeaching()}>Find teaching in recording</button>
        <label className="flex gap-2"><input type="checkbox" checked={agentAnalysisConsent} onChange={event=>setAgentAnalysisConsent(event.target.checked)} />Separately analyze tool use: send this recording’s recognized transcript and 12 storyboard frames to Anthropic Claude Haiku 5.5, then the selected excerpt and three frames, to suggest a capability change. Keep the suggestion and private source link in Training. This does not grant tool access, apply an agent change, or admit a teaching.</label>
        <button disabled={!!busy||suggesting||!agentAnalysisConsent||!selected.token||versionChanged||!!pendingRecordingLink||!!agentChange} onClick={()=>findRecordingTeaching(true)}>Suggest tool and method update</button>
        {agentProposal && <section className="rounded border border-brand-500 p-3 space-y-3">
          <h4>Proposed agent update — not applied</h4>
          <p>Capability: web reference research. Tool use is conditional; assessing relevance and reporting the decision is required. The existing builder must select and verify a complete operating method before it can be used.</p>
          <p className="whitespace-pre-wrap">{agentProposal.proposedChange}</p>
          {agentProposal.limitations.length>0&&<ul>{agentProposal.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul>}
          <p>Private taste is saved and accepted separately above. If you want that teaching on this version, finish its admission before requesting the edit. After the edit lands, use the existing compatible-training adoption action; merely opening a successor session does not activate old teaching.</p>
          <p>Only the generic capability instruction goes to Edit Agent. Your recording, transcript, example identities and taste wording stay out of that request. Normal Edit Agent automatically applies the generated revision after you approve this instruction; it does not show a separate generated-diff approval screen. Review the resulting definition before testing. A queued request is not a new version or proof that the tool was used.</p>
          <p>If no suitable existing method is selected, prepare a generic baseline through the existing authoring service. Only platform-written research-assessment instructions go to the model; your recording and taste are excluded. The result is a private draft, never automatically activated or shared. This is an explicit baseline choice, not a top-ranking claim.</p>
          {!agentChange&&<button disabled={!!busy||versionChanged} onClick={draftMethod}>{method?'Refresh reviewed operating method':'Draft baseline operating method'}</button>}
          {method&&<section className="space-y-2"><h4>{method.name} · {method.status} · {method.scope}</h4>
            <p>Original draft model: {method.model||'not recorded'} · exact current body {shortId(method.contentDigest)}. Later edits may have changed the draft.</p>
            <details><summary>Review the exact operating method</summary><pre className="whitespace-pre-wrap break-words text-sm">{method.content}</pre></details>
            <Link href={`/skills/${method.slug}`}>Review and activate this operating method</Link>
            <p>After using the existing activation action, refresh here. A public agent also requires the generic method to be publicly available; its private teachings are never included.</p></section>}
          {!agentChange&&<><label className="flex gap-2"><input type="checkbox" checked={agentChangeConfirmed} onChange={event=>setAgentChangeConfirmed(event.target.checked)} />Request this capability and operating-method update through normal Edit Agent. Preserve the remaining contracts and permissions.</label>
            <button disabled={!!busy||versionChanged||!agentChangeConfirmed||method?.status!=='active'} onClick={queueAgentChange}>Request this agent update</button></>}
          {agentChange&&<div role="status"><p>Edit request {shortId(agentChange.requestId)} · {agentChange.status}. The agent update is not yet verified.</p>
            {agentChange.warning&&<p>{agentChange.warning}</p>}<Link href={`/workflows/${slug}?source=generated`}>Review the agent’s edit status</Link></div>}
        </section>}
        {recording && <>
          <p>Recognized narration (Desktop-reported ASR, not a verified owner quote): {formatTrainingTime(recording.excerpt.startMs)}–{formatTrainingTime(recording.excerpt.endMs)}</p>
          <blockquote className="whitespace-pre-wrap">{recording.excerpt.text}</blockquote>
          <div className="grid gap-3 md:grid-cols-3">{recording.frames.map((frame,index)=><figure key={index}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={frame.image} alt={`Recording evidence ${index+1}`} />
            <figcaption>{formatTrainingTime(frame.timeMs)}{recording.suggestion?.frameIndex===index?' · Model choice':''}</figcaption>
            <button disabled={!!busy} onClick={()=>{setTime(frame.timeMs);setPreview({token:selected.token!,timeMs:frame.timeMs,image:frame.image});setDecisionKey(crypto.randomUUID());setSuggested(null);appliedSuggestion.current=null;
              if(recording.suggestion?.frameIndex!==index){setChosen('');setWhy('');setProcess('');setBehavior('');setSuggestionNote('Different offered frame selected. Draft manually for this frame; the model fields have been cleared.');}}}>Use this frame</button>
          </figure>)}</div>
          {!recording.suggestion && !(recording.purpose==='agent'&&agentProposal) && <button disabled={!!busy||!(recording.purpose==='agent'?agentAnalysisConsent:recordingConsent)} onClick={retryRecordingDraft}>Request draft from this excerpt only</button>}
          {recording.purpose==='agent'&&!recording.suggestion&&<button disabled={!!busy||!recordingConsent} onClick={()=>work('Drafting private taste separately',()=>requestRecordingDraft(recording,draftSnapshot,false))}>Draft a separate taste teaching from this excerpt</button>}
          {recording.suggestion && <><dl>{TEACHING_FIELDS.map(key=><div key={key}><dt>{key}</dt><dd>{recording.suggestion!.fields[key]}</dd></div>)}</dl>
            <p>Preference inferred from recognized narration; review for ASR mistakes. Stills do not establish motion or a tool procedure.</p>
            <button disabled={!!busy || !previewIsCurrent || preview?.image!==recording.frames[recording.suggestion.frameIndex].image} onClick={useRecordingSuggestion}>Use recording suggestion in editable fields</button></>}
        </>}
      </section>}
      {pendingRecordingLink && <button disabled={!!busy} onClick={()=>work('Linking the saved recording teaching',()=>linkRecording(pendingRecordingLink))}>Retry recording link</button>}
      <fieldset className="rounded border border-ink-700 p-3 space-y-2"><legend className="font-semibold">When may the Manager use this decision?</legend><p className="text-sm">Suggested from the selected visual property. Narrow or expand it deliberately. Planning must be selected for this evidence to guide decisions before tools, generation, or paid actions.</p><div className="grid gap-2">{TRAINING_STAGE_OPTIONS.filter(option=>!installationId||['planning','build'].includes(option.value)).map((option) => <label key={option.value} className="flex gap-3"><input type="checkbox" checked={stages.includes(option.value)} onChange={() => toggleStage(option.value)} /><span><span className="block">{option.label}</span><span className="block text-sm text-ink-400">{option.help}</span></span></label>)}</div><p className="text-xs text-ink-500">Routing contract {TRAINING_STAGE_ROUTING_VERSION}</p></fieldset>
      <section className="rounded border border-brand-500 p-3 space-y-2" aria-labelledby="teaching-suggestion-heading">
        <h3 id="teaching-suggestion-heading">{installationId?"Your feedback and its source":"Optional teaching suggestion"}</h3>
        <p>Use this exact frame and your annotation to draft editable visual guidance. A still cannot demonstrate motion, narration timing or a tool procedure. Manual drafting remains available.</p>
        {!questionAnswer && <div className="space-y-2">
          <label className="block">{installationId?"Your exact feedback (label any suggested wording separately)":"What should this demonstration teach?"}<textarea className="block w-full rounded bg-ink-900 border p-2" maxLength={2000} value={demoText} onChange={event => setDemoText(event.target.value)} /></label>
          <p>Your complete annotation is saved privately before drafting. Only reviewed, admitted guidance can later reach a worker. This analyzes a selected frame, not the recording's audio or full sequence.</p>
          <button type="button" disabled={!!busy || suggesting || !!pendingDemoLink || !previewIsCurrent || !demoText.trim() || demoAnnotationIsCurrent} onClick={saveDemoAnnotation}>{installationId?"Save feedback source":"Save demonstration annotation"}</button>
          {demoAnnotationIsCurrent && <p>Saved annotation {shortId(demoAnnotation?.value.annotationId)} · {shortId(demoAnnotation?.value.annotationDigest)}.</p>}
        </div>}
        {!installationId && <><label className="flex gap-2"><input type="checkbox" checked={draftConsent} onChange={event => setDraftConsent(event.target.checked)} />{questionAnswer ? 'Send this frame, the recorded question and my answer' : 'Send this frame and my saved demonstration annotation'} to Anthropic Claude Haiku 5.5 for this suggestion.</label>
        <button type="button" disabled={suggesting || !draftConsent || (!questionAnswer && !demoAnnotationIsCurrent) || !previewIsCurrent || !preview?.image || !!busy} onClick={suggestTeaching}>{suggesting ? 'Drafting suggestion…' : 'Suggest teaching from this frame'}</button>
        <p>Nothing is automatically saved or admitted. Frame bytes are sent for this call; Implexa does not store them through this operation. The suggestion and its model attribution are not retained as a separate record.</p>
        {suggested && <div className="space-y-2"><p>Drafted by {suggested.value.model}. Frame {shortId(suggested.value.binding.frameSha256)} · feedback {shortId(suggested.value.binding.feedbackSha256)} · request {shortId(suggested.value.requestId)}.</p>
          {suggested.value.fields && TEACHING_FIELDS.map(key => <p key={key}><strong>{key === 'chosen' ? 'Observed frame' : key === 'why' ? 'Trainer preference' : 'Transferable guidance'}:</strong> {suggested.value.fields![key]}</p>)}
          {suggested.value.fields && <button type="button" disabled={suggested.snapshot !== draftSnapshot || !!busy || versionChanged} onClick={useSuggestion}>Use this suggestion in editable fields</button>}
          {suggested.snapshot !== draftSnapshot && <p>Suggestion for a previous frame or edit — not applied. Request a new suggestion for your current draft.</p>}
        </div>}</>}
      </section>
      {installationId&&<h3>Preference wording — confirm or edit</h3>}
      <TrainingDetails title={wordingOpened?'Review prepared teaching':'Advanced manual teaching'} open={Boolean(installationId)||wordingOpened}>
      {!installationId&&![chosen,why,process,behavior].every(value=>value.trim())&&<p>Use your annotation and the suggestion above to prepare the teaching wording. These detailed fields are available if you prefer to draft it manually.</p>}
      {([['What was chosen', chosen, setChosen], ['Why this choice', why, setWhy], ['Tool or process used', process, setProcess], ['Desired visual, motion or layout behavior', behavior, setBehavior]] as const).map(([label, value, set]) => <label className="block" key={label}>{label}<textarea className="block w-full rounded bg-ink-900 border p-2" maxLength={400} value={value} onChange={(event) => { set(event.target.value); setDecisionKey(crypto.randomUUID()); }} /></label>)}<button disabled={!previewIsCurrent || !priorityIsValid || stages.length === 0 || (Boolean(installationId)&&!demoAnnotationIsCurrent) || ![chosen, why, process, behavior].every((value) => value.trim())} onClick={annotate}>Save decision draft</button></TrainingDetails></fieldset><p className="text-sm">Review and accept each saved decision separately. Acceptance records immutable, stage-scoped evidence; the active agent version must independently declare matching Manager coverage before a run can use it.</p></section>}
    </div>
    {!installationId&&<div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-ink-800 pt-5 text-xs text-ink-500"><button type="button" onClick={()=>setView(view==='history'?'start':'history')} aria-expanded={view==='history'}>Questions & history</button><button type="button" onClick={()=>setView(view==='settings'?'start':'settings')} aria-expanded={view==='settings'}>Sharing & settings</button><TrainingInfo label="Version details">Active version: {shortId(currentVersion)}{sessionVersion?` · Session version: ${shortId(sessionVersion)}`:''}</TrainingInfo></div>}
    </div>
    {!installationId&&<aside id="training-companion" hidden={!chatExpanded} className="fixed inset-x-3 top-4 z-40 min-w-0 rounded-xl bg-ink-950 shadow-2xl lg:sticky lg:inset-auto lg:top-6 lg:z-auto lg:shadow-none" onKeyDown={e=>{if(e.key==='Escape'){setChatExpanded(false);document.getElementById('training-chat-toggle')?.focus();}}}>
      {session?<TrainingChat embedded onClose={()=>{setChatExpanded(false);document.getElementById('training-chat-toggle')?.focus();}} sessionId={session} versionId={currentVersion} slug={slug} sources={sources}
        selectedSourceId={selected?.sourceId||null} disabled={!!busy||changesBusy||versionChanged} busy={!!busy} onAttach={()=>{setChatExpanded(false);setConsent(false);setDiscardDraftConfirmed(false);setUploadOpen(true);}}
        guided={!!changes} automaticInclusion={changes?.policy.enabled===true} request={chatRequest} onSaved={()=>loadChanges()}
        onSelectSource={id=>{const source=sources.find(s=>s.sourceId===id);if(source){setChatExpanded(false);chooseSource(source);}else{setSelected(null);setPreview(null);setReviewed(null);}}}
        onAction={chatAction}/>:<div className="rounded-xl border border-ink-800 p-5 text-sm text-ink-400"><div className="flex items-center justify-between"><p>Chat with Implexa</p><button type="button" aria-label="Close chat" onClick={()=>setChatExpanded(false)}>×</button></div><button type="button" className="btn-outline mt-3" disabled={!!busy||!currentVersion||versionChanged} onClick={()=>void startPrivateTraining()}>Start private training</button></div>}
    </aside>}
    </div>
    {!installationId&&<Modal open={uploadOpen} onClose={()=>setUploadOpen(false)} title="Upload and annotate Video/Image">
      <label className="flex items-start gap-3 text-sm leading-6 text-ink-300"><input type="checkbox" className="mt-1" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I created this source and consent to local custody, saving bounded frame evidence for one year, and relevant future evidence selection. The original stays on this computer.</span></label>
      {[demoText,chosen,why,process,behavior].some(s=>s.trim())&&<label className="mt-4 flex items-start gap-3 text-sm leading-6 text-ink-300"><input type="checkbox" className="mt-1" checked={discardDraftConfirmed} onChange={e=>setDiscardDraftConfirmed(e.target.checked)}/><span>Discard my unsaved annotation and wording before opening a new source. Saved feedback and the recorded question stay available.</span></label>}
      <p className="mt-4 text-xs text-ink-400">MP4, PNG, JPEG or WebP.</p>
      <button type="button" className="btn-primary mt-5" disabled={!!busy||!consent||([demoText,chosen,why,process,behavior].some(s=>s.trim())&&!discardDraftConfirmed)} onClick={()=>{if(discardDraftConfirmed){setDemoText('');setChosen('');setWhy('');setProcess('');setBehavior('');}setUploadOpen(false);void add(true);}}>Choose video or image</button>
    </Modal>}
    {!installationId&&changes&&<GuidedPublicationReview open={publicationReviewOpen} value={changes} busy={!!busy||changesBusy||versionChanged} error={changesError}
      onClose={()=>setPublicationReviewOpen(false)} onPrepare={preparePublication} onPublish={publishPreparedSnapshot} onReviewExample={reviewPublicationExample}
      onTest={preview=>prepareCandidateTest(preview.candidateSnapshotDigest,'public_projection',preview.snapshotDigest,preview)}/>}
  </main>;
}
