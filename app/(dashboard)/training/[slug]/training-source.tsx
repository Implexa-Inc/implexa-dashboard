'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTrainingTime, previewMatches, TRAINING_LOCAL_CONTRACT_VERSION } from '@/lib/training-local-ingress';

type Relation = 'accepted' | 'rejected' | 'contrast';
type DecisionState = 'draft' | 'accepted' | 'unavailable' | 'revoked';
type Decision = {
  recordId: string;
  recordDigest: string;
  state: DecisionState;
  content: { relation: Relation; properties: string[]; summary: string; anchor: { startMs: number } };
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
};
type Scope = {
  agent: { name?: string; currentVersionId: string | null };
  session?: { sessionId: string; baseVersionId: string; terminal: boolean };
};
type Result = {
  ok: boolean;
  reason?: string;
  sessionId?: string;
  home?: Home;
  scope?: Scope;
  sources?: Source[];
  image?: string;
  recordId?: string;
  recordDigest?: string;
  failedDrafts?: LocalDraft[];
  pendingDecisions?: LocalDraft[];
};
type Bridge = {
  trainingLocalContractVersion?: string;
  trainingLocal: (operation: string, args: unknown) => Promise<Result>;
};
type Preview = { token: string; timeMs: number; image: string };
type ReviewedDecision = { source: Source; decision: Decision; image: string };

class TrainingError extends Error {
  constructor(readonly reason: string, message?: string) { super(message || reason); }
}

const bridge = () => (window as unknown as { implexaDesktop?: Bridge }).implexaDesktop;
const shortId = (value: string | null | undefined) => value ? value.slice(0, 8) : 'none';
const relationLabel = (relation: Relation) => ({ accepted: 'Positive example', rejected: 'Negative example', contrast: 'Contrastive example' })[relation];
const reasonLabel = (reason: string) => reason.replaceAll('_', ' ');

