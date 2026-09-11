'use client';

/**
 * <MachineSetupClient /> — the requirement list for one agent on THE SELECTED
 * computer, read from GET /api/v2/me/machine-capabilities (backend 0346).
 *
 * Every action is the USER's explicit click, and every action the backend can
 * name is routed:
 *   • install_runtime     → the Desktop's managed runtime install (its own
 *                           consent dialog) — never a silent download;
 *   • install_cli         → the Desktop's fixed tool registry: an allowlisted
 *                           installer, or the vendor's instructions opened in
 *                           the browser when no unattended installer exists
 *                           (the Higgsfield CLI);
 *   • install_media_tools → the same registry (ffmpeg/ffprobe);
 *   • sign_in_cli         → the vendor's own sign-in in a terminal; Implexa
 *                           only re-checks account STATUS afterwards, never
 *                           the credential;
 *   • free_disk           → Finder on this computer, then Recheck;
 *   • recheck             → Desktop re-probes + re-attests (only when it IS
 *                           the selected computer), then the backend re-decides.
 * The backend's own instructions are rendered verbatim under each item. The
 * page never decides readiness from the bridge; it renders the backend's
 * answer — and when that answer cannot be refreshed, it shows NO readiness at
 * all rather than a stale "Ready to run".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { SETUP_ACTION_COPY, type SetupRequiredCard } from '@/lib/setup-required';

type InstallResult = { ok: boolean; installed?: boolean; error?: string; message?: string; installUrl?: string | null };
type RuntimeResult = { ok: boolean; error?: string; message?: string };
type Bridge = {
  recheckMachineCapabilities?: () => Promise<{ ok: boolean; reason?: string | null }>;
  executionMachineId?: () => Promise<string>;
  installTool?: (key: string) => Promise<InstallResult>;
  requestInstallMediaRuntime?: () => Promise<RuntimeResult>;
  revealPath?: (absPath: string) => Promise<{ ok: boolean; error?: string }> | void;
};
function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { implexaDesktop?: Bridge }).implexaDesktop || null;
}

export type Requirement = {
  id: string; capability_key: string; kind: string; required: boolean; label: string;
  fallback: { mode_label: string } | null;
  setup: { title: string; instructions?: string[]; actions: string[] };
};
export type Read = {
  ok: boolean; classified: boolean; admitted?: boolean;
  requirements: { requirements: Requirement[] } | null;
  machine?: { id: string | null; label?: string | null; online?: boolean } | null;
  items?: Array<{ id: string; required?: boolean; state: string; stateLabel?: string; reason?: string }>;
  setupRequired?: SetupRequiredCard | null;
};

// Which Desktop tool-registry key each capability id installs through.
const TOOL_KEY: Record<string, string> = { higgsfield_cli: 'higgsfield', ffmpeg: 'ffmpeg', ffprobe: 'ffmpeg', media_tools: 'ffmpeg' };
const STATE_LABELS: Record<string, string> = {
  ready: 'Ready', missing: 'Not installed', not_executable: 'Installed but not runnable', unsupported_version: 'Unsupported version',
  unauthenticated: 'Not connected', model_unavailable: 'Required model access not verified', tls_failed: 'Secure connection failed',
  insufficient: 'Not enough free space', probe_failed: 'Could not be checked', probe_unsupported: 'Not verified', degraded: 'Available with limits',
  not_checked: 'Not checked yet', stale: 'Check expired', fallback: 'Using fallback',
};
const ACTION_ORDER = ['install_runtime', 'install_cli', 'install_media_tools', 'sign_in_cli', 'free_disk'];

export default function MachineSetupClient({ slug, machineId = null, workflowVersionId = null }: { slug: string; machineId?: string | null; workflowVersionId?: string | null }) {
  const [read, setRead] = useState<Read | null>(null);
  // The last refresh failed: whatever `read` holds is NOT current. Readiness is
  // hidden until a refresh succeeds — a stale "Ready to run" is worse than none.
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const supabase = createClient();
  // The computer this page is about: the segment from the card when present,
  // otherwise whatever the bridge answered on first load (fixed after that, so
  // a Recheck never silently switches machines).
  const selectedMachine = useRef<string | null>(machineId);

  const load = useCallback(async () => {
    try {
      const native = bridge();
      if (!selectedMachine.current && native?.executionMachineId) {
        selectedMachine.current = await native.executionMachineId().catch(() => null);
      }
      const target = selectedMachine.current;
      const { data: { session } } = await supabase.auth.getSession();
      // The FROZEN version when a continuation opened this page; the agent's
      // current version otherwise. (The backend refuses a version of another agent.)
      const res = await callBackend(`/api/v2/me/machine-capabilities?slug=${encodeURIComponent(slug)}${target ? `&machineId=${encodeURIComponent(target)}` : ''}${workflowVersionId ? `&workflowVersionId=${encodeURIComponent(workflowVersionId)}` : ''}`, { jwt: session?.access_token });
      setRead(res as Read);
      setStale(false);
    } catch (e) {
      setStale(true);
      setNote(e instanceof Error ? e.message : 'Could not read this agent’s requirements.');
    }
  }, [slug, workflowVersionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  async function recheck() {
    if (busy) return;
    setBusy('recheck'); setNote(null);
    try {
      const native = bridge();
      const target = selectedMachine.current;
      if (native?.recheckMachineCapabilities) {
        const here = native.executionMachineId ? await native.executionMachineId().catch(() => null) : null;
        if (!target || !here || here === target) {
          const r = await native.recheckMachineCapabilities().catch(() => ({ ok: false, reason: 'recheck_failed' }));
          if (!r.ok) setNote('The Implexa app could not re-check this computer. Make sure it is signed in.');
        } else {
          setNote('This page is checking a different computer than the one Implexa is running on. Open it inside Implexa on that computer to re-probe; its last report is shown here.');
        }
      } else {
        setNote('Open this page inside the Implexa app to re-check the computer it runs on.');
      }
      await load();
    } finally { setBusy(null); }
  }

  async function act(action: string, req: Requirement) {
    if (busy) return;
    const native = bridge();
    setBusy(`${req.id}:${action}`); setNote(null);
    try {
      if (action === 'install_runtime') {
        if (!native?.requestInstallMediaRuntime) { setNote('Open this page inside the Implexa app to install the managed runtime on this computer.'); return; }
        const r: RuntimeResult = await native.requestInstallMediaRuntime().catch(() => ({ ok: false, error: 'bridge_unavailable' }));
        setNote(r.ok ? 'Runtime install started in Implexa. When it finishes, Recheck.' : (r.message || r.error || 'Implexa did not start the runtime install.'));
        return;
      }
      if (action === 'install_cli' || action === 'install_media_tools') {
        const key = TOOL_KEY[req.id] || (action === 'install_media_tools' ? 'ffmpeg' : null);
        if (!key || !native?.installTool) { setNote('Open this page inside the Implexa app to install tools on this computer.'); return; }
        const r: InstallResult = await native.installTool(key).catch(() => ({ ok: false, error: 'bridge_unavailable' }));
        if (r.ok) setNote(`${req.label} is installed. Recheck to confirm it is on the agent’s path.`);
        else if (r.installUrl) { window.open(r.installUrl, '_blank', 'noopener,noreferrer'); setNote(r.message || `${req.label} must be installed by you. Follow the vendor instructions, then Recheck.`); }
        else setNote(r.message || r.error || `Could not install ${req.label}.`);
        return;
      }
      if (action === 'sign_in_cli') {
        setNote(`Sign in with the vendor’s CLI in a terminal on this computer (Implexa never captures the credential), then Recheck. ${(req.setup.instructions || []).join(' ')}`.trim());
        return;
      }
      if (action === 'free_disk') {
        if (native?.revealPath) { try { await native.revealPath('/'); } catch { /* Finder unavailable */ } }
        setNote('Free up space on this computer, then Recheck.');
        return;
      }
    } finally { setBusy(null); }
  }

  if (!read && !stale) return <p className="text-sm text-ink-400">Loading requirements…</p>;
  if (!read) {
    return (
      <div className="flex flex-col gap-3" data-testid="machine-setup">
        <p className="text-sm text-rose-600 dark:text-rose-400" data-testid="machine-setup-stale">Setup status could not be loaded. {note}</p>
        <button type="button" disabled={busy === 'recheck'} className="btn-primary text-xs px-3 py-1.5 w-fit disabled:opacity-60" onClick={recheck}>{busy === 'recheck' ? 'Rechecking…' : 'Recheck'}</button>
      </div>
    );
  }
  if (!read.classified || !read.requirements) {
    return <p className="text-sm text-ink-300">This agent’s version does not declare machine requirements, so nothing is checked before it runs.</p>;
  }
  const stateFor = new Map((read.items || []).map((i) => [i.id, i]));
  const machineLabel = read.machine?.label || (read.machine?.id ? `Mac ${read.machine.id.slice(0, 8)}` : 'this computer');
  return (
    <div className="flex flex-col gap-4" data-testid="machine-setup">
      <div className="text-xs text-ink-400">Checking: <span className="text-ink-200" data-testid="machine-setup-machine">{machineLabel}</span>{read.machine && read.machine.online === false ? ' (offline)' : ''}
        {' · '}
        {stale
          ? <span className="text-amber-600 dark:text-amber-400" data-testid="machine-setup-stale">Status could not be refreshed — shown state may be out of date</span>
          : read.admitted
            ? <span className="text-success-600 dark:text-success-400" data-testid="machine-setup-ready">Ready to run</span>
            : <span className="text-rose-600 dark:text-rose-400">Setup required</span>}
      </div>
      <ul className="flex flex-col gap-2">
        {read.requirements.requirements.map((req) => {
          const st = stateFor.get(req.id);
          const state = stale ? 'not_checked' : (st?.state || 'not_checked');
          const ready = state === 'ready';
          const label = stale ? 'Not verified' : ((st as { stateLabel?: string } | undefined)?.stateLabel || STATE_LABELS[state] || 'Not verified');
          const actions = ACTION_ORDER.filter((a) => req.setup.actions.includes(a));
          return (
            <li key={req.id} className="card px-4 py-3 flex items-start justify-between gap-4" data-testid={`machine-setup-item-${req.id}`}>
              <div className="min-w-0">
                <div className="text-sm text-ink-100">{req.label}{req.required ? '' : <span className="ml-1 text-[11px] text-ink-500">optional{req.fallback ? ` · fallback: ${req.fallback.mode_label}` : ''}</span>}</div>
                <div className="text-[11px] text-ink-500">{req.setup.title}</div>
                {!ready && Array.isArray(req.setup.instructions) && req.setup.instructions.length ? (
                  <ol className="mt-1.5 list-decimal pl-4 text-[11px] text-ink-400 flex flex-col gap-0.5" data-testid={`machine-setup-instructions-${req.id}`}>
                    {req.setup.instructions.map((step, index) => <li key={index}>{step}</li>)}
                  </ol>
                ) : null}
                {!ready && actions.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {actions.map((action) => (
                      <button key={action} type="button" disabled={!!busy} title={SETUP_ACTION_COPY[action]?.explicit}
                        className="btn-outline text-xs px-3 py-1 disabled:opacity-60" data-action={action} onClick={() => act(action, req)}>
                        {busy === `${req.id}:${action}` ? 'Working…' : `${SETUP_ACTION_COPY[action]?.label || action}${action === 'install_cli' ? ` ${req.label}` : ''}`}
                      </button>
                    ))}
                  </div>
                ) : null}
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
      <p className="text-[11px] text-ink-500">Installation and sign-in happen only when you choose them here; Implexa never installs software or captures credentials on its own.</p>
    </div>
  );
}
