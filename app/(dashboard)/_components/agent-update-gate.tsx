'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import Modal from './modal';
import { orderedInputFields, type WorkflowInputContract } from '@/lib/workflow-input-contract';
import { describeAuthorityDelta, type AgentAuthorityDelta } from '@/lib/agent-authority-delta';

export type AvailableAgentUpdate = {
  workflow_version_id: string;
  version: number;
  input_contract: WorkflowInputContract | null;
  input_contract_digest: string;
  state: string;
  /** The exact authority delta, when the backend classified this as expanding. */
  authority_delta?: AgentAuthorityDelta | null;
};

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
  const needsPermissions = update.state === 'reactivation_required';
  const authority = describeAuthorityDelta(update.authority_delta);

  async function activate() {
    if (needsPermissions && !permissionsConfirmed) return;
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
          permissionsConfirmed,
        },
      });
      if (!result?.ok || result.activeVersionId !== update.workflow_version_id) {
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
          Agent update v{update.version} needs review
        </p>
        <p className="text-[11px] text-ink-400 mt-1">
          {incompatible
            ? 'This update cannot be applied to your installed version. It needs a migration, not an activation.'
            : needsPermissions
              ? 'This update changes what the agent is allowed to do. Run now stays on your installed version until you approve it.'
              : 'Run now stays on your installed version until you activate this update.'}
        </p>
        <button type="button" disabled={incompatible} onClick={() => setOpen(true)}
          className="mt-2 btn-outline text-xs px-3 py-1.5 disabled:opacity-40">
          {incompatible ? 'Update is incompatible' : 'Review & activate update'}
        </button>
      </div>
      <Modal open={open} onClose={() => !saving && setOpen(false)} title={`Activate agent update v${update.version}`}>
        <p className="text-sm text-ink-300 mb-4">
          This advances the version your future runs use. It does not ask for files —
          each run collects its own inputs when you start it.
        </p>

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
