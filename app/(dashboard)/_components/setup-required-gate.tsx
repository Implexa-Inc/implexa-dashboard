'use client';

/**
 * ONE handler for the typed `setup_required` refusal (backend 0346), shared by
 * every surface that creates a run request: Run, managed continuation, approval /
 * change / local-input continuation, Finish, Fix now, and the recovery paths.
 *
 * The rule every surface must obey and none may re-implement:
 *   • a 409 `setupRequired` is a DECISION, never an error sentence, never a
 *     swallowed catch, and never followed by navigation — the user stays where
 *     they are, sees the modal, and Recheck retries the SAME action once;
 *   • every other error is rethrown to the surface's own handling, unchanged.
 *
 *   const gate = useSetupRequiredGate({ slug, workflowVersionId });
 *   const r = await gate.guard(() => callBackend('/api/v2/me/run-requests', …), onSuccess);
 *   if (!r.ok) return;            // the modal is open; nothing else happens
 *   …                             // success path (navigate, confirm)
 *   return <>{…}{gate.modal}</>;
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import Modal from './modal';
import SetupRequiredCard from './setup-required-card';
import { parseSetupRequired, type SetupRequiredCard as Card } from '@/lib/setup-required';

export const SETUP_REQUIRED_TITLE = 'Setup required before this agent can run.';

export type GuardResult<T> = { ok: true; value: T } | { ok: false; setupRequired: true; card: Card };

/** The modal shell + card, used directly by surfaces that keep their own retry state (Run, Continue). */
export function SetupRequiredModal({ card, slug = null, workflowVersionId = null, preAdmit = false, onAdmitted, onCancel }: {
  card: Card | null;
  slug?: string | null;
  workflowVersionId?: string | null;
  preAdmit?: boolean;
  onAdmitted: (machineId: string | null) => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <Modal open={!!card} onClose={onCancel} title={SETUP_REQUIRED_TITLE}>
      {card && (
        <SetupRequiredCard card={card} slug={slug} workflowVersionId={workflowVersionId} preAdmit={preAdmit} onAdmitted={onAdmitted} onCancel={onCancel} />
      )}
    </Modal>
  );
}

export function useSetupRequiredGate({ slug = null, workflowVersionId = null }: { slug?: string | null; workflowVersionId?: string | null } = {}) {
  const [pending, setPending] = useState<{ card: Card; retry: (machineId: string | null) => Promise<void> } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const guard = useCallback(async function guard<T>(
    action: (opts: { machineId: string | null }) => Promise<T>,
    onSuccess?: (value: T) => void | Promise<void>,
    machineId: string | null = null,
  ): Promise<GuardResult<T>> {
    try {
      const value = await action({ machineId });
      if (onSuccess) await onSuccess(value);
      return { ok: true, value };
    } catch (e) {
      const card = parseSetupRequired(e);
      if (!card) throw e;
      // Retry = the SAME action, once, on the machine the admission was proven
      // on. A second refusal simply replaces the card; still no navigation.
      setPending({ card, retry: async (admittedMachine) => { await guard(action, onSuccess, admittedMachine ?? card.machine.id); } });
      return { ok: false, setupRequired: true, card };
    }
  }, []);

  const cancel = useCallback(() => setPending(null), []);
  const modal: ReactNode = (
    <SetupRequiredModal
      card={pending ? pending.card : null}
      slug={slug}
      workflowVersionId={workflowVersionId}
      onAdmitted={async (machineId) => { const p = pendingRef.current; setPending(null); if (p) await p.retry(machineId); }}
      onCancel={cancel}
    />
  );
  return { guard, modal, card: pending ? pending.card : null, cancel };
}
