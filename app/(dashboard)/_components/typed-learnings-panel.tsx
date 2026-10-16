'use client';

// Slice 3 (backend 0471): typed learnings — check | criterion | taste — drafted from a
// trainer's Review issue and admitted only by the trainer. Mounted inside the Train →
// Learnings card. Every rule lives in the backend; this panel shows the learning, its
// evidence and its counterfactual preview, and sends exact, digest-bound decisions.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import Modal from './modal';

type LearningType = 'check' | 'criterion' | 'taste';
type Evidence = {
  id: string; kind: string; side: 'before' | 'after'; status: string; stored: boolean;
  mediaStartMs: number | null; mediaEndMs: number | null; captureTimeMs: number | null; frameTimesMs: number[] | null;
};
type Preview = {
  id: string; evaluated: boolean; evaluator: string | null; blocksKnownGood: boolean;
  relatedRunIds: string[]; acceptedRunIds: string[]; wouldCatchRunIds: string[]; wouldBlockRunIds: string[];
  relatedEvidenceIds: string[]; computedAt: string;
};
type TypedCandidate = {
  candidateId: string; candidateKey: string; text: string; polarity: string; dismissed: boolean; revision: number;
  typedDigest: string; learningType: LearningType | null; owningStage: string | null; category: string; scope: 'agent' | 'category_wide';
  checkState: string | null; classification: { source: 'trainer' | 'model' | 'heuristic'; typeConfidence?: number | null };
  evidence: Evidence[]; preview: Preview | null;
};
type TypedRule = {
  ruleId: string; ruleVersionId: string; version: number; state: string; text: string; learningType: LearningType;
  owningStage: string; category: string; scope: string; evidenceIds: string[];
  activation: { target: string };
};
type Payload = { ok: true; candidates: TypedCandidate[]; rules: TypedRule[] };
type SourceState = 'loading' | 'ready' | 'unavailable';

export const STAGES = ['admission', 'planning', 'scene_contract', 'asset_selection', 'build', 'preview', 'render', 'qa', 'revision'];
export const CATEGORIES = ['layout_visual', 'motion_timing', 'audio', 'copy', 'pacing'];
const TYPE_LABEL: Record<LearningType, string> = {
  check: 'Check (measurable rule over the scene)', criterion: 'Judge criterion', taste: 'Taste (preference)',
};
const ACTIVATION_LABEL: Record<string, string> = {
  next_agent_version: 'Becomes a Judge criterion in the next agent version',
  per_run_snapshot: 'Goes into each run’s taste snapshot',
  blocked_pending_schema: 'Waits for scene schema v2 before it can run',
  inactive: 'Inactive',
};
// The object a reviewer opens first for each evidence kind (backend evidenceObjectKey names).
const PRIMARY_OBJECT: Record<string, string> = {
  annotated_visual_frame_v1: 'annotated.png', corrected_output_frame_v1: 'corrected.png',
  section_frames_v1: 'frame-00.png', section_clip_v1: 'clip.mp4', section_audio_v1: 'audio.m4a',
};
const HEX64 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const label = (v: string | null | undefined) => (v ? v.replaceAll('_', ' ') : '—');
const ms = (v: number | null) => (v == null ? '' : `${(v / 1000).toFixed(1)}s`);
function provenance(c: TypedCandidate['classification']) {
  if (c.source === 'trainer') return 'typed by you';
  if (c.source === 'model') return `model, ${Math.round(100 * Number(c.typeConfidence || 0))}% confidence`;
  return 'drafted from your words; not typed';
}
function evidenceLine(e: Evidence) {
  const kind = { annotated_visual_frame_v1: 'marked frame', corrected_output_frame_v1: 'corrected frame', section_frames_v1: 'section frames',
    section_clip_v1: 'section clip', section_audio_v1: 'section audio' }[e.kind] || label(e.kind);
  const when = e.captureTimeMs != null ? ` at ${ms(e.captureTimeMs)}`
    : e.mediaStartMs != null ? ` ${ms(e.mediaStartMs)}–${ms(e.mediaEndMs)}` : '';
  return `${e.side} · ${kind}${when}`;
}

