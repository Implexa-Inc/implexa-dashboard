'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Scope = {
  kind: 'private_agent'; agentSlug: string; agentFamilyId: string;
  originatingAgentVersionId?: string; taskSignatureDigest: string;
  stepIndex: number | null; capabilityIdentity: string | null; toolIdentity: string | null;
};
type Candidate = {
  id: string; candidateKey: string; ruleClass: 'preference' | 'reliability' | 'capability';
  polarity: string; summary: string | null; instruction: string; scope: Scope;
  evidenceCount: number; recurrenceCount: number; taskCoverage: number;
  contradictionCount: number; eligible: boolean; eligibilityReason: string;
};
type ActiveRule = {
  id: string; ruleId: string; version: number; versionDigest: string;
  ruleClass: 'preference' | 'reliability'; instruction: string; scope: Scope;
  evidenceIds: string[]; lastAppliedRun: string | null; contradictionCount: number;
  influenceState: 'active' | 'suspended_contradiction' | 'suspended_scope';
};
type Payload = { ok: true; source: 'ready'; suggested: Candidate[]; active: ActiveRule[] };
type BackfillResult = {
  ok: true; source: 'ready'; scannedEvidence: number; agentEvidence: number;
  matchedEvidence: number; proposals: number; createdCandidates: number;
  attachedEvidence: number; replaySafe: true;
};
type SourceState = 'loading' | 'ready' | 'disabled' | 'unavailable';

function short(value: string | null | undefined, size = 12) {
  return value ? `${value.slice(0, size)}…` : 'unknown';
}
function reason(value: string) {
  const labels: Record<string, string> = {
    eligible: 'Ready for your approval', insufficient_recurrence: 'Needs recurring evidence',
    contradicted: 'Contradicting feedback needs review', stale_evidence: 'Evidence is stale',
    capability_shadow_only: 'Capability evidence is shadow-only', dismissed: 'Dismissed',
    runtime_scope_shadow_only: 'Exact runtime scope is not enforceable; shadow-only',
  };
  return labels[value] || value.replaceAll('_', ' ');
}
function approvalExplanation(item: Candidate) {
  if (item.eligible) return null;
  if (item.eligibilityReason === 'insufficient_recurrence') {
    return canApproveLowEvidence(item)
      ? 'Only 1 independent run supports this suggestion. You can approve anyway; it will be recorded as a low-evidence author override and remains reversible.'
      : `Approval requires recurring evidence. This suggestion currently has ${item.recurrenceCount} independent runs.`;
  }
  if (item.eligibilityReason === 'contradicted') return 'Approval is locked because later feedback contradicts this suggestion.';
  if (item.eligibilityReason === 'stale_evidence') return 'Approval is locked because the supporting evidence is outside the current evidence window.';
  if (item.eligibilityReason === 'runtime_scope_shadow_only' || item.eligibilityReason === 'capability_shadow_only') {
    return 'Approval is locked because the current runtime cannot enforce this exact scope.';
  }
  return `Approval is locked: ${reason(item.eligibilityReason)}.`;
}
function canApproveLowEvidence(item: Candidate) {
  return !item.eligible
    && item.eligibilityReason === 'insufficient_recurrence'
    && item.evidenceCount === 1
    && item.recurrenceCount === 1
    && item.contradictionCount === 0
    && (item.ruleClass === 'preference' || item.ruleClass === 'reliability')
    && item.scope.stepIndex == null
    && item.scope.capabilityIdentity == null
    && item.scope.toolIdentity == null;
}

