'use client';

/**
 * <SetupRequiredCard /> — "Setup required before this agent can run." (backend 0346)
 *
 * Shown IMMEDIATELY at the Run click when the backend's admission call refuses.
 * Lists each requirement with its state ("Higgsfield CLI — Not installed"),
 * names WHICH computer was checked, and offers exactly three actions:
 *   • Open setup in Implexa — the in-app setup page FOR THAT COMPUTER (install/
 *     sign-in are the user's explicit clicks there; nothing is installed or
 *     captured silently);
 *   • Recheck — asks the Desktop (when this page runs inside it, on that same
 *     computer) to re-probe and re-attest, then asks the BACKEND for the
 *     decision again, for the SAME machine the card was raised for. On admission
 *     the SAME action continues, once (onAdmitted).
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
  /** Continue the ORIGINAL action — same note, same inputs, on the SAME machine — exactly once. */
  onAdmitted: (machineId: string | null) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState<Card>(card);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Two refs, both SYNCHRONOUS (set before the first await): a second click
  // that lands while a check is in flight — React state has not re-rendered
  // the disabled button yet — must not start a second admission, and must
  // never continue the same action twice. `checking` (state) only drives the
  // label; `inFlightRef` is the guard.
  const inFlightRef = useRef(false);
  const admittedRef = useRef(false);
  const supabase = createClient();
  const inApp = !!bridge();

  async function recheck() {
    if (inFlightRef.current || admittedRef.current) return;
    inFlightRef.current = true;
    setChecking(true);
    setNote(null);
    // THE machine this card was raised for. Recheck asks about it — not about
    // whichever computer is answering the bridge right now.
    const machineId: string | null = current.machine.id;
    try {
      const native = bridge();
      if (native?.recheckMachineCapabilities) {
        // Only this computer can re-probe itself: ask the bridge to re-probe
        // when it IS the selected machine (or the card named none).
        const bridgeMachine = native.executionMachineId ? await native.executionMachineId().catch(() => null) : null;
        if (!machineId || !bridgeMachine || bridgeMachine === machineId) {
          const r = await native.recheckMachineCapabilities().catch(() => ({ ok: false, reason: 'recheck_failed' }));
          if (!r.ok) setNote('The Implexa app could not re-check this computer. Make sure it is signed in, then try again.');
        } else {
          setNote(`This check is for ${machineCopy(current)}. Open Implexa on that computer to re-probe it; its last report is used here.`);
        }
      }
      if (admittedRef.current) return;
      if (!slug) {
        // No agent to pre-admit (a Continue): retry the original action once;
        // the backend re-runs admission at request birth and answers 409 again
        // if setup is still incomplete, which lands back in this modal.
        admittedRef.current = true;
        await onAdmitted(machineId);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend('/api/v2/me/run-admission', {
        jwt: session?.access_token, method: 'POST',
        body: { workflowSlug: slug, ...(workflowVersionId ? { workflowVersionId } : {}), ...(machineId ? { executionMachineId: machineId } : {}) },
      });
      if (admittedRef.current) return;
      if (res?.ok === true && res?.admitted === true) {
        admittedRef.current = true;
        await onAdmitted(machineId);
        return;
      }
      setNote('Implexa could not confirm readiness. Try again in a moment.');
    } catch (e) {
      const next = parseSetupRequired(e);
      if (next) { setCurrent(next); return; }
      setNote(e instanceof Error ? e.message : 'Recheck failed.');
    } finally {
      inFlightRef.current = false;
      setChecking(false);
    }
  }

  function openSetup() {
    const target = slug || 'this-agent';
    // The selected machine rides along as a path segment: the setup page shows
    // exactly the computer this card is about.
    if (inApp) { window.location.href = machineSetupPath(target, current.machine.id); return; }
    // Plain web: hand off to the app, which routes the same path in-app.
    window.location.href = appMachineSetupUrl(target, current.machine.id);
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
