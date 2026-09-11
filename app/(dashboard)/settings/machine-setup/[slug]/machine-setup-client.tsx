'use client';

/**
 * <MachineSetupClient /> — the requirement list for one agent on the selected
 * computer, read from GET /api/v2/me/machine-capabilities (backend 0346).
 *
 * Every action is the USER's explicit click:
 *   • install_cli / install_media_tools / install_runtime → the Desktop's fixed
 *     tool registry (an allowlisted installer, or the vendor's instructions when
 *     no unattended installer exists — the Higgsfield CLI);
 *   • sign_in_cli → the vendor's own sign-in flow in a terminal; Implexa only
 *     re-checks account STATUS afterwards, never the credential;
 *   • Recheck → Desktop re-probes + re-attests, then the backend re-decides.
 * The page never decides readiness from the bridge; it renders the backend's answer.
 */

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { SetupRequiredCard, SetupRequiredItem } from '@/lib/setup-required';

type Bridge = {
  recheckMachineCapabilities?: () => Promise<{ ok: boolean; reason?: string | null }>;
  executionMachineId?: () => Promise<string>;
  installTool?: (key: string) => Promise<{ ok: boolean; installed?: boolean; error?: string; message?: string; installUrl?: string | null }>;
};
function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { implexaDesktop?: Bridge }).implexaDesktop || null;
}

type Requirement = { id: string; capability_key: string; kind: string; required: boolean; label: string; fallback: { mode_label: string } | null; setup: { title: string; actions: string[] } };
type Read = {
  ok: boolean; classified: boolean; admitted?: boolean;
  requirements: { requirements: Requirement[] } | null;
  machine?: { id: string | null; label?: string | null; online?: boolean } | null;
  items?: Array<{ id: string; required?: boolean; state: string; stateLabel?: string }>;
  setupRequired?: SetupRequiredCard | null;
};

// Which Desktop tool key each capability id installs through.
const TOOL_KEY: Record<string, string> = { higgsfield_cli: 'higgsfield', ffmpeg: 'ffmpeg', ffprobe: 'ffmpeg' };
const STATE_LABELS: Record<string, string> = {
  ready: 'Ready', missing: 'Not installed', not_executable: 'Installed but not runnable', unsupported_version: 'Unsupported version',
  unauthenticated: 'Not connected', model_unavailable: 'Required model access not verified', tls_failed: 'Secure connection failed',
  insufficient: 'Not enough free space', probe_failed: 'Could not be checked', probe_unsupported: 'Not verified', degraded: 'Available with limits',
  not_checked: 'Not checked yet', stale: 'Check expired', fallback: 'Using fallback',
};

export default function MachineSetupClient({ slug }: { slug: string }) {
  const [read, setRead] = useState<Read | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const supabase = createClient();

  const load = useCallback(async () => {
    try {
      const native = bridge();
      const machineId = native?.executionMachineId ? await native.executionMachineId().catch(() => null) : null;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend(`/api/v2/me/machine-capabilities?slug=${encodeURIComponent(slug)}${machineId ? `&machineId=${encodeURIComponent(machineId)}` : ''}`, { jwt: session?.access_token });
      setRead(res as Read);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not read this agent’s requirements.');
    }
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  async function recheck() {
    setBusy('recheck'); setNote(null);
    try {
      const native = bridge();
      if (native?.recheckMachineCapabilities) {
        const r = await native.recheckMachineCapabilities().catch(() => ({ ok: false, reason: 'recheck_failed' }));
        if (!r.ok) setNote('The Implexa app could not re-check this computer. Make sure it is signed in.');
      } else {
        setNote('Open this page inside the Implexa app to re-check the computer it runs on.');
      }
      await load();
    } finally { setBusy(null); }
  }

  async function install(item: SetupRequiredItem | Requirement) {
    const key = TOOL_KEY[item.id];
    const native = bridge();
    if (!key || !native?.installTool) { setNote('Open this page inside the Implexa app to install tools on this computer.'); return; }
    setBusy(item.id); setNote(null);
    try {
      const r = await native.installTool(key);
      if (r.ok) setNote(`${item.label} is installed. Recheck to confirm it is on the agent’s path.`);
      else if (r.installUrl) { window.open(r.installUrl, '_blank', 'noopener,noreferrer'); setNote(r.message || `${item.label} must be installed by you. Follow the vendor instructions, then Recheck.`); }
      else setNote(r.message || r.error || `Could not install ${item.label}.`);
    } finally { setBusy(null); }
  }

  if (!read) return <p className="text-sm text-ink-400">{note || 'Loading requirements…'}</p>;
  if (!read.classified || !read.requirements) {
    return <p className="text-sm text-ink-300">This agent’s version does not declare machine requirements, so nothing is checked before it runs.</p>;
  }
  const stateFor = new Map((read.items || []).map((i) => [i.id, i]));
  const machineLabel = read.machine?.label || (read.machine?.id ? `Mac ${read.machine.id.slice(0, 8)}` : 'this computer');
  return (
    <div className="flex flex-col gap-4" data-testid="machine-setup">
      <div className="text-xs text-ink-400">Checking: <span className="text-ink-200">{machineLabel}</span>{read.machine && read.machine.online === false ? ' (offline)' : ''}
        {' · '}{read.admitted ? <span className="text-success-600 dark:text-success-400">Ready to run</span> : <span className="text-rose-600 dark:text-rose-400">Setup required</span>}</div>
      <ul className="flex flex-col gap-2">
        {read.requirements.requirements.map((req) => {
          const st = stateFor.get(req.id);
          const state = st?.state || 'not_checked';
          const ready = state === 'ready';
          const label = (st as { stateLabel?: string } | undefined)?.stateLabel || STATE_LABELS[state] || 'Not verified';
          return (
            <li key={req.id} className="card px-4 py-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm text-ink-100">{req.label}{req.required ? '' : <span className="ml-1 text-[11px] text-ink-500">optional{req.fallback ? ` · fallback: ${req.fallback.mode_label}` : ''}</span>}</div>
                <div className="text-[11px] text-ink-500">{req.setup.title}</div>
                {!ready && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {req.setup.actions.includes('install_cli') || req.setup.actions.includes('install_media_tools') ? (
                      <button type="button" disabled={busy === req.id} className="btn-outline text-xs px-3 py-1" onClick={() => install(req)}>{busy === req.id ? 'Working…' : `Install ${req.label}`}</button>
                    ) : null}
                    {req.setup.actions.includes('sign_in_cli') ? (
                      <span className="text-[11px] text-ink-400">Sign in with the vendor’s CLI in a terminal (Implexa never captures the credential), then Recheck.</span>
                    ) : null}
                  </div>
                )}
              </div>
              <div className={`flex-none text-xs ${ready ? 'text-success-600 dark:text-success-400' : req.required ? 'text-rose-600 dark:text-rose-400' : 'text-ink-400'}`}>{req.label} — {label}</div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy === 'recheck'} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-60" onClick={recheck}>{busy === 'recheck' ? 'Rechecking…' : 'Recheck'}</button>
        {note ? <span className="text-xs text-ink-400">{note}</span> : null}
      </div>
    </div>
  );
}