export default function AgentLearningsCard({ slug, initialPayload = null, initialSource = 'loading' }: {
  slug: string; initialPayload?: Payload | null; initialSource?: SourceState;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [payload, setPayload] = useState<Payload | null>(initialPayload);
  const [source, setSource] = useState<SourceState>(initialSource);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<BackfillResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [activeEditingId, setActiveEditingId] = useState<string | null>(null);
  const [activeEditInstruction, setActiveEditInstruction] = useState('');
  const [activeEditError, setActiveEditError] = useState<string | null>(null);

  const token = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }, [supabase]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/learning-influence`, { jwt: await token() });
      if (body?.source === 'disabled') { setPayload(null); setSource('disabled'); return; }
      if (!body?.ok || body?.source !== 'ready' || !Array.isArray(body.suggested) || !Array.isArray(body.active)) {
        setPayload(null); setSource('unavailable'); return;
      }
      setPayload(body as Payload); setSource('ready');
    } catch {
      setPayload(null); setSource('unavailable');
    }
  }, [slug, token]);

  useEffect(() => { void load(); }, [load]);

  async function act(path: string, body: Record<string, string | boolean>, key: string) {
    if (source !== 'ready') return;
    setBusy(key); setError(null);
    try {
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/learning-influence/${path}`, {
        jwt: await token(), method: 'POST', body,
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The learning action could not be completed.');
    } finally { setBusy(null); }
  }

  async function analyzePastFeedback() {
    if (source !== 'ready') return;
    setBusy('historical-backfill'); setError(null); setAnalysis(null);
    try {
      const body = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/learning-influence/backfill`, {
        jwt: await token(), method: 'POST', body: {},
      });
      const counts = ['scannedEvidence', 'agentEvidence', 'matchedEvidence', 'proposals',
        'createdCandidates', 'attachedEvidence'] as const;
      if (!body?.ok || body?.source !== 'ready' || body?.replaySafe !== true
          || counts.some((key) => !Number.isSafeInteger(body[key]) || body[key] < 0)) {
        throw new Error('Historical feedback analysis returned an unverifiable result.');
      }
      setAnalysis(body as BackfillResult);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Past feedback could not be analyzed.');
    } finally { setBusy(null); }
  }

  function beginEdit(item: Candidate) {
    setEditingId(item.id); setEditInstruction(item.instruction); setEditError(null); setError(null);
  }

  function validatedInstruction(value: string, original: string) {
    const instruction = value.trim().replace(/\s+/g, ' ');
    if (instruction.length < 12 || instruction.length > 300) return { error: 'Write a rule between 12 and 300 characters.' };
    if (instruction === original) return { error: 'Change the rule before saving the refinement.' };
    return { instruction };
  }

  async function saveEdit(item: Candidate, approve: boolean) {
    const instruction = editInstruction.trim().replace(/\s+/g, ' ');
    const checked = validatedInstruction(instruction, item.instruction);
    if (checked.error) { setEditError(checked.error); return; }
    const key = `${approve ? 'refine-approve' : 'refine'}:${item.id}`;
    setBusy(key); setEditError(null); setError(null);
    try {
      const endpoint = approve ? 'refine-and-approve' : 'refine';
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/learning-influence/candidates/${item.id}/${endpoint}`, {
        jwt: await token(), method: 'POST', body: {
          candidateKey: item.candidateKey, instruction: checked.instruction,
          ...(approve ? { allowLowEvidence: canApproveLowEvidence(item) } : {}),
        },
      });
      setEditingId(null); setEditInstruction(''); await load();
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : 'The refined rule could not be saved.');
    } finally { setBusy(null); }
  }

  function beginActiveEdit(rule: ActiveRule) {
    setActiveEditingId(rule.id); setActiveEditInstruction(rule.instruction);
    setActiveEditError(null); setError(null);
  }

  async function saveActiveEdit(rule: ActiveRule) {
    const checked = validatedInstruction(activeEditInstruction, rule.instruction);
    if (checked.error) { setActiveEditError(checked.error); return; }
    const key = `refine-rule:${rule.id}`;
    setBusy(key); setActiveEditError(null); setError(null);
    try {
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/learning-influence/rules/${rule.ruleId}/refine`, {
        jwt: await token(), method: 'POST',
        body: { versionDigest: rule.versionDigest, instruction: checked.instruction },
      });
      setActiveEditingId(null); setActiveEditInstruction(''); await load();
    } catch (caught) {
      setActiveEditError(caught instanceof Error ? caught.message : 'The active rule could not be refined.');
    } finally { setBusy(null); }
  }

  if (source === 'loading') return <div className="card max-w-3xl" aria-busy="true">Loading learnings…</div>;

  if (source !== 'ready' || !payload) {
    return (
      <section className="card max-w-3xl border-amber-500/30" aria-label="Train learnings unavailable">
        <p className="text-[11px] uppercase tracking-widest text-ink-500">Train → Learnings</p>
        <h2 className="mt-1 text-base font-semibold text-ink-50">Learnings unavailable</h2>
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          {source === 'disabled'
            ? 'This deployment has not enabled the immutable learning-rule source. No learning can influence a run.'
            : 'The learning source could not be verified. Nothing is shown as empty and every learning action is disabled.'}
        </p>
        <button type="button" disabled className="btn-outline mt-3 opacity-50">Actions disabled</button>
      </section>
    );
  }

  return (
    <section className="card max-w-3xl" aria-label="Train learnings">
      <p className="text-[11px] uppercase tracking-widest text-ink-500">Train → Learnings</p>
      <h2 className="mt-1 text-base font-semibold text-ink-50">What this agent may carry forward</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        Private to this agent. Suggestions stay inert until you approve them; every active rule is versioned, frozen into a run, and reversible.
      </p>

      <div className="mt-4 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
        <p className="text-sm font-medium text-ink-100">Use feedback you already gave</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          Analyze up to 180 days of this agent&apos;s implemented Review Room feedback. Reviewer words select a small, reviewed rule vocabulary; suggestions remain inert until they recur across successful runs and you approve them.
        </p>
        <button type="button" disabled={busy !== null} onClick={() => void analyzePastFeedback()}
          className="btn-outline mt-3 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40">
          {busy === 'historical-backfill' ? 'Analyzing past feedback…' : 'Analyze past feedback'}
        </button>
        {analysis && (
          <p role="status" className="mt-2 text-xs text-sky-700 dark:text-sky-300">
            {analysis.agentEvidence === 0
              ? 'No implemented feedback from this agent was found in the last 180 days.'
              : analysis.matchedEvidence === 0
                ? `${analysis.agentEvidence} implemented feedback item${analysis.agentEvidence === 1 ? '' : 's'} checked; none matched the reviewed learning patterns yet.`
                : `${analysis.matchedEvidence} of ${analysis.agentEvidence} implemented feedback items matched reviewed patterns. ${analysis.createdCandidates} new suggestion${analysis.createdCandidates === 1 ? '' : 's'} and ${analysis.attachedEvidence} new evidence link${analysis.attachedEvidence === 1 ? '' : 's'} were added without duplicates.`}
          </p>
        )}
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink-100">Suggested</h3>
        {payload.suggested.length === 0 ? <p className="mt-2 text-xs text-ink-500">No suggestions awaiting review.</p> : (
          <ul className="mt-2 space-y-3">
            {payload.suggested.map((item) => (
              <li key={item.id} className="rounded-lg border border-ink-800 bg-ink-900/50 p-3">
                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-ink-500">
                  <span>{item.ruleClass}</span><span>Private agent</span><span>{reason(item.eligibilityReason)}</span>
                </div>
                <p className="mt-2 text-sm text-ink-100">{item.summary || item.instruction}</p>
                {item.summary && <p className="mt-1 text-xs text-ink-400">Rule: {item.instruction}</p>}
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
                  <div><dt className="inline">Evidence </dt><dd className="inline text-ink-300">{item.evidenceCount}</dd></div>
                  <div><dt className="inline">Runs </dt><dd className="inline text-ink-300">{item.recurrenceCount}</dd></div>
                  <div><dt className="inline">Task coverage </dt><dd className="inline text-ink-300">{item.taskCoverage}</dd></div>
                  <div><dt className="inline">Contradictions </dt><dd className="inline text-ink-300">{item.contradictionCount}</dd></div>
                  <div><dt className="inline">Task </dt><dd className="inline font-mono text-ink-300">{short(item.scope.taskSignatureDigest)}</dd></div>
                  <div><dt className="inline">Step </dt><dd className="inline text-ink-300">{item.scope.stepIndex == null ? 'agent task-wide' : item.scope.stepIndex}</dd></div>
                  <div><dt className="inline">Capability </dt><dd className="inline text-ink-300">{item.scope.capabilityIdentity || 'all'}</dd></div>
                  <div><dt className="inline">Tool </dt><dd className="inline text-ink-300">{item.scope.toolIdentity || 'all'}</dd></div>
                </dl>
                {approvalExplanation(item) && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{approvalExplanation(item)}</p>
                )}
                {editingId === item.id && (
                  <div className="mt-3 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
                    <label htmlFor={`learning-rule-${item.id}`} className="text-xs font-medium text-ink-200">Refine this rule</label>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                      This creates an auditable replacement with the same evidence and scope. It does not manufacture another supporting run or rewrite the original evidence.
                    </p>
                    <textarea id={`learning-rule-${item.id}`} value={editInstruction} maxLength={300}
                      onChange={(event) => setEditInstruction(event.target.value)} rows={3}
                      className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100" />
                    <p className="mt-1 text-[11px] text-ink-500">{editInstruction.trim().length}/300 characters</p>
                    {editError && <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">{editError}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={busy !== null} onClick={() => void saveEdit(item, true)}
                        className="btn-success px-3 py-1.5 text-xs disabled:opacity-40">Save &amp; approve</button>
                      <button type="button" disabled={busy !== null} onClick={() => void saveEdit(item, false)}
                        className="btn-outline px-3 py-1.5 text-xs disabled:opacity-40">Save only</button>
                      <button type="button" disabled={busy !== null} onClick={() => { setEditingId(null); setEditError(null); }}
                        className="btn-outline px-3 py-1.5 text-xs disabled:opacity-40">Cancel</button>
                    </div>
                  </div>
                )}
                {editingId !== item.id && <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={!(item.eligible || canApproveLowEvidence(item)) || busy === item.id}
                    onClick={() => act(`candidates/${item.id}/approve`, {
                      candidateKey: item.candidateKey, allowLowEvidence: canApproveLowEvidence(item),
                    }, item.id)}
                    className="btn-success px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40">
                    {canApproveLowEvidence(item) ? 'Approve anyway' : 'Approve'}
                  </button>
                  <button type="button" disabled={busy === item.id}
                    onClick={() => act(`candidates/${item.id}/dismiss`, { candidateKey: item.candidateKey }, item.id)}
                    className="btn-outline px-3 py-1.5 text-xs disabled:opacity-40">Dismiss</button>
                  <button type="button" disabled={busy !== null} onClick={() => beginEdit(item)}
                    className="btn-outline px-3 py-1.5 text-xs disabled:opacity-40">Edit rule</button>
                </div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 border-t border-ink-800 pt-5">
        <h3 className="text-sm font-semibold text-ink-100">Active</h3>
        {payload.active.length === 0 ? <p className="mt-2 text-xs text-ink-500">No approved rules influence future runs.</p> : (
          <ul className="mt-2 space-y-3">
            {payload.active.map((rule) => (
              <li key={rule.id} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  {rule.ruleClass} · v{rule.version} · private agent · {rule.influenceState === 'active' ? 'active' : 'suspended'}
                </div>
                <p className="mt-2 text-sm text-ink-100">{rule.instruction}</p>
                {rule.influenceState === 'suspended_contradiction' && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Suspended from future runs after {rule.contradictionCount} contradictory evidence record{rule.contradictionCount === 1 ? '' : 's'}. Already-frozen runs are unchanged; review by disabling or undoing this rule.
                  </p>
                )}
                {rule.influenceState === 'suspended_scope' && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Suspended from future runs because this runtime cannot enforce its exact step, capability, or tool scope. It remains visible for review and cannot be broadened.
                  </p>
                )}
                <p className="mt-2 text-[11px] text-ink-500">
                  {rule.evidenceIds.length} supporting evidence records · {rule.contradictionCount} contradictions · task {short(rule.scope.taskSignatureDigest)} · step {rule.scope.stepIndex == null ? 'agent task-wide' : rule.scope.stepIndex} · capability {rule.scope.capabilityIdentity || 'all'} · tool {rule.scope.toolIdentity || 'all'} · last applied {rule.lastAppliedRun ? short(rule.lastAppliedRun) : 'never'}
                </p>
                {activeEditingId === rule.id && (
                  <div className="mt-3 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
                    <label htmlFor={`active-learning-rule-${rule.id}`} className="text-xs font-medium text-ink-200">Edit active rule</label>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                      Saving appends v{rule.version + 1}. The current version, its evidence, and rules already frozen into runs remain unchanged and auditable.
                    </p>
                    <textarea id={`active-learning-rule-${rule.id}`} value={activeEditInstruction} maxLength={300}
                      onChange={(event) => setActiveEditInstruction(event.target.value)} rows={3}
                      className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100" />
                    <p className="mt-1 text-[11px] text-ink-500">{activeEditInstruction.trim().length}/300 characters</p>
                    {activeEditError && <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">{activeEditError}</p>}
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={busy !== null} onClick={() => void saveActiveEdit(rule)}
                        className="btn-success px-3 py-1.5 text-xs disabled:opacity-40">Save new version</button>
                      <button type="button" disabled={busy !== null} onClick={() => { setActiveEditingId(null); setActiveEditError(null); }}
                        className="btn-outline px-3 py-1.5 text-xs disabled:opacity-40">Cancel</button>
                    </div>
                  </div>
                )}
                {activeEditingId !== rule.id && <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy !== null} onClick={() => beginActiveEdit(rule)}
                    className="btn-outline px-3 py-1.5 text-xs disabled:opacity-40">Edit active rule</button>
                  <button type="button" disabled={busy === rule.id}
                    onClick={() => act(`rules/${rule.ruleId}/disable`, { versionDigest: rule.versionDigest }, rule.id)}
                    className="btn-outline px-3 py-1.5 text-xs disabled:opacity-40">Disable</button>
                  <button type="button" disabled={busy === rule.id}
                    onClick={() => act(`rules/${rule.ruleId}/undo`, { versionDigest: rule.versionDigest }, rule.id)}
                    className="text-xs text-rose-600 hover:text-rose-500 disabled:opacity-40">Undo</button>
                </div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </section>
  );
}
