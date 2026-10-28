'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { answerReceipt, questionGroups, questionsPage, type QuestionAnswer, type QuestionsPage } from '@/lib/trainer-questions';
import { teachingDigest, teachingFrame, teachingSuggestion, teachingFailure, TEACHING_FIELDS, type TeachingSuggestion } from '@/lib/training-teaching-draft';
import {
  deriveTrainingStages,
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
type Decision = {
  recordId: string;
  recordDigest: string;
  state: DecisionState;
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
  agent: { name?: string; currentVersionId: string | null };
  session?: { sessionId: string; baseVersionId: string; parentSessionId?: string | null; terminal: boolean };
};
type Result = {
  ok: boolean;
  reason?: string;
  sessionId?: string;
  baseVersionId?: string;
  parentSessionId?: string | null;
  home?: Home;
  scope?: Scope;
  sources?: Source[];
  image?: string;
  recordId?: string;
  recordDigest?: string;
  state?: DecisionState;
  failedDrafts?: LocalDraft[];
  pendingDecisions?: LocalDraft[];
  managerCoverage?: ManagerTrainingCoverage;
  managerTrainingRequirements?: ManagerTrainingRequirements;
};
type Bridge = {
  trainingLocalContractVersion?: string;
  trainingLocal: (operation: string, args: unknown) => Promise<Result>;
};
type Preview = { token: string; timeMs: number; image: string };
type ReviewedDecision = { source: Source; decision: Decision; image: string | null };
type VersionTransition = { fromVersion: string; sources: Source[] };

class TrainingError extends Error {
  constructor(readonly reason: string, message?: string) { super(message || reason); }
}

const bridge = () => (window as unknown as { implexaDesktop?: Bridge }).implexaDesktop;
const shortId = (value: string | null | undefined) => value ? value.slice(0, 8) : 'none';
const relationLabel = (relation: TrainingRelation) => ({ accepted: 'Positive example', rejected: 'Negative example', contrast: 'Contrastive example', exception: 'Exception' })[relation];
const reasonLabel = (reason: string) => reason.replaceAll('_', ' ');
const coveragePairKey = (pair: { stage: string; property: string; relation: string }) => `${pair.stage}:${pair.property}:${pair.relation}`;

function resolveBridge() {
  const candidate = bridge();
  if (!candidate?.trainingLocal) throw new TrainingError('training_desktop_required', 'Open this page in an updated Implexa Desktop to select a local training source.');
  if (candidate.trainingLocalContractVersion !== TRAINING_LOCAL_CONTRACT_VERSION) {
    throw new TrainingError('training_desktop_update_required', 'Update Implexa Desktop before training. This page requires the local training v2 bridge.');
  }
  return candidate;
}

export default function TrainingSource({ slug }: { slug: string }) {
  const [retention] = useState(() => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCMilliseconds(0); return d.toISOString(); });
  const [session, setSession] = useState('');
  const [sessionVersion, setSessionVersion] = useState('');
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [agentName, setAgentName] = useState(slug);
  const [versionChanged, setVersionChanged] = useState(false);
  const [transitionConfirmed, setTransitionConfirmed] = useState(false);
  const [versionTransition, setVersionTransition] = useState<VersionTransition | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<Source | null>(null);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState<ReviewedDecision | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const [acceptConfirmed, setAcceptConfirmed] = useState(false);
  const [retireConfirmed, setRetireConfirmed] = useState(false);
  const [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const [time, setTime] = useState(0);
  const [relation, setRelation] = useState<TrainingRelation>('accepted');
  const [property, setProperty] = useState<TrainingPropertyCode>('motion_rhythm');
  const [stages, setStages] = useState<TrainingStage[]>(() => deriveTrainingStages('motion_rhythm'));
  const [managerCoverage, setManagerCoverage] = useState<ManagerTrainingCoverage | null>(null);
  const [managerTrainingRequirements, setManagerTrainingRequirements] = useState<ManagerTrainingRequirements | null>(null);
  const [successorStageExpansion, setSuccessorStageExpansion] = useState<{ required: TrainingStage[]; missing: TrainingStage[] } | null>(null);
  const [chosen, setChosen] = useState('');
  const [why, setWhy] = useState('');
  const [process, setProcess] = useState('');
  const [behavior, setBehavior] = useState('');
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
  const [draftConsent, setDraftConsent] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<{ value: TeachingSuggestion; snapshot: string } | null>(null);
  const [suggestionNote, setSuggestionNote] = useState('');
  const appliedSuggestion = useRef<TeachingSuggestion | null>(null);
  const previewIdentity = useMemo(() => crypto.randomUUID(), [preview]);
  const draftSnapshot = JSON.stringify({ session, sessionVersion, currentVersion, versionChanged, token: selected?.token, sourceId: selected?.sourceId,
    time, previewIdentity, property, stages, relation, chosen, why, process, behavior, answer: questionAnswer });
  const latestDraft = useRef(draftSnapshot); latestDraft.current = draftSnapshot;
  useEffect(() => { setDraftConsent(false); }, [preview?.image, selected?.sourceId, time, questionAnswer, session, currentVersion]);
  const previewIsCurrent = useMemo(() => previewMatches(preview, selected?.token, time), [preview, selected, time]);
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

  async function call(operation: string, args: unknown) {
    const result = await resolveBridge().trainingLocal(operation, args);
    if (!result.ok) throw new TrainingError(result.reason || 'training_unavailable', result.reason || 'Training is unavailable. Your draft is preserved.');
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
      const result = await call('home', { slug });
      if (!live || !result.home) return;
      const home = result.home;
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
  }, [slug]);

  useEffect(() => { if (reviewed) reviewHeadingRef.current?.focus(); }, [reviewed]);

  async function add() {
    await work('Verifying the selected source and saving its identity', async () => {
      let id = session;
      if (!id) {
        const before = await requireCurrentScope('');
        const created = await call('create', { slug, key: sessionKey });
        if (!created.sessionId) throw new TrainingError('training_session_unavailable');
        id = created.sessionId; setSession(id);
        const after = await requireCurrentScope(id);
        if (after.agent.currentVersionId !== before.agent.currentVersionId) throw new TrainingError('training_version_changed');
      } else await requireCurrentScope(id);
      await call('select', { sessionId: id, consent: { localCustody: true, boundedEvidence: true, futureSelection: true } });
      await requireCurrentScope(id); await load(id);
    });
  }

  function chooseSource(source: Source) {
    setSelected(source); setTime(0); setPreview(null); setReviewed(null); setSuccessorStageExpansion(null); setDecisionKey(crypto.randomUUID());
    setSelectionPriority('50');
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

  async function suggestTeaching() {
    if (!selected?.token || !previewIsCurrent || !preview || !questionAnswer || !draftConsent || suggesting) return;
    const source = selected, frame = preview, answer = questionAnswer, snapshot = draftSnapshot;
    setSuggesting(true); setSuggestionNote(''); setSuggested(null);
    try {
      await requireCurrentScope();
      if (latestDraft.current !== snapshot) throw Error('The frame or draft changed. No suggestion was requested.');
      const [frameSha256, feedbackSha256] = await Promise.all([teachingDigest(teachingFrame(frame.image)), teachingDigest(new TextEncoder().encode(answer.rawAnswer))]);
      if (latestDraft.current !== snapshot) throw Error('The frame or draft changed. No suggestion was requested.');
      const binding = { sourceId: source.sourceId, sourceSha256: source.metadata.sha256, timeMs: frame.timeMs, frameSha256, feedbackSha256,
        questionReceiptId: answer.questions[0].id, questionReceiptDigest: answer.questions[0].receiptDigest, expectedActiveVersionId: answer.expectedActiveVersionId };
      const { feedbackSha256: _localHash, ...wire } = binding;
      const response = await fetch(`/api/agent-training/teaching-suggestion?sessionId=${encodeURIComponent(session)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ ...wire, image: frame.image, feedback: answer.rawAnswer, consent: true }) });
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
    if (!selected?.token || !previewIsCurrent || !priorityIsValid) return;
    const source = selected; const requestedTime = time; const requestedPreview = preview;
    await work('Saving the visual decision draft', async () => {
      const scope = await requireCurrentScope();
      if (!requestedPreview || requestedPreview.token !== source.token || requestedPreview.timeMs !== requestedTime) throw new TrainingError('training_preview_stale', 'Preview this exact timestamp again before saving.');
      if (questionAnswer && questionAnswer.expectedActiveVersionId !== scope.agent.currentVersionId) throw new TrainingError('training_version_changed');
      const drafted = await call('annotate', {
        token: source.token, timeMs: requestedTime, idempotencyKey: decisionKey,
        decision: { chosen, why, process, desiredBehavior: behavior },
        content: {
          relation, properties: [property], mustNotCopy: ['source text', 'source logos', 'protected identity'],
          applicability: { taskFacts: [], stages: normalizeTrainingStages(stages), exceptions: [], priority: Number(selectionPriority) },
          governance: { rightsBasis: 'owner_created', rightsReceipt: 'Coach confirms ownership and grants bounded evidence use', disclosure: 'owner_private', retentionUntil: retention, deletionPolicy: 'revoke_then_delete_derivatives', consent: true, attribution: '' },
        },
      });
      const answerLink = questionAnswer && drafted.recordId && drafted.recordDigest
        ? { answer: questionAnswer, sessionId: session, recordId: drafted.recordId, recordDigest: drafted.recordDigest } : null;
      if (answerLink) setPendingAnswerLinks(answerLink);
      setDecisionKey(crypto.randomUUID()); setPreview(null); setChosen(''); setWhy(''); setProcess(''); setBehavior(''); setSelectionPriority('50'); setStages(deriveTrainingStages(property)); setSuccessorStageExpansion(null);
      const saved = await load(session);
      if (appliedSuggestion.current) {
        const record = saved.sources?.flatMap(s => s.decisions).find(d => d.recordId === drafted.recordId);
        setSuggestionNote(record?.content.derivatives?.[0]?.sha256 === appliedSuggestion.current.binding.frameSha256
          ? 'Saved teaching evidence matches the suggestion frame. The saved text remains your reviewed draft; model authorship is not durably recorded.'
          : 'The draft was saved, but its evidence could not be matched to the suggestion frame. Do not treat the suggestion as describing this saved evidence.');
        appliedSuggestion.current = null;
      }
      if (questionAnswer) {
        if (!drafted.recordId || !drafted.recordDigest) throw new TrainingError('question_answer_link_unavailable', 'The draft was saved, but no verifiable teaching identity was returned. Select that existing draft to link the answer.');
        await linkAnswers(answerLink!);
      }
    });
  }

  async function reviewDecision(source: Source, decision: Decision) {
    if (!source.token) return;
    await work('Opening the exact saved evidence', async () => {
      await requireCurrentScope();
      const result = await call('decisionPreview', { token: source.token, recordId: decision.recordId });
      if (result.recordId !== decision.recordId || result.recordDigest !== decision.recordDigest || !result.image) throw new TrainingError('training_decision_preview_mismatch', 'The saved evidence identity could not be verified.');
      setReviewed({ source, decision, image: result.image }); setAcceptConfirmed(false); setRetireConfirmed(false); setRevokeConfirmed(false);
    });
  }

  function manageDecision(source: Source, decision: Decision) {
    setReviewed({ source, decision, image: null }); setAcceptConfirmed(false); setRetireConfirmed(false); setRevokeConfirmed(false);
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

  async function discardDraft(draft: LocalDraft) {
    await work('Discarding the local draft', async () => {
      await call('discardDraft', { token: draft.token, ...(draft.key ? { decisionKey: draft.key } : {}) });
      if (session) await load(session);
    });
  }

  return <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-12 space-y-6">
    <Link href="/training">← Training</Link>
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Train {agentName}</h1><p className="text-sm text-ink-400">Active version: {shortId(currentVersion)}{sessionVersion ? ` · Session version: ${shortId(sessionVersion)}` : ''}</p></header>
    <p>Teach visual decisions from your own video or image without starting a run. Accepted decisions are eligible only for the exact agent version and stages shown here, and can later be stopped for new runs or have permission withdrawn.</p>
    {suggestionNote && <p role="status">{suggestionNote}</p>}
    <section className="rounded border border-ink-700 p-4 space-y-3" aria-labelledby="trainer-questions-heading">
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
    </section>
    {versionChanged && <section role={activeVersionTrainingIsReady ? 'status' : 'alert'} className={`rounded border p-4 space-y-3 ${activeVersionTrainingIsReady ? 'border-emerald-600' : 'border-amber-500'}`}><h2 className="font-semibold">{activeVersionTrainingIsReady ? 'Active-version Manager training is ready' : 'Move reviewed evidence to the active version explicitly'}</h2>{activeVersionTrainingIsReady ? <><p>This historical session and its accepted decisions remain immutable on {shortId(sessionVersion)}. The active version {shortId(currentVersion)} can select the same evidence through explicit immutable adoption receipts; all {managerTrainingRequirements?.requiredPairs.length || 0} critical request-admission visual-reference routes are fulfilled. First launch still verifies every declared reference.</p><p>No new successor training session is required to run this Agent. Start one only when you want to change or add training evidence for the active version.</p></> : <><p>This session and its accepted decisions remain immutable on {shortId(sessionVersion)}. The active version is {shortId(currentVersion)} and cannot select those records. Start a separate successor session, re-select the exact source, and review each new decision before accepting it.</p><label className="flex gap-3"><input type="checkbox" checked={transitionConfirmed} disabled={!!busy} onChange={(event) => setTransitionConfirmed(event.target.checked)} />I understand this creates new evidence records for the active version and does not change or automatically accept the existing records.</label><button disabled={!!busy || !transitionConfirmed || !currentVersion} onClick={beginVersionSuccessor}>Start successor training session</button></>}</section>}
    <label className="flex gap-3"><input type="checkbox" checked={consent} disabled={!!busy || versionChanged} onChange={(event) => setConsent(event.target.checked)} />I created this source and consent to local custody, saving bounded frame evidence for one year, and relevant future evidence selection. The original stays on this computer. I can stop future selection or withdraw permission below.</label>
    <button className="btn-primary" disabled={!consent || !!busy || versionChanged || !currentVersion} onClick={add}>Add training source</button>
    {busy && <p role="status" aria-live="polite">{busy}… Large files can take several minutes.</p>}{error && <p role="alert">{reasonLabel(error)}</p>}
    {acceptedEvidenceCount > 0 && <p role="status" className="rounded border border-emerald-600 p-3">Evidence accepted: {acceptedEvidenceCount} immutable decision{acceptedEvidenceCount === 1 ? '' : 's'} in this session. Acceptance preserves the teaching; Agent readiness is verified separately below.</p>}
    {currentVersion && !requirementsAreCurrent && !activeVersionTrainingIsReady && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Manager reference training readiness unavailable</h2><p>Implexa cannot verify the required stage and quality-reference pairs for this exact active version. Accepted evidence remains preserved. Decision, procedure, criterion, and machine-custody requirements are verified separately at run prelaunch.</p></section>}
    {trainingNeedsCoach && managerTrainingRequirements && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Evidence accepted — reference training not ready</h2><p>The immutable Agent policy still requires accepted visual-reference evidence at the stage/property routes below. Create or explicitly expand successor drafts, review their exact evidence, and accept each new digest. Implexa does not silently widen an accepted record. Other Manager families are verified separately before a run starts.</p><ul className="list-disc pl-5">{managerTrainingRequirements.missingPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)}</li>)}</ul></section>}
    {(acceptedEvidenceCount > 0 || (managerCoverage?.acceptedLocalRecordCount || 0) > 0) && !coverageCanClaimReady && !coverageNeedsUpdate && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Manager coverage status unavailable</h2><p>Implexa cannot prove that this exact agent version can consume the accepted evidence across its training sessions. Update Desktop or reload after the coverage service is available. The evidence remains preserved, but this page will not describe it as ready for a run.</p></section>}
    {coverageNeedsUpdate && managerCoverage && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Agent update required before this evidence can guide runs</h2><p>{managerCoverage.reason === 'manager_quality_coverage_unclassified_training' ? 'This version has no Manager training-coverage policy.' : 'This version does not cover every accepted evidence property, relation, and stage.'} This is the version-wide result across all training sessions for this immutable agent version. Your accepted evidence remains immutable and preserved, but uncovered decisions cannot be selected at planning or any other uncovered stage.</p><p>Publish a new immutable agent version with Manager v3 coverage for the listed evidence. Existing accepted records will not be rewritten.</p>{managerCoverage.uncoveredPairs.length > 0 && <ul className="list-disc pl-5">{managerCoverage.uncoveredPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)}</li>)}</ul>}</section>}
    {coverageCanClaimReady && managerCoverage?.contractVersion === 'manager-training-coverage.v1' && <p role="status" className="rounded border border-emerald-600 p-3">This immutable agent version classifies all {managerCoverage.acceptedPairs.length} accepted stage-scoped evidence routes across all training sessions.</p>}
    {coverageCanClaimReady && managerCoverage?.contractVersion === 'manager-training-coverage.v2' && <section role="status" className="rounded border border-ink-700 p-3 space-y-2"><h2 className="font-semibold">Private training routing available</h2><p>{managerCoverage.coveredPairs.length} required-policy routes · {managerCoverage.optionalPairs.length} optional taste routes. Optional taste can guide supported decisions without editing this agent. Each run selects a bounded set; eligibility does not mean an example was selected or applied.</p>{managerCoverage.optionalPairs.length > 0 && <ul className="list-disc pl-5">{managerCoverage.optionalPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)} · Optional taste</li>)}</ul>}{managerCoverage.unsupportedPairs.length > 0 && <div className="text-amber-400"><p>{managerCoverage.unsupportedPairs.length} accepted routes are not supported by this routing policy. They remain saved, are not selected through optional routing, and do not block other supported training.</p><ul className="list-disc pl-5">{managerCoverage.unsupportedPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)} · Unsupported</li>)}</ul></div>}</section>}
    {coverageCanClaimReady && trainingIsReady && managerTrainingRequirements && <p role="status" className="rounded border border-emerald-600 p-3">Manager reference training ready: all {managerTrainingRequirements.requiredPairs.length} critical request-admission visual-reference routes are explicitly fulfilled for this immutable version. This preflight does not cover every declared reference; first launch verifies all declared references, decisions, procedures, criteria, custody, and the exact selected evidence set.</p>}

    {versionTransition && <section className="rounded border border-brand-500 p-4 space-y-3" aria-labelledby="version-successor-heading"><h2 id="version-successor-heading" className="font-semibold">Recreate reviewed decisions for {shortId(sessionVersion)}</h2><p>The records below remain bound to {shortId(versionTransition.fromVersion)}. Re-add the exact source file; Implexa enables a successor only after its SHA-256 matches. The copied text and stages are only a draft. You must preview the exact frame, save it, review the new immutable digest, and accept it again before Manager readiness can include it.</p><ul className="space-y-3">{versionTransition.sources.flatMap((oldSource) => oldSource.decisions.filter((decision) => decision.state === 'accepted').map((decision) => { const matched = sources.find((candidate) => candidate.metadata.sha256 === oldSource.metadata.sha256); const alreadyCreated = matched?.decisions.some((candidate) => candidate.content.relation === decision.content.relation && candidate.content.anchor.startMs === decision.content.anchor.startMs && candidate.content.summary === decision.content.summary); return <li key={decision.recordId} className="rounded border border-ink-700 p-3 space-y-2"><p>{formatTrainingTime(decision.content.anchor.startMs)} · {decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')} · from digest {shortId(decision.recordDigest)}</p>{!matched && <p>Re-add source SHA-256 {shortId(oldSource.metadata.sha256)} to continue.</p>}{alreadyCreated ? <p role="status">A distinct successor draft or accepted record already exists in this session.</p> : <button disabled={!!busy || !matched} onClick={() => matched && prepareVersionSuccessor(matched, decision)}>Prepare new-version successor draft</button>}</li>; }))}</ul></section>}

    {failed.map((draft) => <section key={draft.token} className="rounded border border-ink-700 p-3" aria-label="Preserved source draft"><p>Preserved source draft: {reasonLabel(draft.reason)}</p>{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying registration', async () => { await requireCurrentScope(); await call('register', { token: draft.token }); await load(session); })}>Retry registration</button> : <p>This refusal cannot be fixed by retrying the same file. Choose a different source or discard this local draft.</p>}{!draft.retryable && <button disabled={!!busy} onClick={() => discardDraft(draft)}>Discard local draft</button>}</section>)}
    {pending.map((draft) => <section key={`${draft.token}:${draft.key}`} className="rounded border border-ink-700 p-3" aria-label="Preserved decision draft"><p>Preserved decision: {reasonLabel(draft.reason)}</p>{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying saved decision', async () => { await requireCurrentScope(); await call('retryDraft', { token: draft.token, key: draft.key }); await load(session); })}>Retry saved decision</button> : <><p>This refusal cannot be fixed by sending the same decision again.</p><button disabled={!!busy} onClick={() => discardDraft(draft)}>Discard local draft</button></>}</section>)}

    {sources.map((source, index) => <section key={source.sourceId} className="rounded border border-ink-700 p-4 space-y-3"><h2>Source {index + 1} · Owner demonstration · {source.metadata.mediaType}</h2><p className="text-sm text-ink-400">{source.localName ? `${source.localName} · ` : ''}{source.metadata.width}×{source.metadata.height} · {formatTrainingTime(source.metadata.durationMs)} · SHA-256 {shortId(source.metadata.sha256)}</p><button disabled={!source.token || !!busy || versionChanged} onClick={() => chooseSource(source)}>Annotate source</button>{!source.token && <p>Local evidence is on another computer or unavailable.</p>}
      <ul className="divide-y divide-ink-800">{source.decisions.map((decision) => { const decisionStages = normalizeTrainingStages(decision.content.applicability?.stages); return <li key={decision.recordId} className="py-3 space-y-2"><p>{formatTrainingTime(decision.content.anchor.startMs)} · {decision.state} · {relationLabel(decision.content.relation)}</p><p>{decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')}</p><p><span className="font-semibold">Eligible stages:</span> {decisionStages.length ? decisionStages.map(trainingStageLabel).join(', ') : 'Not recorded'}</p>{decision.state === 'accepted' && !decisionStages.includes('planning') && <p className="text-amber-400">This accepted record cannot guide planning before tools or paid actions. Create a new planning-scoped decision to preserve the original record.</p>}<p>{decision.content.summary}</p><p className="text-xs text-ink-500">Evidence digest {shortId(decision.recordDigest)}</p>{(decision.state === 'draft' || decision.state === 'accepted') && <button disabled={!!busy || !source.token || versionChanged} onClick={() => reviewDecision(source, decision)}>{decision.state === 'draft' ? 'Review before accepting' : 'Review accepted evidence'}</button>}{(decision.state === 'accepted' || decision.state === 'retired') && <button disabled={!!busy} onClick={() => manageDecision(source, decision)}>Manage teaching</button>}</li>; })}</ul>
    </section>)}

    {reviewed && <section className="rounded border border-brand-500 p-4 space-y-4" aria-labelledby="decision-review-heading"><h2 ref={reviewHeadingRef} id="decision-review-heading" tabIndex={-1}>{reviewed.image ? 'Exact saved evidence' : 'Saved teaching'}</h2>{reviewed.image && <img src={reviewed.image} alt={`Saved evidence at ${formatTrainingTime(reviewed.decision.content.anchor.startMs)}`} className="w-full" />}<dl className="grid gap-2 text-sm"><div><dt className="font-semibold">Source</dt><dd>{reviewed.source.localName || `SHA-256 ${shortId(reviewed.source.metadata.sha256)}`}</dd></div><div><dt className="font-semibold">Timestamp</dt><dd>{formatTrainingTime(reviewed.decision.content.anchor.startMs)}</dd></div><div><dt className="font-semibold">Relation</dt><dd>{relationLabel(reviewed.decision.content.relation)}</dd></div><div><dt className="font-semibold">Visual properties</dt><dd>{reviewed.decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')}</dd></div><div><dt className="font-semibold">Eligible stages</dt><dd>{normalizeTrainingStages(reviewed.decision.content.applicability?.stages).length ? normalizeTrainingStages(reviewed.decision.content.applicability?.stages).map(trainingStageLabel).join(', ') : 'Not recorded'}</dd></div><div><dt className="font-semibold">Decision</dt><dd>{reviewed.decision.content.summary}</dd></div><div><dt className="font-semibold">Immutable digest</dt><dd className="break-all">{reviewed.decision.recordDigest}</dd></div></dl>
      <p><span className="font-semibold">Selection priority:</span> {reviewed.decision.content.applicability?.priority ?? 'Not recorded'}. Higher priorities rank first among eligible examples for the same quality property and relation; equal priorities retain the existing tie-break. This does not guarantee selection or override checks, criteria or facts.</p>
      {reviewed.decision.state === 'draft' && <><label className="flex gap-3"><input type="checkbox" checked={acceptConfirmed} disabled={!!busy} onChange={(event) => setAcceptConfirmed(event.target.checked)} />I reviewed this exact frame and decision and want it eligible for future Manager selection.</label><button disabled={!!busy || !acceptConfirmed} onClick={acceptReviewed}>Accept this exact decision</button></>}
      {reviewed.decision.state === 'accepted' && <>
        <label className="flex gap-3"><input type="checkbox" checked={retireConfirmed} disabled={!!busy} onChange={(event) => setRetireConfirmed(event.target.checked)} />Stop selecting this teaching for new runs. Runs already using a frozen selection keep it.</label>
        <p className="text-sm text-ink-400">A future run may need replacement training if this teaching fulfils a required reference.</p>
        <button disabled={!!busy || !retireConfirmed} onClick={() => reduceReviewedAuthority('retire')}>Stop using in new runs</button>
        {!normalizeTrainingStages(reviewed.decision.content.applicability?.stages).includes('planning') && <div className="rounded border border-amber-500 p-3 space-y-2"><p>This immutable record does not apply during planning. Start a separate planning-scoped successor using the same decision as a draft; you must preview, save, and accept it independently.</p><button disabled={!!busy || versionChanged} onClick={() => createPlanningSuccessor(reviewed.source, reviewed.decision)}>Create planning-scoped successor</button></div>}
      </>}
      {reviewed.decision.state === 'retired' && <p>This teaching is stopped for new runs. Existing run selections remain frozen; permission can still be withdrawn below.</p>}
      {(reviewed.decision.state === 'accepted' || reviewed.decision.state === 'retired') && <>
        {!reviewed.image && <button disabled={!!busy || !reviewed.source.token || versionChanged} onClick={() => reviewDecision(reviewed.source, reviewed.decision)}>Preview exact saved frame</button>}
        <label className="flex gap-3"><input type="checkbox" checked={revokeConfirmed} disabled={!!busy} onChange={(event) => setRevokeConfirmed(event.target.checked)} />Withdraw permission for further use now, including active runs. This may interrupt them; already disclosed material cannot be recalled.</label>
        <button disabled={!!busy || !revokeConfirmed} onClick={() => reduceReviewedAuthority('revoke')}>Withdraw permission now</button>
      </>}
      <button disabled={!!busy} onClick={() => setReviewed(null)}>Close evidence review</button>
    </section>}

    {selected && <section className="rounded border border-ink-700 p-4 space-y-4"><h2>Timestamped visual decision</h2>{successorStageExpansion && <section role="status" className="rounded border border-brand-500 p-3 space-y-2"><h3 className="font-semibold">Successor stage diff</h3><p>The predecessor stages were preserved exactly. This active Agent requires this decision at: {successorStageExpansion.required.length ? successorStageExpansion.required.map(trainingStageLabel).join(', ') : 'no additional stages'}.</p>{successorStageExpansion.missing.length > 0 ? <><p>Still missing: {successorStageExpansion.missing.map(trainingStageLabel).join(', ')}. They have not been added automatically.</p><button type="button" disabled={!!busy} onClick={addRequiredSuccessorStages}>Add required stages to this successor draft</button></> : <p>All required stages are now explicitly selected. Preview and accept the new digest separately.</p>}</section>}<fieldset disabled={!!busy || versionChanged} className="space-y-4"><legend className="sr-only">Choose and explain an exact visual decision</legend><label className="block">Frame timestamp<input className="block w-full" type="range" min="0" max={Math.max(0, selected.metadata.durationMs - 1)} step="1" value={time} aria-valuetext={formatTrainingTime(time)} onChange={(event) => changeTime(Number(event.target.value))} /></label><div className="flex flex-wrap items-end gap-2"><label>Exact timestamp in milliseconds<input className="block rounded bg-ink-900 border p-2" type="number" min="0" max={Math.max(0, selected.metadata.durationMs - 1)} value={time} onChange={(event) => changeTime(Number(event.target.value))} /></label>{[-1000, -100, 100, 1000].map((delta) => <button type="button" key={delta} onClick={() => changeTime(time + delta)}>{delta > 0 ? '+' : '−'}{Math.abs(delta)} ms</button>)}</div><p aria-live="polite">Selected time {formatTrainingTime(time)} of {formatTrainingTime(selected.metadata.durationMs)}</p><button type="button" onClick={showPreview}>Preview this exact frame</button>{previewIsCurrent && preview?.image && <img src={preview.image} alt={`Training source frame at ${formatTrainingTime(preview.timeMs)}`} className="w-full" />}
      <label className="block">Evidence relation<select value={relation} onChange={(event) => { setRelation(event.target.value as TrainingRelation); setSuccessorStageExpansion(null); setDecisionKey(crypto.randomUUID()); }}>{TRAINING_RELATIONS.map((item) => <option key={item} value={item}>{relationLabel(item)}</option>)}</select></label><label className="block">Visual property<select value={property} onChange={(event) => { const next = event.target.value as TrainingPropertyCode; setProperty(next); setStages(deriveTrainingStages(next)); setSuccessorStageExpansion(null); setDecisionKey(crypto.randomUUID()); }}>{TRAINING_PROPERTY_CODES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="block">Selection priority<input className="block rounded bg-ink-900 border p-2" type="number" min="0" max="100" step="1" value={selectionPriority} aria-describedby="training-priority-help" aria-invalid={!priorityIsValid} onChange={(event) => { setSelectionPriority(event.target.value); setDecisionKey(crypto.randomUUID()); }} /></label>
      <p id="training-priority-help" className="text-sm">50 is normal. Prefer this example by choosing a higher number, up to 100. Higher priorities rank first among eligible examples for the same quality property and relation; equal priorities retain the existing tie-break. This does not widen eligible stages or properties, guarantee selection, or override checks, criteria or facts. Saved decisions stay immutable; changing a preference requires a new reviewed and accepted draft.</p>
      {!priorityIsValid && <p role="alert">Choose a whole-number priority from 0 to 100.</p>}
      <fieldset className="rounded border border-ink-700 p-3 space-y-2"><legend className="font-semibold">When may the Manager use this decision?</legend><p className="text-sm">Suggested from the selected visual property. Narrow or expand it deliberately. Planning must be selected for this evidence to guide decisions before tools, generation, or paid actions.</p><div className="grid gap-2">{TRAINING_STAGE_OPTIONS.map((option) => <label key={option.value} className="flex gap-3"><input type="checkbox" checked={stages.includes(option.value)} onChange={() => toggleStage(option.value)} /><span><span className="block">{option.label}</span><span className="block text-sm text-ink-400">{option.help}</span></span></label>)}</div><p className="text-xs text-ink-500">Routing contract {TRAINING_STAGE_ROUTING_VERSION}</p></fieldset>
      {questionAnswer && <section className="rounded border border-brand-500 p-3 space-y-2" aria-labelledby="teaching-suggestion-heading">
        <h3 id="teaching-suggestion-heading">Optional teaching suggestion</h3>
        <p>Use this exact frame and your complete answer to draft editable guidance. A still cannot demonstrate motion, narration timing or a tool procedure. Manual drafting remains available.</p>
        <label className="flex gap-2"><input type="checkbox" checked={draftConsent} onChange={event => setDraftConsent(event.target.checked)} />Send this frame, the recorded question and my answer to Anthropic Claude Haiku 4.5 for this suggestion.</label>
        <button type="button" disabled={suggesting || !draftConsent || !previewIsCurrent || !preview?.image || !!busy} onClick={suggestTeaching}>{suggesting ? 'Drafting suggestion…' : 'Suggest teaching from this frame'}</button>
        <p>Nothing is automatically saved or admitted. Frame bytes are sent for this call; Implexa does not store them through this operation. The suggestion and its model attribution are not retained as a separate record.</p>
        {suggested && <div className="space-y-2"><p>Drafted by {suggested.value.model}. Frame {shortId(suggested.value.binding.frameSha256)} · feedback {shortId(suggested.value.binding.feedbackSha256)} · request {shortId(suggested.value.requestId)}.</p>
          {suggested.value.fields && TEACHING_FIELDS.map(key => <p key={key}><strong>{key === 'chosen' ? 'Observed frame' : key === 'why' ? 'Trainer preference' : 'Transferable guidance'}:</strong> {suggested.value.fields![key]}</p>)}
          {suggested.value.fields && <button type="button" disabled={suggested.snapshot !== draftSnapshot || !!busy || versionChanged} onClick={useSuggestion}>Use this suggestion in editable fields</button>}
          {suggested.snapshot !== draftSnapshot && <p>Suggestion for a previous frame or edit — not applied. Request a new suggestion for your current draft.</p>}
        </div>}
      </section>}
      {([['What was chosen', chosen, setChosen], ['Why this choice', why, setWhy], ['Tool or process used', process, setProcess], ['Desired visual, motion or layout behavior', behavior, setBehavior]] as const).map(([label, value, set]) => <label className="block" key={label}>{label}<textarea className="block w-full rounded bg-ink-900 border p-2" maxLength={400} value={value} onChange={(event) => { set(event.target.value); setDecisionKey(crypto.randomUUID()); }} /></label>)}<button disabled={!previewIsCurrent || !priorityIsValid || stages.length === 0 || ![chosen, why, process, behavior].every((value) => value.trim())} onClick={annotate}>Save decision draft</button></fieldset><p className="text-sm">Review and accept each saved decision separately. Acceptance records immutable, stage-scoped evidence; the active agent version must independently declare matching Manager coverage before a run can use it.</p></section>}
  </main>;
}
