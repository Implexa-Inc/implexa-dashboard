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

export default function AgentLearningsCard({ slug, initialPayload = null, initialSource = 'loading' }: {
  slug: string; initialPayload?: Payload | null; initialSource?: SourceState;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [payload, setPayload] = useState<Payload | null>(initialPayload);
  const [source, setSource] = useState<SourceState>(initialSource);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function act(path: string, body: Record<string, string>, key: string) {
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
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={!item.eligible || busy === item.id}
                    onClick={() => act(`candidates/${item.id}/approve`, { candidateKey: item.candidateKey }, item.id)}
                    className="btn-success px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40">Approve</button>
                  <button type="button" disabled={busy === item.id}
                    onClick={() => act(`candidates/${item.id}/dismiss`, { candidateKey: item.candidateKey }, item.id)}
                    className="btn-outline px-3 py-1.5 text-xs disabled:opacity-40">Dismiss</button>
                </div>
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
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={busy === rule.id}
                    onClick={() => act(`rules/${rule.ruleId}/disable`, { versionDigest: rule.versionDigest }, rule.id)}
                    className="btn-outline px-3 py-1.5 text-xs disabled:opacity-40">Disable</button>
                  <button type="button" disabled={busy === rule.id}
                    onClick={() => act(`rules/${rule.ruleId}/undo`, { versionDigest: rule.versionDigest }, rule.id)}
                    className="text-xs text-rose-600 hover:text-rose-500 disabled:opacity-40">Undo</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </section>
  );
}
