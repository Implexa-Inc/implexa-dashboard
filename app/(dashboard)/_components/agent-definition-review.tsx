'use client';

import { useState } from 'react';
import type { AgentRevisionContract } from '../../../lib/workflow-catalog';
import Modal from './modal';

/** Read-only entry to definition review. This is not a Check invocation. */
export default function AgentDefinitionReview({ slug, definition, versionSource, updateAvailable, revisePending, statusUnavailable }: {
  slug?: string;
  definition: AgentRevisionContract | null;
  versionSource: 'live' | 'installed' | null;
  updateAvailable: boolean;
  revisePending: boolean;
  statusUnavailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="text-xs underline underline-offset-2 text-ink-400 hover:text-ink-200" onClick={() => setOpen(true)}>
      Review definition
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title="Agent definition" maxWidth="max-w-3xl">
      <div className="space-y-4 text-sm text-ink-200">
        <p>Read-only snapshot from the authenticated agent page. Reload the page to refresh it. Opening this screen does not check, edit or run the agent.</p>
        {statusUnavailable && <p role="status">Edit status is unavailable. This snapshot cannot establish whether a revision is in progress.</p>}
        {revisePending && <p role="status">An edit is pending. The displayed version may be superseded when it lands.</p>}
        {!definition ? <p role="status">The exact versioned definition is unavailable. Display summaries are not a substitute.</p> : <>
          <div className="rounded border border-ink-700 p-3 space-y-2">
            <p>{versionSource === 'live' ? 'Live version at page load' : versionSource === 'installed' ? 'Installed version — not necessarily the latest published definition' : 'Version source unknown — currentness not established'}</p>
            <p className="break-all font-mono text-xs">Base version: {definition.workflow_version_id}</p>
            {updateAvailable && <p>A newer version is available. This snapshot must not be treated as the current edit base.</p>}
          </div>
          {definition.steps.map((step) => <details key={step.order} className="rounded border border-ink-700 p-3">
            <summary className="cursor-pointer">Stage {step.order}</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words text-xs">{step.label}</pre>
            <details className="mt-3"><summary className="cursor-pointer">Exact stage contract (including inputs and outputs)</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(step, null, 2)}</pre>
            </details>
          </details>)}
          <details className="rounded border border-ink-700 p-3"><summary className="cursor-pointer">Full versioned definition</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words text-xs">{JSON.stringify(definition, null, 2)}</pre>
          </details>
        </>}
        <section className="rounded border border-amber-500/30 p-3 space-y-2" aria-label="Check availability">
          <h3 className="font-medium">Read-only definition Check</h3>
          <p>Saved reports may be loaded below. No saved report does not mean no issues were found. Operator attestations are not system-verified independent reviews.</p>
          <p>Definition review is not execution verification.</p>
        </section>
        {slug && definition && <DefinitionCheckAction key={`${slug}:${definition.workflow_version_id}`} slug={slug} baseVersionId={definition.workflow_version_id} blocked={revisePending || statusUnavailable || updateAvailable || versionSource !== 'live'} />}
        {slug && definition && <SavedDefinitionFindings key={`${slug}:${definition.workflow_version_id}:${revisePending}:${statusUnavailable}:${updateAvailable}`} slug={slug} baseVersionId={definition.workflow_version_id} previewBlocked={revisePending || statusUnavailable || updateAvailable || versionSource !== 'live'} />}
      </div>
    </Modal>
  </>;
}