function resolveBridge() {
  const candidate = bridge();
  if (!candidate?.trainingLocal) throw new TrainingError('training_desktop_required', 'Open this page in an updated Implexa Desktop to select a local training source.');
  if (candidate.trainingLocalContractVersion !== TRAINING_LOCAL_CONTRACT_VERSION) {
    throw new TrainingError('training_desktop_update_required', 'Update Implexa Desktop before training. This page requires the local training v1 bridge.');
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
  const [relation, setRelation] = useState<Relation>('accepted');
  const [property, setProperty] = useState('motion_rhythm');
  const [chosen, setChosen] = useState('');
  const [why, setWhy] = useState('');
  const [process, setProcess] = useState('');
  const [behavior, setBehavior] = useState('');
  const [pending, setPending] = useState<LocalDraft[]>([]);
  const [failed, setFailed] = useState<LocalDraft[]>([]);
  const [sessionKey] = useState(() => crypto.randomUUID());
  const [decisionKey, setDecisionKey] = useState(() => crypto.randomUUID());
  const previewIsCurrent = useMemo(() => previewMatches(preview, selected?.token, time), [preview, selected, time]);

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

  async function load(id: string) {
    const result = await call('list', { sessionId: id });
    const next = result.sources || [];
    setSources(next);
    setSelected((prior) => prior ? next.find((source) => source.sourceId === prior.sourceId) || null : null);
    setFailed(result.failedDrafts || []);
    setPending(result.pendingDecisions || []);
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
      setAgentName(result.home.agent.name || slug); setCurrentVersion(result.home.agent.currentVersionId);
      const prior = result.home.recentSessions.find((item) => item.sourceMode === 'raw_input' && !item.terminal && item.agent.baseVersionId === result.home?.agent.currentVersionId);
      if (prior) {
        const scoped = await call('scope', { slug, sessionId: prior.sessionId });
        if (!live || !scoped.scope?.session || scoped.scope.session.baseVersionId !== scoped.scope.agent.currentVersionId) return;
        setSession(prior.sessionId); rememberScope(scoped.scope); await load(prior.sessionId);
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
    setSelected(source); setTime(0); setPreview(null); setReviewed(null); setDecisionKey(crypto.randomUUID());
  }
  function changeTime(next: number) {
    if (!selected || !Number.isFinite(next)) return;
    setTime(Math.min(Math.max(0, Math.round(next)), Math.max(0, selected.metadata.durationMs - 1)));
    setPreview(null); setDecisionKey(crypto.randomUUID());
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
          applicability: { taskFacts: [], stages: ['preview', 'build', 'qa'], exceptions: [], priority: 50 },
          governance: { rightsBasis: 'owner_created', rightsReceipt: 'Coach confirms ownership and grants bounded evidence use', disclosure: 'owner_private', retentionUntil: retention, deletionPolicy: 'revoke_then_delete_derivatives', consent: true, attribution: '' },
        },
      });
      setDecisionKey(crypto.randomUUID()); setPreview(null); setChosen(''); setWhy(''); setProcess(''); setBehavior(''); await load(session);
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
    <p>Teach visual decisions from your own video or image without starting a run. Accepted decisions are eligible only for the exact agent version shown above and can later be revoked.</p>
    {versionChanged && <p role="alert" className="rounded border border-amber-500 p-3">The active version changed. This session is frozen to {shortId(sessionVersion)} and cannot receive more evidence. Reload to start a session for {shortId(currentVersion)}.</p>}
    <label className="flex gap-3"><input type="checkbox" checked={consent} disabled={!!busy || versionChanged} onChange={(event) => setConsent(event.target.checked)} />I created this source and consent to local custody, saving bounded frame evidence for one year, and relevant future evidence selection. The original stays on this computer. I can revoke accepted evidence below.</label>
    <button className="btn-primary" disabled={!consent || !!busy || versionChanged || !currentVersion} onClick={add}>Add training source</button>
    {busy && <p role="status" aria-live="polite">{busy}… Large files can take several minutes.</p>}{error && <p role="alert">{reasonLabel(error)}</p>}

    {failed.map((draft) => <section key={draft.token} className="rounded border border-ink-700 p-3" aria-label="Preserved source draft"><p>Preserved source draft: {reasonLabel(draft.reason)}</p>{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying registration', async () => { await requireCurrentScope(); await call('register', { token: draft.token }); await load(session); })}>Retry registration</button> : <p>This refusal cannot be fixed by retrying the same file. Choose a different source or discard this local draft.</p>}{!draft.retryable && <button disabled={!!busy} onClick={() => discardDraft(draft)}>Discard local draft</button>}</section>)}
    {pending.map((draft) => <section key={`${draft.token}:${draft.key}`} className="rounded border border-ink-700 p-3" aria-label="Preserved decision draft"><p>Preserved decision: {reasonLabel(draft.reason)}</p>{draft.retryable ? <button disabled={!!busy} onClick={() => work('Retrying saved decision', async () => { await requireCurrentScope(); await call('retryDraft', { token: draft.token, key: draft.key }); await load(session); })}>Retry saved decision</button> : <><p>This refusal cannot be fixed by sending the same decision again.</p><button disabled={!!busy} onClick={() => discardDraft(draft)}>Discard local draft</button></>}</section>)}

    {sources.map((source, index) => <section key={source.sourceId} className="rounded border border-ink-700 p-4 space-y-3"><h2>Source {index + 1} · Owner demonstration · {source.metadata.mediaType}</h2><p className="text-sm text-ink-400">{source.localName ? `${source.localName} · ` : ''}{source.metadata.width}×{source.metadata.height} · {formatTrainingTime(source.metadata.durationMs)} · SHA-256 {shortId(source.metadata.sha256)}</p><button disabled={!source.token || !!busy || versionChanged} onClick={() => chooseSource(source)}>Annotate source</button>{!source.token && <p>Local evidence is on another computer or unavailable.</p>}
      <ul className="divide-y divide-ink-800">{source.decisions.map((decision) => <li key={decision.recordId} className="py-3 space-y-2"><p>{formatTrainingTime(decision.content.anchor.startMs)} · {decision.state} · {relationLabel(decision.content.relation)}</p><p>{decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')}</p><p>{decision.content.summary}</p><p className="text-xs text-ink-500">Evidence digest {shortId(decision.recordDigest)}</p>{(decision.state === 'draft' || decision.state === 'accepted') && <button disabled={!!busy || !source.token || versionChanged} onClick={() => reviewDecision(source, decision)}>{decision.state === 'draft' ? 'Review before accepting' : 'Review accepted evidence'}</button>}</li>)}</ul>
    </section>)}

    {reviewed && <section className="rounded border border-brand-500 p-4 space-y-4" aria-labelledby="decision-review-heading"><h2 ref={reviewHeadingRef} id="decision-review-heading" tabIndex={-1}>Exact saved evidence</h2><img src={reviewed.image} alt={`Saved evidence at ${formatTrainingTime(reviewed.decision.content.anchor.startMs)}`} className="w-full" /><dl className="grid gap-2 text-sm"><div><dt className="font-semibold">Source</dt><dd>{reviewed.source.localName || `SHA-256 ${shortId(reviewed.source.metadata.sha256)}`}</dd></div><div><dt className="font-semibold">Timestamp</dt><dd>{formatTrainingTime(reviewed.decision.content.anchor.startMs)}</dd></div><div><dt className="font-semibold">Relation</dt><dd>{relationLabel(reviewed.decision.content.relation)}</dd></div><div><dt className="font-semibold">Visual properties</dt><dd>{reviewed.decision.content.properties.map((item) => item.replaceAll('_', ' ')).join(', ')}</dd></div><div><dt className="font-semibold">Decision</dt><dd>{reviewed.decision.content.summary}</dd></div><div><dt className="font-semibold">Immutable digest</dt><dd className="break-all">{reviewed.decision.recordDigest}</dd></div></dl>
      {reviewed.decision.state === 'draft' && <><label className="flex gap-3"><input type="checkbox" checked={acceptConfirmed} disabled={!!busy} onChange={(event) => setAcceptConfirmed(event.target.checked)} />I reviewed this exact frame and decision and want it eligible for future Manager selection.</label><button disabled={!!busy || !acceptConfirmed} onClick={acceptReviewed}>Accept this exact decision</button></>}
      {reviewed.decision.state === 'accepted' && <><label className="flex gap-3"><input type="checkbox" checked={revokeConfirmed} disabled={!!busy} onChange={(event) => setRevokeConfirmed(event.target.checked)} />I understand revocation prevents this evidence from being selected in future runs.</label><button disabled={!!busy || !revokeConfirmed} onClick={revokeReviewed}>Revoke future selection</button></>}
      <button disabled={!!busy} onClick={() => setReviewed(null)}>Close evidence review</button>
    </section>}

    {selected && <section className="rounded border border-ink-700 p-4 space-y-4"><h2>Timestamped visual decision</h2><fieldset disabled={!!busy || versionChanged} className="space-y-4"><legend className="sr-only">Choose and explain an exact visual decision</legend><label className="block">Frame timestamp<input className="block w-full" type="range" min="0" max={Math.max(0, selected.metadata.durationMs - 1)} step="1" value={time} aria-valuetext={formatTrainingTime(time)} onChange={(event) => changeTime(Number(event.target.value))} /></label><div className="flex flex-wrap items-end gap-2"><label>Exact timestamp in milliseconds<input className="block rounded bg-ink-900 border p-2" type="number" min="0" max={Math.max(0, selected.metadata.durationMs - 1)} value={time} onChange={(event) => changeTime(Number(event.target.value))} /></label>{[-1000, -100, 100, 1000].map((delta) => <button type="button" key={delta} onClick={() => changeTime(time + delta)}>{delta > 0 ? '+' : '−'}{Math.abs(delta)} ms</button>)}</div><p aria-live="polite">Selected time {formatTrainingTime(time)} of {formatTrainingTime(selected.metadata.durationMs)}</p><button type="button" onClick={showPreview}>Preview this exact frame</button>{previewIsCurrent && preview?.image && <img src={preview.image} alt={`Training source frame at ${formatTrainingTime(preview.timeMs)}`} className="w-full" />}
      <label className="block">Evidence relation<select value={relation} onChange={(event) => { setRelation(event.target.value as Relation); setDecisionKey(crypto.randomUUID()); }}><option value="accepted">Positive example</option><option value="rejected">Negative example</option><option value="contrast">Contrastive example</option></select></label><label className="block">Visual property<select value={property} onChange={(event) => { setProperty(event.target.value); setDecisionKey(crypto.randomUUID()); }}>{['motion_rhythm', 'layout_variety', 'information_hierarchy', 'typography_treatment', 'transition_quality', 'animation_continuity', 'composition_density'].map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
      {([['What was chosen', chosen, setChosen], ['Why this choice', why, setWhy], ['Tool or process used', process, setProcess], ['Desired visual, motion or layout behavior', behavior, setBehavior]] as const).map(([label, value, set]) => <label className="block" key={label}>{label}<textarea className="block w-full rounded bg-ink-900 border p-2" maxLength={400} value={value} onChange={(event) => { set(event.target.value); setDecisionKey(crypto.randomUUID()); }} /></label>)}<button disabled={!previewIsCurrent || ![chosen, why, process, behavior].every((value) => value.trim())} onClick={annotate}>Save decision draft</button></fieldset><p className="text-sm">Review and accept each saved decision separately. Acceptance records evidence; it does not claim the agent is trained or automatically add it to every run.</p></section>}
  </main>;
}
