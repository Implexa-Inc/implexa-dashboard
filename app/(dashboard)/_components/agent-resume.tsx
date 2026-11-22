'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import AgentOverview from './agent-overview';
import AgentPageHeader from './agent-page-header';
import AgentTabs from './agent-tabs';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { DiscoveredAgent } from '@/lib/agent-discovery';
import { parseEvidenceChannels, EVIDENCE_CHANNEL_KEYS, EVIDENCE_TYPE_KEYS, type EvidenceChannelKey } from '@/lib/agent-evidence-channels';

const TRUST_LABELS: Record<string, string> = { deterministicVerification: 'Deterministic verification', judgeReview: 'Judge review', humanAcceptance: 'Human acceptance', certification: 'Certification' };
// Provenance is a SECOND axis, not a replacement for the evidence types above.
// A card answers "where did this evidence come from"; the rows inside it keep
// answering "what kind of evidence is it". Neither is ever collapsed into the
// other, and nothing here is ever combined into one number.
const CHANNEL_LABELS: Record<EvidenceChannelKey, string> = {
  builderTraining: 'Builder training',
  neutralBenchmark: 'Neutral benchmark',
  customerField: 'Customer field',
  personalFit: 'Personal fit',
};
const CHANNEL_DESCRIPTIONS: Record<EvidenceChannelKey, string> = {
  builderTraining: "Runs by the builder's own organization on this exact version.",
  neutralBenchmark: 'An independent benchmark run by neither the builder nor a buyer. Tukido has not established a benchmark authority, so this is not measured.',
  customerField: 'Runs by other organizations that acquired or auditioned this exact version.',
  personalFit: 'Your own organization’s runs of this exact version. Private to you — the builder and other buyers never see it.',
};
function describeEvidenceType(entry: { status: string; count: number }): string {
  if (entry.status === 'evidence_available' && Number(entry.count) > 0) return `${entry.count} run${entry.count === 1 ? '' : 's'}`;
  return entry.status === 'unknown' ? 'not measured' : 'none yet';
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export default function AgentResume({ agent,surface='page',detailUnavailable=false }: { agent: DiscoveredAgent;surface?:'page'|'setup'|'action';detailUnavailable?:boolean }) {
  const query=useSearchParams();
  const activeTab=query.get('tab')==='setup'?'setup':query.get('tab')==='runs'?'runs':'overview';
  const setupHref=`/workflows/${encodeURIComponent(agent.slug)}?tab=setup`;
  const projectedAuditionConfiguration = agent.auditionConfiguration;
  const ownerAuditionConfiguration = projectedAuditionConfiguration
    && Number.isInteger(projectedAuditionConfiguration.allowance)
    && projectedAuditionConfiguration.allowance >= 0
    && projectedAuditionConfiguration.allowance <= 5
    && projectedAuditionConfiguration.maxAllowance === 5
    && projectedAuditionConfiguration.providerCostMode === 'buyer_owned'
    && typeof projectedAuditionConfiguration.disclosure === 'string'
    && projectedAuditionConfiguration.disclosure.length > 0
    ? projectedAuditionConfiguration : null;
  // Fail closed and say WHICH kind of nothing this is. A malformed projection
  // must never be rendered as four confident empty cards: that would turn "the
  // server did not tell us" into "this agent has no evidence".
  const evidenceChannels = parseEvidenceChannels(agent.evidenceChannels);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedUpdate, setAcceptedUpdate] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [providerCostAcknowledged, setProviderCostAcknowledged] = useState(false);
  const [auditionAllowance, setAuditionAllowance] = useState(ownerAuditionConfiguration?.allowance ?? 0);
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
        ? <Link href={setupHref} className="btn-primary px-4 py-2 text-sm">Finish setup</Link>
        : <button disabled={busy || missingRequired} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/finish-setup`, { inputBindings })} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Checking setup…' : 'Finish setup'}</button>
      : agent.readiness.state === 'Update available' && update
        ? <button disabled={busy || (update.authorityDiff.changesAuthority && !acceptedUpdate)} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/update`, { acceptAuthorityChange: acceptedUpdate })} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">Accept update</button>
        : agent.readiness.state === 'Ready'
          ? detailUnavailable?<button type="button" disabled className="btn-primary px-4 py-2 text-sm opacity-50">Run status unavailable</button>:<Link href={`/workflows/${encodeURIComponent(agent.slug)}?run=1`} className="btn-primary px-4 py-2 text-sm">Run</Link>
          : null;
  const auditionAction = agent.audition && agent.readiness.state === 'Ready' ? (
    <div className="mt-5 rounded-md border border-brand-500/30 bg-brand-500/5 p-4">
      <p className="text-sm font-medium text-ink-100">Try this exact version free</p>
      <p className="mt-1 text-xs text-ink-400">{agent.audition.remaining} of {agent.audition.allowance} free audition{agent.audition.allowance === 1 ? '' : 's'} remaining. Allowance is used only after the run produces a reviewable result.</p>
      <p className="mt-2 text-xs text-state-needs">{agent.audition.disclosure}</p>
      <label className="mt-3 flex items-start gap-2 text-xs text-ink-300"><input type="checkbox" checked={providerCostAcknowledged} onChange={(event) => setProviderCostAcknowledged(event.target.checked)} /><span>I understand this uses my connected provider account and its usage may be billed by that provider.</span></label>
      <button className="btn-primary mt-3 px-4 py-2 text-sm disabled:opacity-50" disabled={busy || !agent.audition.eligible || !providerCostAcknowledged} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/audition`, { providerCostAcknowledged: true })}>{busy ? 'Starting audition…' : agent.audition.eligible ? 'Run free audition' : 'No free auditions remaining'}</button>
    </div>
  ) : null;
  const auditionConfiguration = agent.ownership === 'Owned' ? ownerAuditionConfiguration ? (
    <div className="mt-5 rounded-md border border-ink-700 bg-ink-900/40 p-4">
      <p className="text-sm font-medium text-ink-100">Free auditions</p>
      <p className="mt-1 text-xs text-ink-400">Let each customer try this exact published version before committing. Tukido does not charge for these runs; customers use their connected provider account.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-300"><span className="block pb-1">Runs per customer</span><select aria-label="Free auditions per customer" value={auditionAllowance} onChange={(event) => setAuditionAllowance(Number(event.target.value))} className="rounded border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100">{Array.from({ length: ownerAuditionConfiguration.maxAllowance + 1 }, (_, allowance) => <option key={allowance} value={allowance}>{allowance === 0 ? 'Off' : allowance}</option>)}</select></label>
        <button className="btn-primary px-4 py-2 text-sm disabled:opacity-50" disabled={busy || auditionAllowance === ownerAuditionConfiguration.allowance} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/audition-policy`, { allowance: auditionAllowance })}>{busy ? 'Saving…' : 'Save audition setting'}</button>
      </div>
      <p className="mt-2 text-xs text-ink-500">Setting this to Off removes the buyer audition action. It does not change prior runs or evidence.</p>
    </div>
  ) : (
    <div role="status" className="mt-5 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-state-needs">Free audition settings are unavailable, so no setting can be changed.</div>
  ) : null;
  const hasEvidence=evidenceChannels.status==='ready'&&EVIDENCE_CHANNEL_KEYS.some(key=>{const channel=evidenceChannels.channels[key];return channel.status!=='unavailable'&&EVIDENCE_TYPE_KEYS.some(type=>channel.evidence[type].status==='evidence_available'&&channel.evidence[type].count>0);});
  const evidenceSection=<>        <details className="proof-disclosure md:col-span-2"><summary>Evidence and limits{evidenceChannels.status!=='ready'?' · unavailable':''}</summary><div className="mt-5">        <section className="md:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Evidence by source</h2>
          <p className="mt-2 text-xs text-ink-500">Each source is counted separately for this exact version. Tukido does not combine them into a score, rating, or rank.</p>
          {evidenceChannels.status === 'ready' ? (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">{EVIDENCE_CHANNEL_KEYS.map((key) => {
              const channel = evidenceChannels.channels[key];
              return (
                <li key={key} className="rounded-md border border-ink-800 p-3">
                  <p className="text-sm font-medium text-ink-200">{CHANNEL_LABELS[key]}</p>
                  <p className="mt-1 text-xs text-ink-500">{CHANNEL_DESCRIPTIONS[key]}</p>
                  {channel.status === 'unavailable' ? (
                    <p className="mt-2 text-xs text-ink-400">Sign in to see your own evidence for this version. It stays private to your organization.</p>
                  ) : (
                    <>
                      {/* Sliced, not round-tripped through Date: the parser has already proven this is a canonical UTC day, and constructing a Date is the one operation here that can throw. */}
                      <p className="mt-2 text-xs text-ink-400">{channel.status === 'unknown' ? 'Not measured' : `${channel.exactVersionRunCount} exact-version run${channel.exactVersionRunCount === 1 ? '' : 's'}`}{channel.latestEvidenceAt ? ` · latest ${channel.latestEvidenceAt.slice(0, 10)}` : ''}</p>
                      <dl className="mt-2 space-y-1">{EVIDENCE_TYPE_KEYS.map((typeKey) => (
                        <div key={typeKey} className="flex items-baseline justify-between gap-3 text-xs">
                          <dt className="text-ink-400">{TRUST_LABELS[typeKey]}</dt>
                          <dd className="text-ink-300">{describeEvidenceType(channel.evidence[typeKey])}</dd>
                        </div>
                      ))}</dl>
                    </>
                  )}
                </li>
              );
            })}</ul>
          ) : (
            <p role="status" className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-state-needs">Evidence by source is unavailable for this version, so none is shown. {evidenceChannels.reason}</p>
          )}
        </section></div></details>
