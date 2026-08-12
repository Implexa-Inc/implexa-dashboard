'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { DiscoveredAgent } from '@/lib/agent-discovery';

const TRUST_LABELS: Record<string, string> = { deterministicVerification: 'Deterministic verification', judgeReview: 'Judge review', humanAcceptance: 'Human acceptance', certification: 'Certification' };
const TRUST_KEYS = Object.keys(TRUST_LABELS);
function trustChannel(agent: DiscoveredAgent, key: string) {
  const channel = agent.trust?.[key];
  if (channel?.status === 'evidence_available' && Number.isInteger(channel.count) && Number(channel.count) > 0) return channel;
  if (channel?.status === 'insufficient_evidence') return { status: 'insufficient_evidence' as const };
  return { status: 'unknown' as const };
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export default function AgentResume({ agent }: { agent: DiscoveredAgent }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedUpdate, setAcceptedUpdate] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [providerCostAcknowledged, setProviderCostAcknowledged] = useState(false);
  const [inputBindings, setInputBindings] = useState<Record<string, string>>({});
  const operationKeys = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const fields = agent.requiredInputs?.fields || [];
  const hasRequiredFile = fields.some((field) => field.required && field.kind === 'file');
  const missingRequired = fields.some((field) => field.required && !String(inputBindings[field.key] || '').trim());
  async function mutate(path: string, extra: Record<string, unknown> = {}) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      const { data: { session } } = await createClient().auth.getSession();
      const payload = { versionId: agent.version.id, inputBindings: {}, ...extra };
      const fingerprint = `${path}\u0000${stableJson(payload)}`;
      let idempotencyKey = operationKeys.current.get(fingerprint);
      if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); operationKeys.current.set(fingerprint, idempotencyKey); }
      const result = await callBackend(path, { jwt: session?.access_token, method: 'POST', body: { ...payload, idempotencyKey } });
      if (path.endsWith('/audition') && typeof result?.audition?.requestId === 'string') {
        router.push('/work');
        return;
      }
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'The agent could not be updated.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const update = agent.update;
  const action = agent.readiness.state === 'Available'
    ? <button disabled={busy} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/acquire`)} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Adding agent…' : agent.ownership === 'Owned' ? 'Finish setup' : 'Use agent'}</button>
    : agent.readiness.state === 'Needs setup'
      ? hasRequiredFile
        ? <Link href={`/workflows/${encodeURIComponent(agent.slug)}/activate`} className="btn-primary px-4 py-2 text-sm">Finish setup</Link>
        : <button disabled={busy || missingRequired} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/finish-setup`, { inputBindings })} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Checking setup…' : 'Finish setup'}</button>
      : agent.readiness.state === 'Update available' && update
        ? <button disabled={busy || (update.authorityDiff.changesAuthority && !acceptedUpdate)} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/update`, { acceptAuthorityChange: acceptedUpdate })} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">Accept update</button>
        : agent.readiness.state === 'Ready'
          ? <Link href={`/workflows/${encodeURIComponent(agent.slug)}?legacy=1`} className="btn-primary px-4 py-2 text-sm">Use agent</Link>
          : null;
  const auditionAction = agent.audition && agent.readiness.state === 'Ready' ? (
    <div className="mt-5 rounded-md border border-brand-500/30 bg-brand-500/5 p-4">
      <p className="text-sm font-medium text-ink-100">Try this exact version free</p>
      <p className="mt-1 text-xs text-ink-400">{agent.audition.remaining} of {agent.audition.allowance} free audition{agent.audition.allowance === 1 ? '' : 's'} remaining. Allowance is used only after the run produces a reviewable result.</p>
      <p className="mt-2 text-xs text-amber-200">{agent.audition.disclosure}</p>
      <label className="mt-3 flex items-start gap-2 text-xs text-ink-300"><input type="checkbox" checked={providerCostAcknowledged} onChange={(event) => setProviderCostAcknowledged(event.target.checked)} /><span>I understand this uses my connected provider account and its usage may be billed by that provider.</span></label>
      <button className="btn-primary mt-3 px-4 py-2 text-sm disabled:opacity-50" disabled={busy || !agent.audition.eligible || !providerCostAcknowledged} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/audition`, { providerCostAcknowledged: true })}>{busy ? 'Starting audition…' : agent.audition.eligible ? 'Run free audition' : 'No free auditions remaining'}</button>
    </div>
  ) : null;
  return (
    <main className="min-h-screen px-4 py-10"><article className="mx-auto max-w-4xl">
      <Link href="/workflows" className="text-sm text-ink-500 hover:text-ink-200">← Agents</Link>
      <header className="mt-6 border-b border-ink-800 pb-7">
        <div className="flex flex-wrap items-start justify-between gap-5"><div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-semibold text-ink-50">{agent.name}</h1><span className="rounded border border-ink-700 px-2 py-0.5 text-xs text-ink-300">{agent.ownership}</span><span className="rounded border border-sky-500/40 px-2 py-0.5 text-xs text-sky-300">{agent.readiness.state}</span></div>
          <p className="mt-3 max-w-2xl text-ink-200">{agent.job}</p><p className="mt-2 text-xs text-ink-500">Built by {agent.builder.name} · v{agent.version.number} · updated {new Date(agent.version.updatedAt).toLocaleDateString()}</p>
        </div>{action}</div>
        {agent.readiness.reason && <p role="status" className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{agent.readiness.reason}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
        {auditionAction}
        {update && <div className="mt-4 rounded-md border border-ink-700 p-3 text-sm text-ink-300"><p className="font-medium">Update {update.fromVersion || 'current'} → {update.toVersion}</p><p className="mt-1 text-xs text-ink-500">Added capabilities: {update.authorityDiff.addedCapabilities.join(', ') || 'none'} · Removed capabilities: {update.authorityDiff.removedCapabilities.join(', ') || 'none'} · Added permissions: {update.authorityDiff.addedPermissions.join(', ') || 'none'} · Removed permissions: {update.authorityDiff.removedPermissions.join(', ') || 'none'}</p>{update.authorityDiff.changesAuthority && <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={acceptedUpdate} onChange={(event) => setAcceptedUpdate(event.target.checked)} /><span>I accept the capability and permission changes for this exact version.</span></label>}</div>}
        {agent.ownership === 'Owned' && <div className="mt-4 flex gap-3"><Link href={`/workflows/${agent.slug}?legacy=1&tab=setup`} className="text-sm text-brand-400 hover:underline">Configure</Link><Link href="/training" className="text-sm text-brand-400 hover:underline">Train</Link></div>}
        {agent.acquisition && agent.acquisition.lifecycle !== 'uninstalled' && <div className="mt-5 border-t border-ink-800 pt-4"><p className="text-xs text-ink-500">Disabling or removing this agent pauses schedules. Prior runs, receipts, reviews, learning evidence, and version provenance stay intact.</p><div className="mt-3 flex flex-wrap items-center gap-3">{agent.acquisition.lifecycle === 'disabled' ? <button className="btn-outline px-3 py-1.5 text-xs" disabled={busy} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/enable`)}>Enable</button> : <button className="btn-outline px-3 py-1.5 text-xs" disabled={busy} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/disable`)}>Disable</button>}<label className="flex items-center gap-2 text-xs text-ink-400"><input aria-label="Confirm removing this agent without deleting history" type="checkbox" checked={confirmUninstall} onChange={(event) => setConfirmUninstall(event.target.checked)} />I understand this removes access, not history</label><button className="rounded border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-50" disabled={busy || !confirmUninstall} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/uninstall`)}>Remove agent</button></div></div>}
      </header>
      <div className="grid gap-8 py-8 md:grid-cols-2">
        <section><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">What it can and cannot do</h2><p className="mt-3 text-sm text-ink-300">{agent.limitations}</p></section>
        <section><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Tested compatibility</h2><p className="mt-3 text-sm text-ink-300">{agent.testedCompatibility.executionEngines.length ? agent.testedCompatibility.executionEngines.join(', ') : 'No supported engine has been established.'}</p></section>
        <section className="md:col-span-2"><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Trust evidence</h2><ul className="mt-3 grid gap-3 sm:grid-cols-2">{TRUST_KEYS.map((key) => { const channel = trustChannel(agent, key); return <li key={key} className="rounded-md border border-ink-800 p-3"><p className="text-sm text-ink-200">{TRUST_LABELS[key]}</p><p className="mt-1 text-xs text-ink-500">{channel.status === 'evidence_available' ? `${channel.count} exact-version evidence record${channel.count === 1 ? '' : 's'}` : channel.status.replaceAll('_', ' ')}</p></li>; })}</ul></section>
        <section><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Required inputs</h2>{fields.length ? <ul className="mt-3 space-y-3">{fields.map((field) => <li key={field.key} className="text-sm text-ink-300"><label className="font-medium" htmlFor={`agent-input-${field.key}`}>{field.label}{field.required ? ' · required' : ' · optional'}</label><p className="text-xs text-ink-500">{field.description}</p>{field.kind === 'choice' ? <select id={`agent-input-${field.key}`} value={inputBindings[field.key] || ''} onChange={(event) => setInputBindings((current) => ({ ...current, [field.key]: event.target.value }))} className="mt-2 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm"><option value="">Choose…</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select> : field.kind === 'text' ? <input id={`agent-input-${field.key}`} value={inputBindings[field.key] || ''} onChange={(event) => setInputBindings((current) => ({ ...current, [field.key]: event.target.value }))} className="mt-2 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm" /> : <p id={`agent-input-${field.key}`} className="mt-2 text-xs text-amber-300">Choose and verify this file in the Desktop setup flow. Local paths are never sent to the server.</p>}</li>)}</ul> : <p className="mt-3 text-sm text-ink-500">No per-run inputs declared.</p>}</section>
        <section><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Integrations and permissions</h2>{agent.requirements?.requirements.length ? <ul className="mt-3 space-y-3">{agent.requirements.requirements.map((requirement) => <li key={requirement.id} className="text-sm text-ink-300"><span className="font-medium">{requirement.setup.title}</span><p className="text-xs text-ink-500">{requirement.permission_category.replaceAll('_', ' ')} · {requirement.requirement_type.replaceAll('_', ' ')}</p><ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-ink-400">{requirement.setup.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></li>)}</ul> : <p className="mt-3 text-sm text-ink-500">No integration requirements declared.</p>}</section>
        {agent.examples?.length ? <section className="md:col-span-2"><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Examples</h2>{agent.examples.map((example, index) => <div key={index} className="mt-3 rounded-md border border-ink-800 p-4"><p className="text-sm font-medium text-ink-200">{example.title || 'Example result'}</p><p className="mt-2 whitespace-pre-wrap text-sm text-ink-400">{example.body}</p></div>)}</section> : null}
      </div>
    </article></main>
  );
}
