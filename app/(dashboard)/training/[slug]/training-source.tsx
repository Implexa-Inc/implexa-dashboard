'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
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

type DecisionState = 'draft' | 'accepted' | 'unavailable' | 'revoked';
type Decision = {
  recordId: string;
  recordDigest: string;
  state: DecisionState;
  content: { relation: TrainingRelation; properties: TrainingPropertyCode[]; summary: string; anchor: { startMs: number }; applicability?: { stages?: string[] } };
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
type ReviewedDecision = { source: Source; decision: Decision; image: string };
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
  const [pending, setPending] = useState<LocalDraft[]>([]);
  const [failed, setFailed] = useState<LocalDraft[]>([]);
  const [sessionKey] = useState(() => crypto.randomUUID());
  const [successorSessionKey] = useState(() => crypto.randomUUID());
  const [decisionKey, setDecisionKey] = useState(() => crypto.randomUUID());
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
    && managerCoverage.uncoveredPairs.length === 0
    && managerCoverage.acceptedPairs.every((pair) => managerCoverage.coveredPairs.some((covered) => coveragePairKey(covered) === coveragePairKey(pair))),
  );
  const coverageNeedsUpdate = Boolean(coverageIsCurrent && managerCoverage?.readiness === 'agent_update_required' && managerCoverage.reason);
  const requirementsAreCurrent = isManagerTrainingRequirements(managerTrainingRequirements, sessionVersion || currentVersion);
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

  async function annotate() {
    if (!selected?.token || !previewIsCurrent) return;
    const source = selected; const requestedTime = time; const requestedPreview = preview;
    await work('Saving the visual decision draft', async () => {
      await requireCurrentScope();
      if (!requestedPreview || requestedPreview.token !== source.token || requestedPreview.timeMs !== requestedTime) throw new TrainingError('training_preview_stale', 'Preview this exact timestamp again before saving.');
      await call('annotate', {
        token: source.token, timeMs: requestedTime, idempotencyKey: decisionKey,
        decision: { chosen, why, process, desiredBehavior: behavior },
        content: {
          relation, properties: [property], mustNotCopy: ['source text', 'source logos', 'protected identity'],
          applicability: { taskFacts: [], stages: normalizeTrainingStages(stages), exceptions: [], priority: 50 },
          governance: { rightsBasis: 'owner_created', rightsReceipt: 'Coach confirms ownership and grants bounded evidence use', disclosure: 'owner_private', retentionUntil: retention, deletionPolicy: 'revoke_then_delete_derivatives', consent: true, attribution: '' },
        },
      });
      setDecisionKey(crypto.randomUUID()); setPreview(null); setChosen(''); setWhy(''); setProcess(''); setBehavior(''); setStages(deriveTrainingStages(property)); setSuccessorStageExpansion(null); await load(session);
    });
  }

  async function reviewDecision(source: Source, decision: Decision) {
    if (!source.token) return;
    await work('Opening the exact saved evidence', async () => {
      await requireCurrentScope();
      const result = await call('decisionPreview', { token: source.token, recordId: decision.recordId });
      if (result.recordId !== decision.recordId || result.recordDigest !== decision.recordDigest || !result.image) throw new TrainingError('training_decision_preview_mismatch', 'The saved evidence identity could not be verified.');
      setReviewed({ source, decision, image: result.image }); setAcceptConfirmed(false); setRevokeConfirmed(false);
    });
  }

  async function acceptReviewed() {
    if (!reviewed?.source.token || !acceptConfirmed || reviewed.decision.state !== 'draft') return;
    await work('Revalidating source and accepting decision', async () => {
      await requireCurrentScope();
      await call('accept', { token: reviewed.source.token, recordId: reviewed.decision.recordId, expectedDigest: reviewed.decision.recordDigest });
      await load(session); setReviewed(null);
    });
  }

  async function revokeReviewed() {
    if (!reviewed?.source.token || !revokeConfirmed || reviewed.decision.state !== 'accepted') return;
    await work('Revoking future evidence selection', async () => {
      await requireCurrentScope();
      await call('revoke', { token: reviewed.source.token, recordId: reviewed.decision.recordId, expectedDigest: reviewed.decision.recordDigest });
      await load(session); setReviewed(null);
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
    <p>Teach visual decisions from your own video or image without starting a run. Accepted decisions are eligible only for the exact agent version and stages shown here, and can later be revoked.</p>
    {versionChanged && <section role="alert" className="rounded border border-amber-500 p-4 space-y-3"><h2 className="font-semibold">Move reviewed evidence to the active version explicitly</h2><p>This session and its accepted decisions remain immutable on {shortId(sessionVersion)}. The active version is {shortId(currentVersion)} and cannot select those records. Start a separate successor session, re-select the exact source, and review each new decision before accepting it.</p><label className="flex gap-3"><input type="checkbox" checked={transitionConfirmed} disabled={!!busy} onChange={(event) => setTransitionConfirmed(event.target.checked)} />I understand this creates new evidence records for the active version and does not change or automatically accept the existing records.</label><button disabled={!!busy || !transitionConfirmed || !currentVersion} onClick={beginVersionSuccessor}>Start successor training session</button></section>}
    <label className="flex gap-3"><input type="checkbox" checked={consent} disabled={!!busy || versionChanged} onChange={(event) => setConsent(event.target.checked)} />I created this source and consent to local custody, saving bounded frame evidence for one year, and relevant future evidence selection. The original stays on this computer. I can revoke accepted evidence below.</label>
    <button className="btn-primary" disabled={!consent || !!busy || versionChanged || !currentVersion} onClick={add}>Add training source</button>
    {busy && <p role="status" aria-live="polite">{busy}… Large files can take several minutes.</p>}{error && <p role="alert">{reasonLabel(error)}</p>}
    {acceptedEvidenceCount > 0 && <p role="status" className="rounded border border-emerald-600 p-3">Evidence accepted: {acceptedEvidenceCount} immutable decision{acceptedEvidenceCount === 1 ? '' : 's'} in this session. Acceptance preserves the teaching; Agent readiness is verified separately below.</p>}
    {currentVersion && !requirementsAreCurrent && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Manager reference training readiness unavailable</h2><p>Implexa cannot verify the required stage and quality-reference pairs for this exact active version. Accepted evidence remains preserved. Decision, procedure, criterion, and machine-custody requirements are verified separately at run prelaunch.</p></section>}
    {trainingNeedsCoach && managerTrainingRequirements && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Evidence accepted — reference training not ready</h2><p>The immutable Agent policy still requires accepted visual-reference evidence at the stage/property routes below. Create or explicitly expand successor drafts, review their exact evidence, and accept each new digest. Implexa does not silently widen an accepted record. Other Manager families are verified separately before a run starts.</p><ul className="list-disc pl-5">{managerTrainingRequirements.missingPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)}</li>)}</ul></section>}
    {(acceptedEvidenceCount > 0 || (managerCoverage?.acceptedLocalRecordCount || 0) > 0) && !coverageCanClaimReady && !coverageNeedsUpdate && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Manager coverage status unavailable</h2><p>Implexa cannot prove that this exact agent version can consume the accepted evidence across its training sessions. Update Desktop or reload after the coverage service is available. The evidence remains preserved, but this page will not describe it as ready for a run.</p></section>}
    {coverageNeedsUpdate && managerCoverage && <section role="alert" className="rounded border border-amber-500 p-4 space-y-2"><h2 className="font-semibold">Agent update required before this evidence can guide runs</h2><p>{managerCoverage.reason === 'manager_quality_coverage_unclassified_training' ? 'This version has no Manager training-coverage policy.' : 'This version does not cover every accepted evidence property, relation, and stage.'} This is the version-wide result across all training sessions for this immutable agent version. Your accepted evidence remains immutable and preserved, but uncovered decisions cannot be selected at planning or any other uncovered stage.</p><p>Publish a new immutable agent version with Manager v3 coverage for the listed evidence. Existing accepted records will not be rewritten.</p>{managerCoverage.uncoveredPairs.length > 0 && <ul className="list-disc pl-5">{managerCoverage.uncoveredPairs.map((pair) => <li key={coveragePairKey(pair)}>{trainingStageLabel(pair.stage)} · {pair.property.replaceAll('_', ' ')} · {relationLabel(pair.relation)}</li>)}</ul>}</section>}
    {coverageCanClaimReady && managerCoverage && <p role="status" className="rounded border border-emerald-600 p-3">This immutable agent version classifies all {managerCoverage.acceptedPairs.length} accepted stage-scoped evidence routes across all training sessions.</p>}
    {coverageCanClaimReady && trainingIsReady && managerTrainingRequirements && <p role="status" className="rounded border border-emerald-600 p-3">Manager reference training ready: all {managerTrainingRequirements.requiredPairs.length} required visual-reference routes are explicitly fulfilled for this immutable version. Run prelaunch still verifies decisions, procedures, criteria, custody, and the exact selected evidence set.</p>}

    {versionTransition && <section className="rounded border border-brand-500 p-4 space-y-3" aria-labelledby="version-successor-heading"><h2 id="version-successor-heading" className="font-semibold">Recreate reviewed decisions for {shortId(sessionVersion)}</h2><p>The records below remain bound to {shortId(versionTransition.fromVersion)}. Re-add the exact source file; Implexa enables a successor only after its SHA-256 matches. The copied text and stages are only a draft. You must preview the exact frame, save it, review the new immutable digest, and accept it again before Manager readiness can include it.</p><ul className="space-y-3">{versionTransition.sources.flatMap((oldSource) => oldSource.decisions.filter((decision) => decision.state === 'accepted').map((decision) => { const matched = sources.find((candidate) => candidate.metadata.sha256 === oldSource.metadata.sha256); const alreadyCreated = matched?.decisions.some((candidate) => candidate.content.relation === decision.content.relation && candidate.content.anchor.startMs === decision.content.anchor.startMs && candidate.content.summary === decision.content.summary); return <li key={decision.recordId} className="rounded border border-ink-700 p-3 space-y-2"><p>{formatTrainingTime(decision.content.anchor.startMs)} · {decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')} · from digest {shortId(decision.recordDigest)}</p>{!matched && <p>Re-add source SHA-256 {shortId(oldSource.metadata.sha256)} to continue.</p>}{alreadyCreated ? <p role="status">A distinct successor draft or accepted record already exists in this session.</p> : <button disabled={!!busy || !matched} onClick={() => matched && prepareVersionSuccessor(matched, decision)}>Prepare new-version successor draft</button>}</li>; }))}</ul></section>}

    {failed.map((draft) => <section key={draft.token} className="rounded border border-ink-700 p-3" aria-label="Preserved source draft"><p>Preserved source draft: {reasonLabel(draft.reason)}</p>{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying registration', async () => { await requireCurrentScope(); await call('register', { token: draft.token }); await load(session); })}>Retry registration</button> : <p>This refusal cannot be fixed by retrying the same file. Choose a different source or discard this local draft.</p>}{!draft.retryable && <button disabled={!!busy} onClick={() => discardDraft(draft)}>Discard local draft</button>}</section>)}
    {pending.map((draft) => <section key={`${draft.token}:${draft.key}`} className="rounded border border-ink-700 p-3" aria-label="Preserved decision draft"><p>Preserved decision: {reasonLabel(draft.reason)}</p>{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying saved decision', async () => { await requireCurrentScope(); await call('retryDraft', { token: draft.token, key: draft.key }); await load(session); })}>Retry saved decision</button> : <><p>This refusal cannot be fixed by sending the same decision again.</p><button disabled={!!busy} onClick={() => discardDraft(draft)}>Discard local draft</button></>}</section>)}

    {sources.map((source, index) => <section key={source.sourceId} className="rounded border border-ink-700 p-4 space-y-3"><h2>Source {index + 1} · Owner demonstration · {source.metadata.mediaType}</h2><p className="text-sm text-ink-400">{source.localName ? `${source.localName} · ` : ''}{source.metadata.width}×{source.metadata.height} · {formatTrainingTime(source.metadata.durationMs)} · SHA-256 {shortId(source.metadata.sha256)}</p><button disabled={!source.token || !!busy || versionChanged} onClick={() => chooseSource(source)}>Annotate source</button>{!source.token && <p>Local evidence is on another computer or unavailable.</p>}
      <ul className="divide-y divide-ink-800">{source.decisions.map((decision) => { const decisionStages = normalizeTrainingStages(decision.content.applicability?.stages); return <li key={decision.recordId} className="py-3 space-y-2"><p>{formatTrainingTime(decision.content.anchor.startMs)} · {decision.state} · {relationLabel(decision.content.relation)}</p><p>{decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')}</p><p><span className="font-semibold">Eligible stages:</span> {decisionStages.length ? decisionStages.map(trainingStageLabel).join(', ') : 'Not recorded'}</p>{decision.state === 'accepted' && !decisionStages.includes('planning') && <p className="text-amber-400">This accepted record cannot guide planning before tools or paid actions. Create a new planning-scoped decision to preserve the original record.</p>}<p>{decision.content.summary}</p><p className="text-xs text-ink-500">Evidence digest {shortId(decision.recordDigest)}</p>{(decision.state === 'draft' || decision.state === 'accepted') && <button disabled={!!busy || !source.token || versionChanged} onClick={() => reviewDecision(source, decision)}>{decision.state === 'draft' ? 'Review before accepting' : 'Review accepted evidence'}</button>}</li>; })}</ul>
    </section>)}

    {reviewed && <section className="rounded border border-brand-500 p-4 space-y-4" aria-labelledby="decision-review-heading"><h2 ref={reviewHeadingRef} id="decision-review-heading" tabIndex={-1}>Exact saved evidence</h2><img src={reviewed.image} alt={`Saved evidence at ${formatTrainingTime(reviewed.decision.content.anchor.startMs)}`} className="w-full" /><dl className="grid gap-2 text-sm"><div><dt className="font-semibold">Source</dt><dd>{reviewed.source.localName || `SHA-256 ${shortId(reviewed.source.metadata.sha256)}`}</dd></div><div><dt className="font-semibold">Timestamp</dt><dd>{formatTrainingTime(reviewed.decision.content.anchor.startMs)}</dd></div><div><dt className="font-semibold">Relation</dt><dd>{relationLabel(reviewed.decision.content.relation)}</dd></div><div><dt className="font-semibold">Visual properties</dt><dd>{reviewed.decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')}</dd></div><div><dt className="font-semibold">Eligible stages</dt><dd>{normalizeTrainingStages(reviewed.decision.content.applicability?.stages).length ? normalizeTrainingStages(reviewed.decision.content.applicability?.stages).map(trainingStageLabel).join(', ') : 'Not recorded'}</dd></div><div><dt className="font-semibold">Decision</dt><dd>{reviewed.decision.content.summary}</dd></div><div><dt className="font-semibold">Immutable digest</dt><dd className="break-all">{reviewed.decision.recordDigest}</dd></div></dl>
      {reviewed.decision.state === 'draft' && <><label className="flex gap-3"><input type="checkbox" checked={acceptConfirmed} disabled={!!busy} onChange={(event) => setAcceptConfirmed(event.target.checked)} />I reviewed this exact frame and decision and want it eligible for future Manager selection.</label><button disabled={!!busy || !acceptConfirmed} onClick={acceptReviewed}>Accept this exact decision</button></>}
      {reviewed.decision.state === 'accepted' && <><label className="flex gap-3"><input type="checkbox" checked={revokeConfirmed} disabled={!!busy} onChange={(event) => setRevokeConfirmed(event.target.checked)} />I understand revocation prevents this evidence from being selected in future runs.</label><button disabled={!!busy || !revokeConfirmed} onClick={revokeReviewed}>Revoke future selection</button>{!normalizeTrainingStages(reviewed.decision.content.applicability?.stages).includes('planning') && <div className="rounded border border-amber-500 p-3 space-y-2"><p>This immutable record does not apply during planning. Start a separate planning-scoped successor using the same decision as a draft; you must preview, save, and accept it independently.</p><button disabled={!!busy || versionChanged} onClick={() => createPlanningSuccessor(reviewed.source, reviewed.decision)}>Create planning-scoped successor</button></div>}</>}
      <button disabled={!!busy} onClick={() => setReviewed(null)}>Close evidence review</button>
    </section>}

    {selected && <section className="rounded border border-ink-700 p-4 space-y-4"><h2>Timestamped visual decision</h2>{successorStageExpansion && <section role="status" className="rounded border border-brand-500 p-3 space-y-2"><h3 className="font-semibold">Successor stage diff</h3><p>The predecessor stages were preserved exactly. This active Agent requires this decision at: {successorStageExpansion.required.length ? successorStageExpansion.required.map(trainingStageLabel).join(', ') : 'no additional stages'}.</p>{successorStageExpansion.missing.length > 0 ? <><p>Still missing: {successorStageExpansion.missing.map(trainingStageLabel).join(', ')}. They have not been added automatically.</p><button type="button" disabled={!!busy} onClick={addRequiredSuccessorStages}>Add required stages to this successor draft</button></> : <p>All required stages are now explicitly selected. Preview and accept the new digest separately.</p>}</section>}<fieldset disabled={!!busy || versionChanged} className="space-y-4"><legend className="sr-only">Choose and explain an exact visual decision</legend><label className="block">Frame timestamp<input className="block w-full" type="range" min="0" max={Math.max(0, selected.metadata.durationMs - 1)} step="1" value={time} aria-valuetext={formatTrainingTime(time)} onChange={(event) => changeTime(Number(event.target.value))} /></label><div className="flex flex-wrap items-end gap-2"><label>Exact timestamp in milliseconds<input className="block rounded bg-ink-900 border p-2" type="number" min="0" max={Math.max(0, selected.metadata.durationMs - 1)} value={time} onChange={(event) => changeTime(Number(event.target.value))} /></label>{[-1000, -100, 100, 1000].map((delta) => <button type="button" key={delta} onClick={() => changeTime(time + delta)}>{delta > 0 ? '+' : '−'}{Math.abs(delta)} ms</button>)}</div><p aria-live="polite">Selected time {formatTrainingTime(time)} of {formatTrainingTime(selected.metadata.durationMs)}</p><button type="button" onClick={showPreview}>Preview this exact frame</button>{previewIsCurrent && preview?.image && <img src={preview.image} alt={`Training source frame at ${formatTrainingTime(preview.timeMs)}`} className="w-full" />}
      <label className="block">Evidence relation<select value={relation} onChange={(event) => { setRelation(event.target.value as TrainingRelation); setSuccessorStageExpansion(null); setDecisionKey(crypto.randomUUID()); }}>{TRAINING_RELATIONS.map((item) => <option key={item} value={item}>{relationLabel(item)}</option>)}</select></label><label className="block">Visual property<select value={property} onChange={(event) => { const next = event.target.value as TrainingPropertyCode; setProperty(next); setStages(deriveTrainingStages(next)); setSuccessorStageExpansion(null); setDecisionKey(crypto.randomUUID()); }}>{TRAINING_PROPERTY_CODES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
      <fieldset className="rounded border border-ink-700 p-3 space-y-2"><legend className="font-semibold">When may the Manager use this decision?</legend><p className="text-sm">Suggested from the selected visual property. Narrow or expand it deliberately. Planning must be selected for this evidence to guide decisions before tools, generation, or paid actions.</p><div className="grid gap-2">{TRAINING_STAGE_OPTIONS.map((option) => <label key={option.value} className="flex gap-3"><input type="checkbox" checked={stages.includes(option.value)} onChange={() => toggleStage(option.value)} /><span><span className="block">{option.label}</span><span className="block text-sm text-ink-400">{option.help}</span></span></label>)}</div><p className="text-xs text-ink-500">Routing contract {TRAINING_STAGE_ROUTING_VERSION}</p></fieldset>
      {([['What was chosen', chosen, setChosen], ['Why this choice', why, setWhy], ['Tool or process used', process, setProcess], ['Desired visual, motion or layout behavior', behavior, setBehavior]] as const).map(([label, value, set]) => <label className="block" key={label}>{label}<textarea className="block w-full rounded bg-ink-900 border p-2" maxLength={400} value={value} onChange={(event) => { set(event.target.value); setDecisionKey(crypto.randomUUID()); }} /></label>)}<button disabled={!previewIsCurrent || stages.length === 0 || ![chosen, why, process, behavior].every((value) => value.trim())} onClick={annotate}>Save decision draft</button></fieldset><p className="text-sm">Review and accept each saved decision separately. Acceptance records immutable, stage-scoped evidence; the active agent version must independently declare matching Manager coverage before a run can use it.</p></section>}
  </main>;
}