export function DefinitionCheckAction({ slug, baseVersionId, blocked }: { slug: string; baseVersionId: string; blocked: boolean }) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [request, setRequest] = useState<{ requestId: string; state: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('Check availability before requesting a report. Your updated Desktop must be online.');
  const storageKey = `definition-check:${slug}:${baseVersionId}`;
  const endpoint = `/api/agents/definition-review?action=check&slug=${encodeURIComponent(slug)}&baseVersionId=${encodeURIComponent(baseVersionId)}`;
  async function refresh() {
    setBusy(true);
    try {
      const retained = sessionStorage.getItem(storageKey);
      const response = await fetch(`${endpoint}${retained ? `&requestId=${encodeURIComponent(retained)}` : ''}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error();
      setReady(data.requestBusReady === true && !data.historical);
      setRequest(data.request);
      // A missing row after a lost reply is not proof that enqueue cannot still
      // arrive. An explicit resubmission reuses the retained UUID, never a new one.
      setUncertain(!!retained && !data.request);
      setMessage(data.request ? `Check ${data.request.state}. ${data.request.state === 'done' ? 'Load saved Check reports below; findings remain unreviewed.' : 'Refresh to read progress; this does not restart the Check.'}`
        : retained ? 'No confirmed request yet. Resubmit the same request identity or refresh; no automatic retry.'
        : data.historical ? 'This definition is no longer current. Reload the agent page.'
        : data.requestBusReady ? 'Ready to request a read-only report. No agent run or edit will be started.' : 'Check is unavailable until the backend update is installed.');
    } catch { setReady(false); setMessage('Check status unavailable. No new request was sent.'); }
    finally { setBusy(false); }
  }
  async function enqueue() {
    setBusy(true);
    try {
      const retained = sessionStorage.getItem(storageKey);
      const terminal = request && ['done','cancelled','failed'].includes(request.state);
      const requestId = terminal ? crypto.randomUUID() : retained || crypto.randomUUID();
      sessionStorage.setItem(storageKey, requestId); // before delivery; survive reload/uncertain reply
      setRequest({ requestId, state: 'unconfirmed' }); setUncertain(true);
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseVersionId, requestId }) });
      const data = await response.json();
      if (!data.ok && ['check_already_pending','stale_definition','not_found','invalid_check_input'].includes(data.reason)) {
        // These are confirmed refusals, not an uncertain write. A competing
        // tab's live Check can be discovered by the next owner-scoped refresh.
        sessionStorage.removeItem(storageKey); setUncertain(false); setRequest(null); setReady(false);
        setMessage(data.reason === 'check_already_pending' ? 'Another Check is already pending. Refresh to view that request.' : 'Check was refused. Reload the current agent page before trying again.');
        return;
      }
      if (!response.ok || !data.ok || data.requestId !== requestId) throw new Error();
      setRequest({ requestId, state: data.state }); setUncertain(false);
      setMessage('Check queued on your Desktop. Refresh status, then load its saved report below. Nothing was edited or executed by this Check.');
    } catch { setMessage('Request delivery is unconfirmed. Refresh status or explicitly resubmit the same request; do not start another Check.'); }
    finally { setBusy(false); }
  }
  const live = request && !['done','cancelled','failed'].includes(request.state);
  return <section aria-label="Request definition Check" className="space-y-2">
    <button type="button" className="btn-secondary" disabled={busy} onClick={refresh}>Refresh Check status</button>
    <button type="button" className="btn-secondary" disabled={busy || blocked || !ready || (!!live && !uncertain)} onClick={enqueue}>{uncertain ? 'Resubmit same Check request' : request ? 'Request another Check' : 'Check definition'}</button>
    <p role="status">{message}</p>
    {request && <p className="text-xs break-all">Request: {request.requestId} — {request.state}</p>}
    {blocked && <p>Reload a current, editable agent page before requesting Check.</p>}
  </section>;
}

type Finding = { reportId: string; finding: { id: string; explanation: string; quotes: Array<{ location: string; text: string }>; plausibleCompliantInterpretation?: string; missingEvidence?: string[] }; assessmentId: string | null; assessment?: { rationale?: string } | null; provenance: string; classification: { status: string; draftEligible: boolean } };
type ReportSummary = { reportId: string; requestId: string | null; provenanceKind: string; findingCount: number; state: string };

export function SavedDefinitionFindings({ slug, baseVersionId, previewBlocked }: { slug: string; baseVersionId: string; previewBlocked: boolean }) {
  const [result, setResult] = useState<{ historical?: boolean; truncated?: boolean; state?: string; items?: Finding[]; reports?: ReportSummary[] } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setMessage(''); setResult(null);
    try {
      const r = await fetch(`/api/agents/definition-review?slug=${encodeURIComponent(slug)}&baseVersionId=${encodeURIComponent(baseVersionId)}`, { cache: 'no-store' });
      const data = await r.json();
      if (!r.ok || !data.ok || data.baseVersionId !== baseVersionId || !Array.isArray(data.items)) throw new Error();
      setResult(data);
    } catch { setMessage('Saved review unavailable. Nothing was checked or changed.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3" aria-label="Saved definition findings">
    <button type="button" disabled={busy} className="btn-secondary" onClick={load}>{busy ? 'Loading…' : 'Load saved Check reports'}</button>
    {message && <p role="status">{message}</p>}
    {result?.state === 'no_saved_report' && <p>No saved report for this exact version. This is not a passing Check.</p>}
    {result?.historical && <p>Historical definition — preview is disabled.</p>}
    {result?.truncated && <p>Showing the latest 20 reports. Older reports are not included.</p>}
    {result?.state === 'saved_reports' && result.items?.length === 0 && <p>The saved report contains no findings; this is not execution verification.</p>}
    {result?.reports?.map(report => <div key={report.reportId} className="text-xs space-y-1">
      <p className="break-all">Report {report.reportId}: {report.findingCount} finding(s) — {report.state === 'stale' ? 'source binding changed' : report.provenanceKind === 'system_generated' ? 'automated Check, not certification' : 'operator import, not certification'}.</p>
      {report.requestId && <p className="break-all">Check request: {report.requestId}</p>}
    </div>)}
    {result?.items?.map((item, i) => <SavedFinding key={`${item.reportId}:${item.assessmentId}:${i}`} item={item} slug={slug} baseVersionId={baseVersionId} blocked={previewBlocked || !!result.historical} />)}
  </section>;
}

function SavedFinding({ item, slug, baseVersionId, blocked }: { item: Finding; slug: string; baseVersionId: string; blocked: boolean }) {
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [after, setAfter] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ change: { before: string; after: string }; reviewRequired: boolean } | null>(null);
  const [message, setMessage] = useState('');
  const quote = item.finding.quotes[quoteIndex];
  async function showPreview() {
    setBusy(true); setPreview(null); setMessage('');
    try {
      const r = await fetch(`/api/agents/definition-review?slug=${encodeURIComponent(slug)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseVersionId, reportId: item.reportId, assessmentId: item.assessmentId, findingId: item.finding.id, edit: { location: quote.location, before: quote.text, after } }) });
      const data = await r.json();
      if (!r.ok || !data.ok || data.status !== 'preview' || data.baseVersionId !== baseVersionId || !data.change || data.reviewRequired !== true || data.applyAllowed !== false) {
        setMessage(data.reason === 'report_not_in_loaded_window' ? 'This report is not in the loaded latest-report window. Reload the saved reports.' : 'Preview refused or unavailable. Reload the report before trying again.'); return;
      }
      setPreview(data);
    } catch { setMessage('Preview unavailable. Nothing changed.'); }
    finally { setBusy(false); }
  }
  return <article className="rounded border border-ink-700 p-3 space-y-3">
    <h4>{item.finding.id}: {item.classification.status}</h4>
    {item.classification.status === 'conflicting_assessments' && <p>Saved reviews disagree. An operator must import a new report and review it; adding another assessment here cannot clear the conflict.</p>}
    <p>{item.finding.explanation}</p><p className="text-xs">{item.provenance}</p>
    {item.finding.plausibleCompliantInterpretation && <p>Possible compliant interpretation: {item.finding.plausibleCompliantInterpretation}</p>}
    {!!item.finding.missingEvidence?.length && <p>Evidence still needed: {item.finding.missingEvidence.join('; ')}</p>}
    {typeof item.assessment?.rationale === 'string' && <p>Assessment rationale: {item.assessment.rationale}</p>}
    {item.finding.quotes.map((q, i) => <blockquote key={i} className="whitespace-pre-wrap text-xs">{q.location}: {q.text}</blockquote>)}
    {!blocked && item.assessmentId && item.classification.draftEligible && quote && <>
      <label className="block">Quoted text to replace<select disabled={busy} className="block w-full" value={quoteIndex} onChange={e => { setQuoteIndex(Number(e.target.value)); setPreview(null); }}>{item.finding.quotes.map((q, i) => <option key={i} value={i}>{q.location} — quote {i + 1}</option>)}</select></label>
      <label className="block">Proposed replacement<textarea disabled={busy} className="block w-full" value={after} onChange={e => { setAfter(e.target.value); setPreview(null); }} /></label>
      <button type="button" disabled={busy || !after.trim()} onClick={showPreview} className="btn-secondary">{busy ? 'Preparing preview…' : 'Preview replacement'}</button>
    </>}
    {blocked && <p>Preview unavailable for this page/version state. Reload before editing.</p>}
    {message && <p role="status">{message}</p>}
    {preview && <section aria-label="Unreviewed draft preview"><h5>Unreviewed draft — not applied</h5><pre className="whitespace-pre-wrap">Before: {preview.change.before}</pre><pre className="whitespace-pre-wrap">After: {preview.change.after}</pre><p>The replacement still needs review. This preview cannot apply or run the agent.</p></section>}
  </article>;
}