export function admissionBlockers(c: TypedCandidate, flags: { acknowledge: boolean; confirmWide: boolean }) {
  const out: string[] = [];
  if (c.dismissed) out.push('This suggestion was dismissed or replaced.');
  if (!c.learningType) out.push('Choose a type: nothing is admitted untyped.');
  if (!c.owningStage) out.push('Choose the stage this learning governs.');
  if (!c.preview) out.push('Run the preview for this exact version first.');
  if (c.preview?.blocksKnownGood && !flags.acknowledge) out.push('Acknowledge that it would block an output you accepted.');
  if (c.scope === 'category_wide' && !flags.confirmWide) out.push('Confirm the category-wide scope.');
  if (c.evidence.some((e) => e.status !== 'validated')) out.push('Some cited evidence is no longer valid.');
  return out;
}

export default function TypedLearningsPanel({ slug, initialPayload = null, initialSource = 'loading' }: {
  slug: string; initialPayload?: Payload | null; initialSource?: SourceState;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [payload, setPayload] = useState<Payload | null>(initialPayload);
  const [source, setSource] = useState<SourceState>(initialSource);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftIds, setDraftIds] = useState({ requestId: '', issueId: '' });
  const [reviewing, setReviewing] = useState<TypedCandidate | null>(null);
  const [edits, setEdits] = useState<{ learningType: string; owningStage: string; category: string; scope: string; text: string }>({
    learningType: '', owningStage: '', category: '', scope: 'agent', text: '' });
  const [flags, setFlags] = useState({ acknowledge: false, confirmWide: false });
  const base = `/api/v2/agents/${encodeURIComponent(slug)}/learning-influence`;

  const token = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }, [supabase]);

  const load = useCallback(async () => {
    try {
      const body = await callBackend(`${base}/typed`, { jwt: await token() });
      if (!body?.ok || !Array.isArray(body.candidates) || !Array.isArray(body.rules)) { setPayload(null); setSource('unavailable'); return; }
      setPayload(body as Payload); setSource('ready');
      return body as Payload;
    } catch {
      setPayload(null); setSource('unavailable');
    }
    return undefined;
  }, [base, token]);

  useEffect(() => { if (initialSource === 'loading') void load(); }, [load, initialSource]);

  const post = useCallback(async (path: string, body: Record<string, unknown>) => callBackend(`${base}/${path}`, {
    jwt: await token(), method: 'POST', body,
  }), [base, token]);

  function openReview(c: TypedCandidate) {
    setReviewing(c); setError(null); setFlags({ acknowledge: false, confirmWide: false });
    setEdits({ learningType: c.learningType || '', owningStage: c.owningStage || '', category: c.category, scope: c.scope, text: c.text });
  }

  async function refreshReviewing(candidateId: string) {
    const next = await load();
    const found = next?.candidates.find((c) => c.candidateId === candidateId) || null;
    setReviewing(found);
    return found;
  }

  async function saveEdits(c: TypedCandidate) {
    const change: Record<string, unknown> = {};
    if (edits.learningType && edits.learningType !== c.learningType) change.learningType = edits.learningType;
    if (edits.owningStage && edits.owningStage !== c.owningStage) change.owningStage = edits.owningStage;
    if (edits.category !== c.category) change.category = edits.category;
    if (edits.scope !== c.scope) change.scope = edits.scope;
    const text = edits.text.trim().replace(/\s+/g, ' ');
    if (text !== c.text) {
      if (text.length < 12 || text.length > 300) { setError('Write the learning in 12 to 300 characters.'); return; }
      change.text = text;
    }
    if (!Object.keys(change).length) return;
    setBusy('edit'); setError(null);
    try {
      const res = await post(`typed/${c.candidateId}/edit`, { typedDigest: c.typedDigest, edits: change });
      if (res?.ok !== true || !UUID.test(res?.candidateId || '') || !HEX64.test(res?.typedDigest || '')) throw new Error('The edit could not be verified.');
      // A reword replaces the candidate; a fresh preview is needed for the new version.
      await post(`typed/${res.candidateId}/preview`, { typedDigest: res.typedDigest });
      await refreshReviewing(res.candidateId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The learning could not be updated.');
    } finally { setBusy(null); }
  }

  async function runPreview(c: TypedCandidate) {
    setBusy('preview'); setError(null);
    try {
      const res = await post(`typed/${c.candidateId}/preview`, { typedDigest: c.typedDigest });
      if (res?.ok !== true) throw new Error('The preview could not be stored.');
      await refreshReviewing(c.candidateId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The preview could not be run.');
    } finally { setBusy(null); }
  }

  async function admit(c: TypedCandidate) {
    if (admissionBlockers(c, flags).length) return;
    setBusy('admit'); setError(null);
    try {
      const res = await post(`typed/${c.candidateId}/admit`, {
        candidateKey: c.candidateKey, typedDigest: c.typedDigest,
        acknowledgeKnownGoodBlocks: flags.acknowledge === true, confirmCategoryWide: flags.confirmWide === true,
      });
      if (res?.ok !== true || !UUID.test(res?.ruleVersionId || '')) throw new Error('The admission could not be verified.');
      setReviewing(null); await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The learning could not be admitted.');
    } finally { setBusy(null); }
  }

  async function dismiss(c: TypedCandidate) {
    setBusy(`dismiss:${c.candidateId}`); setError(null);
    try {
      await post(`candidates/${c.candidateId}/dismiss`, { candidateKey: c.candidateKey });
      setReviewing(null); await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The suggestion could not be dismissed.');
    } finally { setBusy(null); }
  }

  async function draftFromIssue() {
    const ids = { requestId: draftIds.requestId.trim(), issueId: draftIds.issueId.trim() };
    if (!UUID.test(ids.requestId) || !UUID.test(ids.issueId)) { setError('Enter the Review request and issue IDs of a completed revision.'); return; }
    setBusy('draft'); setError(null);
    try {
      const res = await post('typed/draft', ids);
      if (res?.ok !== true || res?.active !== false || !UUID.test(res?.candidateId || '')) throw new Error('The draft could not be verified. Nothing was admitted.');
      setDraftOpen(false); setDraftIds({ requestId: '', issueId: '' }); await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The learning could not be drafted.');
    } finally { setBusy(null); }
  }

  async function openEvidence(c: TypedCandidate, e: Evidence) {
    const name = PRIMARY_OBJECT[e.kind];
    if (!name) return;
    setError(null);
    try {
      const res = await callBackend(`${base}/typed/${c.candidateId}/evidence/${e.id}/url?name=${encodeURIComponent(name)}`, { jwt: await token() });
      if (res?.ok !== true || typeof res.signedUrl !== 'string' || !/^https:\/\//.test(res.signedUrl)) throw new Error('The evidence is not available.');
      window.open(res.signedUrl, '_blank', 'noopener');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The evidence could not be opened.');
    }
  }

  if (source === 'loading') return <div className="mt-4 text-xs text-ink-500" aria-busy="true">Loading typed learnings…</div>;
  if (source !== 'ready' || !payload) {
    return (
      <div className="mt-4 rounded-lg border border-amber-500/30 p-3" aria-label="Typed learnings unavailable">
        <p className="text-sm font-medium text-ink-100">Typed learnings unavailable</p>
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">The typed learning source could not be verified. Nothing is shown as empty and every action is disabled.</p>
      </div>
    );
  }

  const live = payload.candidates.filter((c) => !c.dismissed);
  return (
    <div className="mt-4 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3" aria-label="Typed learnings">
      <p className="text-sm font-medium text-ink-100">Typed learnings from your reviews</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        A check, a Judge criterion or a taste preference, each carrying the frames, clip and audio it came from. Nothing is admitted until you type it, stage it and review its preview. Typed learnings are never sent to a run as prose.
      </p>
      <button type="button" disabled={busy !== null} onClick={() => { setError(null); setDraftOpen(true); }}
        className="btn-outline mt-3 px-3 py-1.5 text-xs disabled:opacity-40">Draft from a Review issue</button>

      {live.length === 0 ? (
        <p className="mt-3 text-xs text-ink-500">No typed suggestions yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {live.map((c) => (
            <li key={c.candidateId} className="rounded-lg border border-ink-800 bg-ink-900/40 p-3">
              <p className="text-sm text-ink-100">{c.text}</p>
              <p className="mt-1 text-[11px] text-ink-400">
                {c.learningType ? TYPE_LABEL[c.learningType] : 'Untyped — you decide'} · stage {label(c.owningStage)} · {label(c.category)} · {c.scope === 'category_wide' ? 'category-wide' : 'this agent'} · {provenance(c.classification)}
                {c.checkState === 'pending_schema' ? ' · waits for scene schema v2' : ''}
              </p>
              <p className="mt-1 text-[11px] text-ink-500">Evidence: {c.evidence.map(evidenceLine).join('; ')}</p>
              <p className="mt-1 text-[11px] text-ink-500">
                {c.preview
                  ? c.preview.evaluated
                    ? `Preview: would catch ${c.preview.wouldCatchRunIds.length} past run(s), would block ${c.preview.wouldBlockRunIds.length}${c.preview.blocksKnownGood ? ' — including an output you accepted' : ''}.`
                    : `Preview: ${c.preview.relatedRunIds.length} recent run(s), ${c.preview.acceptedRunIds.length} accepted, ${c.preview.relatedEvidenceIds.length} related review(s). Not evaluated yet.`
                  : 'No preview for this version yet.'}
              </p>
              <button type="button" disabled={busy !== null} onClick={() => openReview(c)} className="btn-outline mt-2 px-3 py-1 text-xs disabled:opacity-40">Review &amp; admit</button>
            </li>
          ))}
        </ul>
      )}

      {payload.rules.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Admitted typed learnings">
          {payload.rules.map((r) => (
            <li key={r.ruleVersionId} className="text-[11px] text-ink-400">
              <span className="text-ink-200">{r.text}</span> — {TYPE_LABEL[r.learningType]} · stage {label(r.owningStage)} · {ACTIVATION_LABEL[r.activation.target] || label(r.activation.target)} · {r.evidenceIds.length} evidence item(s)
            </li>
          ))}
        </ul>
      )}

      <Modal open={draftOpen} onClose={() => { if (busy !== 'draft') setDraftOpen(false); }} title="Draft a typed learning"
        subtitle="From one implemented Review issue. The draft is inert: you type, stage and admit it yourself.">
        <form onSubmit={(event) => { event.preventDefault(); void draftFromIssue(); }} className="space-y-3">
          {(['requestId', 'issueId'] as const).map((key) => (
            <label key={key} className="block text-xs text-ink-300">{key === 'requestId' ? 'Review request ID' : 'Review issue ID'}
              <input required value={draftIds[key]} disabled={busy === 'draft'} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 p-2"
                onChange={(event) => setDraftIds({ ...draftIds, [key]: event.target.value })} />
            </label>
          ))}
          <button type="submit" disabled={busy !== null} className="btn-primary px-3 py-1.5 text-xs">{busy === 'draft' ? 'Drafting…' : 'Draft'}</button>
        </form>
      </Modal>

      <Modal open={reviewing !== null} onClose={() => { if (busy === null) setReviewing(null); }} title="Review a typed learning"
        subtitle="Admitting appends an immutable, reversible version. Checks and criteria reach runs only through a new agent version.">
        {reviewing && (
          <div className="space-y-3 text-xs text-ink-300">
            <label className="block">Learning
              <textarea value={edits.text} disabled={busy !== null} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 p-2"
                onChange={(event) => setEdits({ ...edits, text: event.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label>Type
                <select aria-label="Type" value={edits.learningType} disabled={busy !== null} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 p-1"
                  onChange={(event) => setEdits({ ...edits, learningType: event.target.value })}>
                  <option value="">Untyped — choose</option>
                  {(Object.keys(TYPE_LABEL) as LearningType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </label>
              <label>Stage
                <select aria-label="Stage" value={edits.owningStage} disabled={busy !== null} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 p-1"
                  onChange={(event) => setEdits({ ...edits, owningStage: event.target.value })}>
                  <option value="">Choose a stage</option>
                  {STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </label>
              <label>Category
                <select aria-label="Category" value={edits.category} disabled={busy !== null} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 p-1"
                  onChange={(event) => setEdits({ ...edits, category: event.target.value })}>
                  {CATEGORIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </label>
              <label>Scope
                <select aria-label="Scope" value={edits.scope} disabled={busy !== null} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 p-1"
                  onChange={(event) => setEdits({ ...edits, scope: event.target.value })}>
                  <option value="agent">This agent</option>
                  <option value="category_wide">Category-wide</option>
                </select>
              </label>
            </div>
            <button type="button" disabled={busy !== null} onClick={() => void saveEdits(reviewing)} className="btn-outline px-3 py-1 text-xs">
              {busy === 'edit' ? 'Saving…' : 'Save changes'}
            </button>
            <div>
              <p className="font-medium text-ink-200">Evidence</p>
              <ul className="mt-1 space-y-1">
                {reviewing.evidence.map((e) => (
                  <li key={e.id}>
                    {evidenceLine(e)} {e.status !== 'validated' ? <span className="text-rose-500">({e.status})</span> : null}
                    {e.stored && PRIMARY_OBJECT[e.kind] && (
                      <button type="button" className="ml-2 underline" onClick={() => void openEvidence(reviewing, e)}>Open</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-ink-200">Preview</p>
              {reviewing.preview ? (
                <p className="mt-1">
                  {reviewing.preview.evaluated
                    ? `Evaluated by ${reviewing.preview.evaluator}: would catch ${reviewing.preview.wouldCatchRunIds.length}, would block ${reviewing.preview.wouldBlockRunIds.length} of ${reviewing.preview.relatedRunIds.length} recent runs.`
                    : `Not evaluated: checks wait for scene schema v2 and criteria need an approved model budget. ${reviewing.preview.relatedRunIds.length} recent runs and ${reviewing.preview.relatedEvidenceIds.length} related reviews are listed for you to inspect.`}
                </p>
              ) : (
                <button type="button" disabled={busy !== null} onClick={() => void runPreview(reviewing)} className="btn-outline mt-1 px-3 py-1 text-xs">
                  {busy === 'preview' ? 'Running…' : 'Run preview'}
                </button>
              )}
            </div>
            {reviewing.preview?.blocksKnownGood && (
              <label className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                <input type="checkbox" checked={flags.acknowledge} onChange={(event) => setFlags({ ...flags, acknowledge: event.target.checked })} />
                <span>I understand this would have blocked an output I accepted.</span>
              </label>
            )}
            {reviewing.scope === 'category_wide' && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={flags.confirmWide} onChange={(event) => setFlags({ ...flags, confirmWide: event.target.checked })} />
                <span>Apply this across the whole category, not only this agent.</span>
              </label>
            )}
            {admissionBlockers(reviewing, flags).map((b) => <p key={b} className="text-ink-500">{b}</p>)}
            <div className="flex gap-2">
              <button type="button" disabled={busy !== null || admissionBlockers(reviewing, flags).length > 0}
                onClick={() => void admit(reviewing)} className="btn-primary px-3 py-1.5 text-xs disabled:opacity-40">
                {busy === 'admit' ? 'Admitting…' : 'Admit learning'}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void dismiss(reviewing)} className="btn-outline px-3 py-1.5 text-xs">Dismiss</button>
            </div>
          </div>
        )}
      </Modal>
      {error && <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
