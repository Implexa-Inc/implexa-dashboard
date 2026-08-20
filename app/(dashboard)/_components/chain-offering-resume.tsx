'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { ChainOffering, ChainNode } from '@/lib/agent-chain-offerings';
import { EVIDENCE_CHANNEL_KEYS, EVIDENCE_TYPE_KEYS, type EvidenceChannelKey } from '@/lib/agent-evidence-channels';

const TYPE_LABELS: Record<string, string> = { deterministicVerification: 'Deterministic verification', judgeReview: 'Judge review', humanAcceptance: 'Human acceptance', certification: 'Certification' };
const CHANNEL_LABELS: Record<EvidenceChannelKey, string> = { builderTraining: 'Builder training', neutralBenchmark: 'Neutral benchmark', customerField: 'Customer field', personalFit: 'Personal fit' };

function describeEvidenceType(entry: { status: string; count: number }): string {
  if (entry.status === 'evidence_available' && Number(entry.count) > 0) return `${entry.count} run${entry.count === 1 ? '' : 's'}`;
  return entry.status === 'unknown' ? 'not measured' : 'none yet';
}

function NodeEvidence({ node }: { node: ChainNode }) {
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {EVIDENCE_CHANNEL_KEYS.map((key) => {
        const channel = node.evidenceChannels[key];
        return (
          <li key={key} className="rounded-md border border-ink-800 p-2.5">
            <p className="text-xs font-medium text-ink-200">{CHANNEL_LABELS[key]}</p>
            {channel.status === 'unavailable' ? (
              <p className="mt-1 text-xs text-ink-500">Sign in to see your own evidence. It stays private to your organization.</p>
            ) : (
              <dl className="mt-1 space-y-0.5">
                {EVIDENCE_TYPE_KEYS.map((typeKey) => (
                  <div key={typeKey} className="flex items-baseline justify-between gap-2 text-xs">
                    <dt className="text-ink-500">{TYPE_LABELS[typeKey]}</dt>
                    <dd className="text-ink-300">{describeEvidenceType(channel.evidence[typeKey])}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export default function ChainOfferingResume({ offering }: { offering: ChainOffering }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const operationKeys = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  async function mutate(path: string, extra: Record<string, unknown> = {}) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      const { data: { session } } = await createClient().auth.getSession();
      const payload = { ...extra };
      const fingerprint = `${path} ${stableJson(payload)}`;
      let idempotencyKey = operationKeys.current.get(fingerprint);
      if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); operationKeys.current.set(fingerprint, idempotencyKey); }
      await callBackend(path, { jwt: session?.access_token, method: 'POST', body: { ...payload, idempotencyKey } });
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'The chain could not be updated.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const installed = offering.acquisition?.lifecycle === 'installed';
  const acquired = installed && offering.acquisition?.authority === 'exact';
  const upgradeRequired = installed && offering.acquisition?.authority === 'upgrade_required';
  return (
    <main className="min-h-screen px-4 py-10"><article className="mx-auto max-w-4xl">
      <Link href="/workflows" className="text-sm text-ink-500 hover:text-ink-200">← Agents</Link>
      <header className="mt-6 border-b border-ink-800 pb-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold text-ink-50">{offering.name}</h1>
              <span className="rounded border border-ink-700 px-2 py-0.5 text-xs text-ink-300">Agent chain</span>
              {offering.privatePreview && <span className="rounded border border-violet-500/40 px-2 py-0.5 text-xs text-violet-300">Private preview</span>}
            </div>
            <p className="mt-3 max-w-2xl text-ink-200">{offering.outcome}. You choose the outcome; the chain runs its two agents in order and hands off one typed {offering.handoffKind} between them.</p>
            <p className="mt-2 text-xs text-ink-500">Built by {offering.builder.name} · offering v{offering.version.number} · composition {offering.version.digest.slice(0, 12)}…</p>
          </div>
          {acquired
            ? <Link href="/work" className="btn-primary px-4 py-2 text-sm">Start a production</Link>
            : upgradeRequired
              ? <span className="rounded border border-amber-500/40 px-4 py-2 text-sm text-amber-300">Upgrade required</span>
              : <button disabled={busy} onClick={() => mutate(`/api/v2/agents/discovery/chains/${encodeURIComponent(offering.slug)}/acquire`, { offeringVersionId: offering.version.id, offeringDigest: offering.version.digest })} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Acquiring chain…' : 'Use this chain'}</button>}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
        {upgradeRequired && <p role="status" className="mt-3 text-sm text-amber-300">Your installed chain is an older immutable version. It cannot run this newer composition until an explicit upgrade is available.</p>}
        {installed && (
          <div className="mt-5 border-t border-ink-800 pt-4">
            <p className="text-xs text-ink-500">{offering.historyLanguage}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-ink-400"><input aria-label="Confirm removing this chain without deleting history" type="checkbox" checked={confirmUninstall} onChange={(event) => setConfirmUninstall(event.target.checked)} />I understand this removes access, not history</label>
              <button className="rounded border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-50" disabled={busy || !confirmUninstall} onClick={() => mutate(`/api/v2/agents/discovery/chains/${encodeURIComponent(offering.slug)}/uninstall`)}>Remove chain</button>
            </div>
          </div>
        )}
      </header>

      <section className="py-7">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">The ordered chain</h2>
        <p className="mt-2 text-xs text-ink-500">Two exact immutable agent versions, acquired together or not at all. Step 1 plans; its {offering.handoffKind} is verified before Step 2 may start; Step 2 delivers the final {offering.finalArtifactKind.replace('_', ' ')}. If Step 1 does not succeed, Step 2 never runs and remaining reservations are released.</p>
        <ol className="mt-4 space-y-4">
          {offering.orderedChain.map((node) => (
            <li key={node.ordinal} className="rounded-lg border border-ink-800 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-300">Step {node.ordinal + 1}</span>
                <p className="text-sm font-medium text-ink-100">{node.name}</p>
                <span className="text-xs text-ink-500">{node.role === 'generator' ? `prepares the ${offering.handoffKind}` : `delivers the ${offering.finalArtifactKind.replace('_', ' ')}`}</span>
              </div>
              <p className="mt-2 text-xs text-ink-400">{node.limitations}</p>
              <p className="mt-1 text-xs text-ink-500">Exact version {node.version.number || node.version.id.slice(0, 8)} · authority {node.version.authorityDigest.slice(0, 12)}… · engines: {node.supportedEngines.join(', ') || 'not established'}</p>
              <NodeEvidence node={node} />
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-ink-500">Evidence is counted separately per component and per source. Implexa does not combine them into a score, rating, or rank.</p>
      </section>

      <div className="grid gap-8 border-t border-ink-800 py-7 md:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Required before starting</h2>
          <p className="mt-3 text-sm text-ink-300">{offering.requiredInput.label} · required</p>
          <p className="mt-1 text-xs text-amber-300">{offering.requiredInput.disclosure}</p>
          <p className="mt-3 text-xs text-ink-500">Quality modes: {offering.qualityModes.join(', ')}.</p>
        </section>
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Budget and provider use</h2>
          <p className="mt-3 text-sm text-ink-300">Up to {offering.creditPolicy.maxTotalCredits} credits per production; Step 1 is allocated {offering.creditPolicy.generatorBudgetSharePercent}% of the ceiling. Unused reservations are released when the production closes.</p>
          {offering.consequentialCeiling.zeroDefault
            ? <p className="mt-2 text-xs text-emerald-300">Zero provider calls and zero provider spend by default. This chain uses your supplied footage and local Remotion assets only.</p>
            : <p className="mt-2 text-xs text-amber-300">Provider ceilings: {offering.consequentialCeiling.maxProviderCalls} calls, {offering.consequentialCeiling.maxSpendMinor} {offering.consequentialCeiling.currency} minor units. Runs use your own connected provider accounts.</p>}
          <p className="mt-2 text-xs text-ink-500">Everything runs with your organization&apos;s own connections and credentials. Nothing of the builder&apos;s crosses the boundary.</p>
        </section>
      </div>
    </article></main>
  );
}