</>;
  const setupContent=<section className="agent-setup-column" aria-label="Marketplace setup">
    {error&&<p role="alert" className="text-state-fail">{error}</p>}
        <section><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Required inputs</h2>{fields.length ? <ul className="mt-3 space-y-3">{fields.map((field) => <li key={field.key} className="text-sm text-ink-300"><label className="font-medium" htmlFor={`agent-input-${field.key}`}>{field.label}{field.required ? ' · required' : ' · optional'}</label><p className="text-xs text-ink-500">{field.description}</p>{field.kind === 'choice' ? <select id={`agent-input-${field.key}`} value={inputBindings[field.key] || ''} onChange={(event) => setInputBindings((current) => ({ ...current, [field.key]: event.target.value }))} className="mt-2 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm"><option value="">Choose…</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select> : field.kind === 'text' ? <input id={`agent-input-${field.key}`} value={inputBindings[field.key] || ''} onChange={(event) => setInputBindings((current) => ({ ...current, [field.key]: event.target.value }))} className="mt-2 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm" /> : <p id={`agent-input-${field.key}`} className="mt-2 text-xs text-state-needs">Choose and verify this file in the Desktop setup flow. Local paths are never sent to the server.</p>}</li>)}</ul> : <p className="mt-3 text-sm text-ink-500">No per-run inputs declared.</p>}</section>
        <section><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Integrations and permissions</h2>{agent.requirements?.requirements.length ? <ul className="mt-3 space-y-3">{agent.requirements.requirements.map((requirement) => <li key={requirement.id} className="text-sm text-ink-300"><span className="font-medium">{requirement.setup.title}</span><p className="text-xs text-ink-500">{requirement.permission_category.replaceAll('_', ' ')} · {requirement.requirement_type.replaceAll('_', ' ')}</p><ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-ink-400">{requirement.setup.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></li>)}</ul> : <p className="mt-3 text-sm text-ink-500">No integration requirements declared.</p>}</section>
    <div id="published-settings">{auditionConfiguration}{auditionAction}</div>
    {update && <div className="mt-4 rounded-md border border-ink-700 p-3 text-sm text-ink-300"><p className="font-medium">Update {update.fromVersion || 'current'} → {update.toVersion}</p><p className="mt-1 text-xs text-ink-500">Added capabilities: {update.authorityDiff.addedCapabilities.join(', ') || 'none'} · Removed capabilities: {update.authorityDiff.removedCapabilities.join(', ') || 'none'} · Added permissions: {update.authorityDiff.addedPermissions.join(', ') || 'none'} · Removed permissions: {update.authorityDiff.removedPermissions.join(', ') || 'none'}</p>{update.authorityDiff.changesAuthority && <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={acceptedUpdate} onChange={(event) => setAcceptedUpdate(event.target.checked)} /><span>I accept the capability and permission changes for this exact version.</span></label>}</div>}
    {agent.acquisition && agent.acquisition.lifecycle !== 'uninstalled' && <div className="mt-5 border-t border-ink-800 pt-4"><p className="text-xs text-ink-500">Disabling or removing this agent pauses schedules. Prior runs, receipts, reviews, learning evidence, and version provenance stay intact.</p><div className="mt-3 flex flex-wrap items-center gap-3">{agent.acquisition.lifecycle === 'disabled' ? <button className="btn-outline px-3 py-1.5 text-xs" disabled={busy} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/enable`)}>Resume agent</button> : <button className="btn-outline px-3 py-1.5 text-xs" disabled={busy} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/disable`)}>Pause agent</button>}<label className="flex items-center gap-2 text-xs text-ink-400"><input aria-label="Confirm removing this agent without deleting history" type="checkbox" checked={confirmUninstall} onChange={(event) => setConfirmUninstall(event.target.checked)} />I understand this removes access, not history</label><button className="rounded border border-rose-500/40 px-3 py-1.5 text-xs text-state-fail disabled:opacity-50" disabled={busy || !confirmUninstall} onClick={() => mutate(`/api/v2/agents/discovery/${agent.id}/uninstall`)}>Remove agent</button></div></div>}
    <div className="mt-6">{action}</div>
    {!hasEvidence&&<div className="mt-6">{evidenceSection}</div>}
  </section>;
  if(surface==='setup')return setupContent;
  if(surface==='action')return agent.readiness.state==='Available'?<>{error&&<p role="alert">{error}</p>}{action}</>:<Link href={setupHref} className="btn-primary px-4 py-2 text-sm">{agent.readiness.state==='Update available'?'Review update':'Finish setup'}</Link>;
  const overview=<AgentOverview inputs={fields} output={agent.job} limitations={agent.limitations}
    needs={<div className="card"><p>{agent.readiness.state}{agent.readiness.reason?` · ${agent.readiness.reason}`:''}</p><Link href={setupHref} className="agent-setup-link">Open setup →</Link></div>}
    trust={hasEvidence?evidenceSection:undefined}
  >        {agent.examples?.length ? <section className="md:col-span-2"><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Examples</h2>{agent.examples.map((example, index) => <div key={index} className="mt-3 rounded-md border border-ink-800 p-4"><p className="text-sm font-medium text-ink-200">{example.title || 'Example result'}</p><p className="mt-2 whitespace-pre-wrap text-sm text-ink-400">{example.body}</p></div>)}</section> : null}
</AgentOverview>;
  return <main className="app-page agent-resume-page"><article className="app-content">
    <Link href="/workflows" className="text-sm text-ink-500 hover:text-ink-200">← Agents</Link>
    <AgentPageHeader title={<h1>{agent.name}</h1>} description={agent.job}
      byline={<><span>Trained by <b>{agent.builder.name}</b></span><span>·</span><span>Version {agent.version.number}</span><span>·</span><span>{agent.ownership==='Owned'?'Built by you':agent.ownership==='Hired'?'In your agents':'Available'}</span></>}
      more={<><Link href={setupHref}>Setup and permissions</Link>{agent.ownership==='Owned'&&<><Link href={`/training/${encodeURIComponent(agent.slug)}`}>Train this agent</Link><Link href={`/training/${encodeURIComponent(agent.slug)}?chat=edit`}>Edit agent</Link><Link href={setupHref+'#published-settings'}>Free audition settings</Link></>}{agent.acquisition&&agent.acquisition.lifecycle!=='uninstalled'&&<><button type="button" disabled={busy} onClick={()=>mutate(`/api/v2/agents/discovery/${agent.id}/${agent.acquisition?.lifecycle==='disabled'?'enable':'disable'}`)}>{agent.acquisition.lifecycle==='disabled'?'Resume agent':'Pause agent'}</button><Link href={setupHref}>Manage access</Link></>}</>}
    >{agent.readiness.reason&&<p role="status" className="agent-page-notice">{agent.readiness.reason}</p>}{error&&<p role="alert" className="text-state-fail">{error}</p>}</AgentPageHeader>
    {activeTab==='overview'&&<div className="agent-sample-placeholder" role="img" aria-label="Sample preview unavailable"><span>Sample output</span><p>A sample preview is not available here yet.</p></div>}
    <AgentTabs active={activeTab} tabs={[
      {key:'overview',label:'Overview',href:`/workflows/${encodeURIComponent(agent.slug)}`},
      ...(agent.acquisition?[{key:'runs',label:'My runs',href:`/workflows/${encodeURIComponent(agent.slug)}?tab=runs`}]:[]),
      ...(agent.ownership==='Owned'?[{key:'training',label:'Training',href:`/training/${encodeURIComponent(agent.slug)}`}]:[]),
      {key:'setup',label:'Setup',href:setupHref},
    ]} panel={activeTab==='setup'?setupContent:activeTab==='runs'?<p role="status">Run history could not be loaded. Reload to try again.</p>:overview}/>
    <div className="agent-action-bar"><p className="min-w-0 text-sm text-ink-100">{agent.readiness.state==='Ready'?(detailUnavailable?'Run status unavailable':'Ready for your next run'):agent.readiness.state==='Available'?'Add this agent to get started':'Finish the required setup'}</p><div className="flex items-center gap-3"><Link href={setupHref} className="btn-outline px-4 py-2 text-sm">Setup</Link>{agent.readiness.state==='Ready'||agent.readiness.state==='Available'?action:<Link href={setupHref} className="btn-primary px-4 py-2 text-sm">Finish setup</Link>}</div></div>
  </article></main>;
}
