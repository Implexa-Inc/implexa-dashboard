'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import Modal from './modal';
import { orderedInputFields, type WorkflowInputContract } from '@/lib/workflow-input-contract';
import { describeAuthorityDelta, type AgentAuthorityDelta } from '@/lib/agent-authority-delta';
import { trainingProposedAdoptionPreview, trainingProposedAdoptionReceipt,
  trainingSuccessorAdoptionActionAvailable } from '@/lib/manager-training-run-preflight';

export type AvailableAgentUpdate = {
  workflow_version_id: string;
  published_snapshot_digest?:string;
  version: number;
  input_contract: WorkflowInputContract | null;
  input_contract_digest: string;
  state: string;
  /** The exact authority delta, when the backend classified this as expanding. */
  authority_delta?: AgentAuthorityDelta | null;
};

/** Owner acceptance of a compiler-passed proposal; never launches a run. */
export function ProposedAgentUpdateGate({ slug, baseVersionId }: { slug: string; baseVersionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<NonNullable<ReturnType<typeof trainingProposedAdoptionPreview>> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<NonNullable<ReturnType<typeof trainingProposedAdoptionReceipt>> | null>(null);
  const [applied, setApplied] = useState(false);
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const operation = useRef<{ digest: string; key: string } | null>(null);
  const freshPurpose = preview?.taskIdentityRepurpose;
  const purposeChanged = preview?.reason === 'task_identity_changed';
  const canActivate = (freshPurpose && (preview.managerTrainingRequirements?.readiness === 'reference_training_ready'
    || preview.managerTrainingRequirements?.readiness === 'not_applicable')) || !!receipt || (preview?.readiness === 'already_adopted'
    && (preview.eligibleRouteCount > 0 || preview.managerTrainingRequirements?.readiness === 'not_applicable'));
  const supabase = createClient();
  async function call(path: string, body?: unknown, idempotencyKey?: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sign in before reviewing this update.');
    return callBackend(path, { jwt: session.access_token, method: body ? 'POST' : 'GET', body, idempotencyKey });
  }
  const endpoint = `/api/v2/agent-training/agents/${encodeURIComponent(slug)}`;
  async function review() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setOpen(true); setMessage('');
    setPreview(null); setConfirmed(false); setReceipt(null); setApplied(false); setTargetId('');
    try {
      const projection = await call(`/api/v2/agents/${encodeURIComponent(slug)}/hardening`);
      const candidate = projection?.latestCandidate;
      if (projection?.ok !== true || projection.slug !== slug || projection.activeVersion?.id !== baseVersionId
        || candidate?.versionStatus !== 'proposed' || candidate.result !== 'hardening_passed'
        || candidate.activationEligible !== true || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(candidate.workflowVersionId || '')
        || !/^[a-f0-9]{64}$/.test(candidate.manifestDigest || '')) {
        throw new Error('No current compiler-passed proposal could be verified. Reload the agent page.');
      }
      const target = candidate.workflowVersionId;
      setTargetId(target);
      const result = await call(`${endpoint}/preview-proposed-adoption`, { sourceVersionId: baseVersionId, targetVersionId: target });
      const checked = trainingProposedAdoptionPreview(result, baseVersionId, target);
      if (!checked) throw new Error(result?.reason || 'Reference preview could not be verified.');
      setPreview(checked);
      if (checked.taskIdentityRepurpose) {
        if (checked.managerTrainingRequirements?.readiness === 'coach_reference_training_required')
          setMessage('This proposal cannot be activated because required training is missing.');
      } else if (checked.reason === 'task_identity_changed') {
        setMessage('This proposal changes the agent’s job and cannot be activated right now.');
      } else if (checked.readiness !== 'adoption_available') setMessage(checked.reason || 'References are already carried forward.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Proposal review unavailable.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function adopt() {
    if (busyRef.current || !confirmed || !preview || preview.taskIdentityRepurpose || !trainingSuccessorAdoptionActionAvailable(preview)) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      const storageKey = `proposed-adoption:${slug}:${baseVersionId}:${targetId}`;
      if (operation.current?.digest !== preview.expectedAdoptionDigest) {
        const saved = sessionStorage.getItem(storageKey);
        const retained = saved ? JSON.parse(saved) : null;
        operation.current = retained?.digest === preview.expectedAdoptionDigest && typeof retained.key === 'string'
          ? retained : { digest: preview.expectedAdoptionDigest, key: crypto.randomUUID() };
      }
      const retainedOperation = operation.current;
      if (!retainedOperation) throw new Error('Carry-forward identity unavailable.');
      sessionStorage.setItem(storageKey, JSON.stringify(retainedOperation)); // before delivery
      setUncertain(true);
      const result = await call(`${endpoint}/adopt-proposed`, { sourceVersionId: baseVersionId,
        targetVersionId: targetId, expectedAdoptionDigest: preview.expectedAdoptionDigest }, retainedOperation.key);
      const checked = trainingProposedAdoptionReceipt(result, slug, preview);
      if (!checked) throw new Error(result?.reason || 'Adoption receipt could not be verified.');
      setReceipt(checked); setConfirmed(false); setUncertain(false);
      setMessage('Accepted references carried forward. The proposal is not activated and no run was started.');
    } catch (error) { setMessage(`Reference carry-forward was not confirmed: ${error instanceof Error ? error.message : 'unavailable'}. Refresh or confirm the same operation; no automatic retry.`); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function apply() {
    if (busyRef.current || !confirmed || !canActivate || applied) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      const result = await call(`/api/v2/agents/${encodeURIComponent(slug)}/revisions/${encodeURIComponent(targetId)}/apply`,
        { expectedBaseVersionId: baseVersionId,
          ...(freshPurpose ? { taskIdentityRepurposeAcknowledgement: freshPurpose.acknowledgement }
            : preview?.managerPolicyRemap ? { managerPolicyRemapAcknowledgement: preview.managerPolicyRemap.acknowledgement } : {}) });
      if (result?.ok !== true || result.version_id !== targetId || result.status !== 'applied')
        throw new Error(result?.reason || result?.error || 'Activation was not confirmed.');
      setApplied(true); setConfirmed(false);
      setMessage(`Definition v${result.version_number} applied (${targetId}). Reload to verify your installed version. No run was started.`);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Activation delivery unconfirmed; confirm this same version.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <>
    <button type="button" className="btn-outline text-xs" disabled={busy} onClick={review}>Review proposed update</button>
    <Modal open={open} onClose={() => !busy && setOpen(false)} title="Review proposed agent update">
      <p className="text-sm">{freshPurpose
        ? 'This proposal changes the agent to a new job. It needs fresh training; no existing teaching, releases or private preferences carry forward. Applying it starts no run.'
        : purposeChanged ? 'This proposal changes the agent’s job. Reference carry-forward and activation are unavailable.'
        : 'This carries already accepted references to a reviewed proposal. It creates no new training and starts no run.'}</p>
      <p className="mt-2 text-xs break-all">Current definition: {baseVersionId}</p>
      <p className="mt-2 text-xs text-ink-400">If this agent serves a tested training snapshot, applying a definition change pauses future scheduled runs until you test and activate training for that definition. Already-running tasks keep their frozen material.</p>
      {targetId && <p className="text-xs break-all">Proposed definition: {targetId}</p>}
      {preview && !freshPurpose && !purposeChanged && <p className="mt-3">{preview.eligibleRecordCount} accepted records cover {preview.eligibleRouteCount} reference routes.</p>}
      {freshPurpose && <section className="mt-3 text-xs">
        <p>No training is carried from the current job. Existing customer installations stay on their current version until each customer explicitly reactivates.</p>
        <p>Once applied, this update is available for customers to reactivate immediately, even before fresh training is released. Admit and release fresh training for this new job.</p>
        <p className="break-all">Source learning identity: {freshPurpose.acknowledgement.sourceLearningIdentityDigest}</p>
        <p className="break-all">Target learning identity: {freshPurpose.acknowledgement.targetLearningIdentityDigest}</p>
        <p className="break-all">Source policies: {freshPurpose.acknowledgement.sourcePolicySetDigest}</p>
        <p className="break-all">Target policies: {freshPurpose.acknowledgement.targetPolicySetDigest}</p>
        <p className="break-all">New-purpose declaration: {freshPurpose.acknowledgement.repurposeDigest}</p>
        <p className="break-all">Acknowledgement receipt: {freshPurpose.activationReceiptDigest}</p>
        <p>Required reference training: {preview.managerTrainingRequirements?.readiness}. Missing routes: {preview.managerTrainingRequirements?.missingPairs.length ?? 'unknown'}.</p>
      </section>}
      {preview?.managerPolicyRemap && <section className="mt-3 text-xs">
        <p>This proposal moves or consolidates Manager responsibilities. Only surviving same-label references may carry forward.</p>
        <ul>{preview.managerPolicyRemap.entries.map(entry => <li key={entry.from.order}>
          Stage {entry.from.order} {entry.from.label} → stage {entry.to.order} {entry.to.label} ({entry.disposition})
        </li>)}</ul>
        <p>Excluded retired labels: {preview.managerPolicyRemap.retiredLabels.join(', ') || 'none'}.</p>
        <p className="break-all">Source policies: {preview.managerPolicyRemap.acknowledgement.sourcePolicySetDigest}</p>
        <p className="break-all">Target policies: {preview.managerPolicyRemap.acknowledgement.targetPolicySetDigest}</p>
        <p className="break-all">Remap: {preview.managerPolicyRemap.acknowledgement.remapDigest}</p>
        <p className="break-all">Acknowledgement receipt: {preview.managerPolicyRemap.activationReceiptDigest}</p>
        <p>Reference training: {preview.managerTrainingRequirements?.readiness}. Missing routes: {preview.managerTrainingRequirements?.missingPairs.length ?? 'unknown'}.</p>
      </section>}
      {preview && !applied && (canActivate || trainingSuccessorAdoptionActionAvailable(preview)) && <>
        <label className="mt-3 block text-sm"><input type="checkbox" checked={confirmed} disabled={busy}
          onChange={e => setConfirmed(e.target.checked)} /> {canActivate
            ? freshPurpose ? 'I approve changing this exact version to a new job, with fresh training and no teaching or private preferences carried forward.'
              : preview?.managerPolicyRemap ? 'I reviewed this exact policy remap and version pair and approve activating it.' : 'I reviewed this exact proposal and approve activating it.'
            : 'Carry these existing accepted same-label references to this exact proposal.'}</label>
        <button type="button" className="btn-primary mt-3" disabled={busy || !confirmed}
          onClick={() => void (canActivate ? apply() : adopt())}>{busy ? 'Working…' : canActivate ? 'Activate reviewed proposal' : uncertain ? 'Confirm same carry-forward' : 'Carry accepted references'}</button>
      </>}
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    </Modal>
  </>;
}

/**
 * The activation gate — for the updates that still need one.
 *
 * WHAT THIS NO LONGER DOES, AND WHY. It used to render the version's whole input
 * contract with file pickers, and disable "Activate update" until every required
 * input was bound. So accepting a planning-prose edit on the Visual Treatment
 * Planner meant choosing a presenter video and waiting on a multi-gigabyte hash —
 * for a file that belonged to some future run, not to this decision (spec §2.1).
 *
 * Worse, that one file was then copied into every schedule on the agent.
 *
 * Activation selects a version. A run supplies its files. So this surface now
 * shows only what the owner is actually deciding:
 *
 *   - the version, and what changed about its AUTHORITY (§3.2);
 *   - a DECLARATIVE summary of the input contract — "requires one presenter video
 *     for each run" — which explains the new contract without pretending to
 *     satisfy it (§3.3);
 *   - the permission confirmation, for a reactivation.
 *
 * A compatible edit should not reach this component at all: the backend
 * auto-activates it and the page renders a receipt instead. This is the gate for
 * updates that genuinely need a human, which is what makes the gate worth reading.
 */
export default function AgentUpdateGate({ workflowId, update }: {
  workflowId: string;
  update: AvailableAgentUpdate;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fields = useMemo(() => orderedInputFields(update.input_contract), [update.input_contract]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [permissionsConfirmed, setPermissionsConfirmed] = useState(false);

  const incompatible = update.state === 'incompatible';
  const trainingOnly=update.state==='training_update_available';
  const snapshotDigest=typeof update.published_snapshot_digest==='string'&&/^[a-f0-9]{64}$/.test(update.published_snapshot_digest)?update.published_snapshot_digest:null;
  const snapshotUnavailable=trainingOnly&&!snapshotDigest;
  const needsPermissions = update.state === 'reactivation_required';
  const authority = describeAuthorityDelta(update.authority_delta);

  async function activate() {
    if (snapshotUnavailable||saving||(needsPermissions && !permissionsConfirmed)) return;
    setSaving(true);
    setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // No inputBindings. No inputSessionId. Activation authorizes a version and
      // nothing else — see the backend's installed-agent-version service.
      const result = await callBackend(`/api/v2/me/installed-agents/${encodeURIComponent(workflowId)}/activate-version`, {
        jwt: session?.access_token,
        method: 'POST',
        body: {
          workflowVersionId: update.workflow_version_id,
          inputContractDigest: update.input_contract_digest,
          ...(snapshotDigest?{expectedPublishedSnapshotDigest:snapshotDigest}:{}),
          permissionsConfirmed,
        },
      });
      if (!result?.ok || result.activeVersionId !== update.workflow_version_id
        ||snapshotDigest&&result.activePublishedSnapshotDigest!==snapshotDigest) {
        throw new Error('The server did not confirm the requested installed version.');
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not activate this update.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-left max-w-[320px]">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {trainingOnly?'Tested training update needs review':<>Agent update v{update.version} needs review</>}
        </p>
        <p className="text-[11px] text-ink-400 mt-1">
          {snapshotUnavailable?'The published training identity is unavailable. Reload before updating.':trainingOnly?'The agent’s steps are unchanged. Future runs keep using your installed training until you explicitly activate this tested teaching set.':incompatible
            ? 'This update cannot be applied to your installed version. It needs a migration, not an activation.'
            : needsPermissions
              ? 'This update changes what the agent is allowed to do. Run now stays on your installed version until you approve it.'
              : 'Run now stays on your installed version until you activate this update.'}
        </p>
        <button type="button" disabled={incompatible||snapshotUnavailable} onClick={() => setOpen(true)}
          className="mt-2 btn-outline text-xs px-3 py-1.5 disabled:opacity-40">
          {incompatible ? 'Update is incompatible' : 'Review & activate update'}
        </button>
      </div>
      <Modal open={open} onClose={() => !saving && setOpen(false)} title={`Activate agent update v${update.version}`}>
        <p className="text-sm text-ink-300 mb-4">
          {trainingOnly?'This changes the tested publisher training used by future runs. Running tasks keep their frozen training. Your private preferences are unchanged.':'This advances the version your future runs use.'} It does not ask for files —
          each run collects its own inputs when you start it.
        </p>
        {snapshotDigest&&<p className="mb-4 text-xs text-ink-400 break-all">Published training snapshot: {snapshotDigest}</p>}

        {/* §3.2 — the exact authority delta, when there is one. */}
        {authority.hasChanges && <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 mb-3">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
            This version changes what the agent is allowed to do
          </p>
          {authority.added.length > 0 && <div className="mt-2">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">Gains</p>
            <ul className="mt-1 space-y-0.5">
              {authority.added.map((entry) => (
                <li key={`add-${entry}`} className="text-xs text-ink-200">+ {entry}</li>
              ))}
            </ul>
          </div>}
          {authority.removed.length > 0 && <div className="mt-2">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">Gives up</p>
            <ul className="mt-1 space-y-0.5">
              {authority.removed.map((entry) => (
                <li key={`remove-${entry}`} className="text-xs text-ink-400">− {entry}</li>
              ))}
            </ul>
          </div>}
        </div>}

        {/* §3.3 — a declarative summary of the contract. Never a picker. */}
        {fields.length > 0 && <div className="rounded-md border border-ink-700 p-3">
          <p className="text-xs font-medium text-ink-100">What each run will ask you for</p>
          <ul className="mt-2 space-y-1.5">
            {fields.map((field) => (
              <li key={field.key} className="text-xs text-ink-300">
                <span className="text-ink-100">{field.label}</span>
                <span className={field.required ? 'ml-2 text-[11px] text-amber-300' : 'ml-2 text-[11px] text-ink-500'}>
                  {field.required ? 'required each run' : 'optional'}
                </span>
                {field.description && <span className="block text-ink-400 mt-0.5">{field.description}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-500">
            Nothing to choose now. Run now collects and verifies these for that run only.
          </p>
        </div>}

        {needsPermissions && <label className="mt-4 flex items-start gap-2 text-xs text-ink-300">
          <input type="checkbox" checked={permissionsConfirmed}
            onChange={(event) => setPermissionsConfirmed(event.target.checked)} />
          I reviewed and approve this version’s changed permissions.
        </label>}
        {message && <p className="mt-3 text-xs text-rose-400">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-outline text-sm px-4 py-2" disabled={saving}
            onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="btn-success text-sm px-4 py-2"
            disabled={saving || (needsPermissions && !permissionsConfirmed)}
            onClick={() => void activate()}>
            {saving ? 'Activating…' : 'Activate update'}
          </button>
        </div>
      </Modal>
    </>
  );
}
