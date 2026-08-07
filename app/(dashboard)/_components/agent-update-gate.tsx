'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import Modal from './modal';
import { desktopBridge } from './run-attachments';
import {
  bindInputValue, missingRequiredInputs, orderedInputFields, resolvePickerResult,
  serializeArtifactBindings, type ArtifactBinding, type RunInputBindings,
  type WorkflowInputContract, type WorkflowInputField,
} from '@/lib/workflow-input-contract';

export type AvailableAgentUpdate = {
  workflow_version_id: string;
  version: number;
  input_contract: WorkflowInputContract | null;
  input_contract_digest: string;
  state: string;
};

export default function AgentUpdateGate({ workflowId, update }: {
  workflowId: string;
  update: AvailableAgentUpdate;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fields = useMemo(() => orderedInputFields(update.input_contract), [update.input_contract]);
  const [open, setOpen] = useState(false);
  const [bindings, setBindings] = useState<RunInputBindings>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [permissionsConfirmed, setPermissionsConfirmed] = useState(false);
  const sessionRef = useRef<string | null>(null);

  function setError(key: string, value: string | null) {
    setErrors((previous) => {
      const next = { ...previous };
      if (value) next[key] = value; else delete next[key];
      return next;
    });
  }

  async function chooseFile(field: WorkflowInputField) {
    const bridge = desktopBridge();
    if (!bridge?.pickRunInput) return;
    const inputSessionId = sessionRef.current || crypto.randomUUID();
    sessionRef.current = inputSessionId;
    setError(field.key, null);
    const raw = await bridge.pickRunInput({
      inputKey: field.key, inputSessionId, ...(field.accept ? { accept: field.accept } : {}),
    }).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : 'bridge_unavailable' }));
    const result = resolvePickerResult(raw, field);
    if (result.kind === 'canceled') return;
    if (result.kind === 'failed') { setError(field.key, result.message); return; }
    if (result.inputSessionId !== inputSessionId) {
      setError(field.key, 'The Desktop returned this file for a different activation session. Choose it again.');
      return;
    }
    setBindings((previous) => bindInputValue(previous, field, result.binding));
  }

  function setScalar(field: WorkflowInputField, value: string | string[]) {
    setBindings((previous) => ({ ...previous, [field.key]: value }));
  }

  async function activate() {
    if (missingRequiredInputs(update.input_contract, bindings).length) return;
    if (update.state === 'reactivation_required' && !permissionsConfirmed) return;
    setSaving(true);
    setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await callBackend(`/api/v2/me/installed-agents/${encodeURIComponent(workflowId)}/activate-version`, {
        jwt: session?.access_token,
        method: 'POST',
        body: {
          workflowVersionId: update.workflow_version_id,
          inputContractDigest: update.input_contract_digest,
          inputBindings: serializeArtifactBindings(bindings),
          inputSessionId: sessionRef.current,
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

  const incompatible = update.state === 'incompatible';
  return (
    <>
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-left max-w-[320px]">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Agent update v{update.version} available</p>
        <p className="text-[11px] text-ink-400 mt-1">
          Run now stays on your installed version until this update and its inputs are verified.
        </p>
        <button type="button" disabled={incompatible} onClick={() => setOpen(true)}
          className="mt-2 btn-outline text-xs px-3 py-1.5 disabled:opacity-40">
          {incompatible ? 'Update is incompatible' : 'Review & activate update'}
        </button>
      </div>
      <Modal open={open} onClose={() => !saving && setOpen(false)} title={`Activate agent update v${update.version}`}>
        <p className="text-sm text-ink-300 mb-4">
          Confirm the inputs for this immutable version. Activation advances your installed agent and matching schedules together.
        </p>
        <div className="space-y-3">
          {fields.map((field) => {
            const value = bindings[field.key];
            const artifacts = Array.isArray(value)
              ? value.filter((entry): entry is ArtifactBinding => typeof entry === 'object')
              : value && typeof value === 'object' ? [value as ArtifactBinding] : [];
            const scalar = typeof value === 'string' ? value : '';
            const scalarMany = Array.isArray(value)
              ? value.filter((entry): entry is string => typeof entry === 'string') : [];
            return <div key={field.key} className="rounded-md border border-ink-700 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <label className="text-sm font-medium text-ink-100">{field.label}</label>
                  <span className={field.required ? 'ml-2 text-[11px] text-amber-300' : 'ml-2 text-[11px] text-ink-500'}>
                    {field.required ? 'required' : 'optional'}
                  </span>
                  <p className="text-xs text-ink-400 mt-1">{field.description}</p>
                </div>
                {field.kind === 'file' && <button type="button" onClick={() => void chooseFile(field)}
                  disabled={!desktopBridge()?.pickRunInput} className="btn-outline text-xs px-3 py-1.5 shrink-0 disabled:opacity-40">
                  {field.cardinality === 'many' ? 'Add file' : artifacts.length ? 'Replace' : 'Choose file'}
                </button>}
              </div>
              {field.kind === 'text' && <input
                value={field.cardinality === 'many' ? scalarMany.join(', ') : scalar}
                onChange={(event) => setScalar(field, field.cardinality === 'many'
                  ? event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean)
                  : event.target.value)}
                className="mt-2 w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100" />}
              {field.kind === 'choice' && <select
                value={field.cardinality === 'many' ? scalarMany : scalar}
                multiple={field.cardinality === 'many'}
                onChange={(event) => setScalar(field, field.cardinality === 'many'
                  ? Array.from(event.target.selectedOptions, (option) => option.value).filter(Boolean)
                  : event.target.value)}
                className="mt-2 w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100">
                {field.cardinality !== 'many' && <option value="">Select…</option>}
                {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>}
              {artifacts.map((artifact) => <div key={artifact.artifactId} className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-300">
                <span><span className="text-emerald-400">✓</span> {artifact.displayName} — verified, bound to {field.key}</span>
                <button type="button" className="text-ink-500 hover:text-rose-400" onClick={() => setBindings((previous) => {
                  const existing = previous[field.key];
                  if (field.cardinality === 'many' && Array.isArray(existing)) {
                    return { ...previous, [field.key]: existing.filter((entry): entry is ArtifactBinding =>
                      typeof entry === 'object' && entry !== null && entry.artifactId !== artifact.artifactId) };
                  }
                  const next = { ...previous };
                  delete next[field.key];
                  return next;
                })}>Remove</button>
              </div>)}
              {errors[field.key] && <p className="mt-2 text-xs text-rose-400">{errors[field.key]}</p>}
            </div>;
          })}
        </div>
        {update.state === 'reactivation_required' && <label className="mt-4 flex items-start gap-2 text-xs text-ink-300">
          <input type="checkbox" checked={permissionsConfirmed} onChange={(event) => setPermissionsConfirmed(event.target.checked)} />
          I reviewed and approve this version’s changed permissions.
        </label>}
        {message && <p className="mt-3 text-xs text-rose-400">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-outline text-sm px-4 py-2" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="btn-success text-sm px-4 py-2" disabled={saving || missingRequiredInputs(update.input_contract, bindings).length > 0 || (update.state === 'reactivation_required' && !permissionsConfirmed)} onClick={() => void activate()}>
            {saving ? 'Activating…' : 'Activate update'}
          </button>
        </div>
      </Modal>
    </>
  );
}
