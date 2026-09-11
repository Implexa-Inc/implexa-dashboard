'use client';

/**
 * <SetupRequiredCard /> — "Setup required before this agent can run." (backend 0346)
 *
 * Shown IMMEDIATELY at the Run click when the backend's admission call refuses.
 * Lists each requirement with its state ("Higgsfield CLI — Not installed"),
 * names WHICH computer was checked, and offers exactly three actions:
 *   • Open setup in Implexa — the in-app setup page (install/sign-in are the
 *     user's explicit clicks there; nothing is installed or captured silently);
 *   • Recheck — asks the Desktop (when this page runs inside it) to re-probe and
 *     re-attest, then asks the BACKEND for the decision again. On admission the
 *     SAME Run continues, once, with the same inputs (onAdmitted).
 *   • Cancel — nothing was queued; nothing to undo.
 *
 * The Dashboard never decides readiness: `recheck` is the backend's answer.
 */

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { appMachineSetupUrl, blockingItems, machineCopy, machineSetupPath, parseSetupRequired, setupReasonCopy, type SetupRequiredCard as Card } from '@/lib/setup-required';

type Bridge = {
  recheckMachineCapabilities?: () => Promise<{ ok: boolean; reason?: string | null }>;
  executionMachineId?: () => Promise<string>;
};
function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { implexaDesktop?: Bridge }).implexaDesktop || null;
}

export default function SetupRequiredCard({ card, slug = null, workflowVersionId, onAdmitted, onCancel }: {
  card: Card;
  /** The agent to re-admit. Absent for a Continue (the request re-runs admission server-side). */
  slug?: string | null;
  workflowVersionId?: string | null;
  /** Continue the ORIGINAL Run — same note, same inputs — exactly once. */
  onAdmitted: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState<Card>(card);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Guards a double Recheck (a click during an in-flight check) from continuing
  // the same Run twice — the one thing this modal must never do.
  const admittedRef = useRef(false);
  const supabase = createClient();
  const inApp = !!bridge();

  async function recheck() {
    if (checking || admittedRef.current) return;
    setChecking(true);
    setNote(null);
    try {
      const native = bridge();
      let machineId: string | null = current.machine.id;
      if (native?.recheckMachineCapabilities) {
        const r = await native.recheckMachineCapabilities().catch(() => ({ ok: false, reason: 'recheck_failed' }));
        if (!r.ok) setNote('The Implexa app could not re-check this computer. Make sure it is signed in, then try again.');
      }
      if (native?.executionMachineId) machineId = await native.executionMachineId().catch(() => machineId);
      if (!slug) {
        // No agent to pre-admit (a Continue): retry the original action once;
        // the backend re-runs admission at request birth and answers 409 again
        // if setup is still incomplete, which lands back in this modal.
        admittedRef.current = true;
        await onAdmitted();
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/run-admission', {
        jwt: session?.access_token, method: 'POST',
        body: { workflowSlug: slug, ...(workflowVersionId ? { workflowVersionId } : {}), ...(machineId ? { executionMachineId: machineId } : {}) },
      });
      if (res?.ok === true && res?.admitted === true) {
        admittedRef.current = true;
        await onAdmitted();
        return;
      }
      setNote('Implexa could not confirm readiness. Try again in a moment.');
    } catch (e) {
      const next = parseSetupRequired(e);
      if (next) { setCurrent(next); return; }
      setNote(e instanceof Error ? e.message : 'Recheck failed.');
    } finally {
      setChecking(false);
    }
  }

  function openSetup() {
    const target = slug || 'this-agent';
    if (inApp) { window.location.href = machineSetupPath(target); return; }
    // Plain web: hand off to the app, which routes the same path in-app.
    window.location.href = appMachineSetupUrl(target);
  }

  const blocking = blockingItems(current);
  const optional = current.items.filter((item) => !item.required);
  return (
    <div className="text-sm" data-testid="setup-required-card">
      <p className="text-ink-100">{setupReasonCopy(current)}</p>
      <p className="mt-2 text-xs text-ink-400" data-testid="setup-required-machine">Checking: <span className="text-ink-200">{machineCopy(current)}</span></p>
      <ul className="mt-3 flex flex-col gap-1.5" data-testid="setup-required-items">
        {current.items.map((item) => {
          const ready = item.state === 'ready';
          const fallback = item.state === 'fallback';
          return (
            <li key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-ink-800 px-3 py-2">
              <div className="min-w-0">
                <div className="text-ink-100">{item.label}{item.required ? '' : <span className="ml-1 text-[11px] text-ink-500">optional</span>}</div>
                {!ready && !fallback && item.setupTitle ? <div className="text-[11px] text-ink-500">{item.setupTitle}</div> : null}
                {fallback && item.fallback ? <div className="text-[11px] text-ink-500">Will use: {item.fallback} (reduced output)</div> : null}
              </div>
              <div className={`flex-none text-xs ${ready ? 'text-success-600 dark:text-success-400' : fallback ? 'text-ink-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {item.label} — {item.stateLabel}
              </div>
            </li>
          );
        })}
      </ul>
      {blocking.length === 0 && optional.length ? (
        <p className="mt-2 text-xs text-ink-500">Only optional items are limited; they use their declared fallback.</p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-success text-xs px-3 py-1.5" onClick={openSetup}>Open setup in Implexa</button>
        <button type="button" disabled={checking} className="btn-outline text-xs px-3 py-1.5 disabled:opacity-60" onClick={recheck}>
          {checking ? 'Rechecking…' : 'Recheck'}
        </button>
        <button type="button" disabled={checking} className="text-xs text-ink-500 hover:underline disabled:opacity-60" onClick={onCancel}>Cancel</button>
      </div>
      <p className="mt-3 text-[11px] text-ink-500">Nothing was queued. Installation and sign-in happen only when you choose them in Implexa; Implexa never installs software or captures credentials on its own.</p>
      {note ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{note}</p> : null}
    </div>
  );
}
