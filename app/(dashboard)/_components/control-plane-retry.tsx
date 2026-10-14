'use client';

// "Retry safely — no work started previously" (backend 0336).
//
// Rendered on a run whose request was surfaced after a Codex control-plane
// attachment failure. The BACKEND proves eligibility positively from its ledger
// and issues an opaque grant; this component reads it, shows the explicit
// distinction from "Run again", asks for confirmation, and posts ONLY that
// grant. It never sends attempt ids, fences, versions, digests or proof tokens,
// and it never claims a queue the server did not confirm.
//
// THE CLAIM. The no-work sentence is shown only after
// affirmative eligibility or a confirmed queued receipt. A refused or uncertain
// state says why the action is unavailable and nothing more.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import {
  describeControlPlaneRetry, retryConfirmed, mayClaimNoWork,
  RETRY_SAFELY_LABEL, RETRY_SAFELY_DISTINCTION, RUN_AGAIN_DISTINCTION, NO_WORK_CLAIM, QUEUED_RECEIPT,
  PAID_RECOVERY_LABEL, PAID_RECOVERY_CLAIM, PAID_QUEUED_RECEIPT,
  PAID_LEASE_RETIREMENT_CLAIM,
  PAID_ISSUED_LEASE_RETIREMENT_CLAIM,
  PAID_CLOSED_OWNER_RECOVERY_CLAIM,
  PAID_CLOSED_CLASS_RECOVERY_CLAIM,
  PAID_POSTSTART_UNCLAIMED_CLAIM,
  PAID_SETTLED_BATCH_RESUME_CLAIM,
} from '@/lib/control-plane-retry';

type LocalInputBridge = {
  localInputReauthorizationState?: (runId: string, requestId?: string) => Promise<{
    ok?: boolean; applicable?: boolean; required?: boolean; error?: string; paidSettlementArchiveChecked?: boolean;
  }>;
  reauthorizeRunInputs?: (runId: string) => Promise<{
    ok?: boolean; canceled?: boolean; error?: string;
  }>;
};

function localInputBridge(): LocalInputBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { implexaDesktop?: LocalInputBridge }).implexaDesktop || null;
}

export function ControlPlaneRetry({ requestId, runId }: { requestId: string; runId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [eligibility, setEligibility] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const path = `/api/v2/me/run-requests/${encodeURIComponent(requestId)}/control-plane-retry`;

  async function readEligibility(active: () => boolean) {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) return;
      const value = await callBackend(path, { jwt: data.session.access_token });
      if (active()) setEligibility(value);
    } catch {
      if (active()) setEligibility(null);
    }
  }

  useEffect(() => {
    let active = true;
    void readEligibility(() => active);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, supabase]);

  const presentation = describeControlPlaneRetry(eligibility);
  if (queued || presentation.state === 'queued') {
    return (
      <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-3 text-sm text-ink-200">
        {'paidPrelaunch' in presentation && presentation.paidPrelaunch ? PAID_QUEUED_RECEIPT : QUEUED_RECEIPT}
      </div>
    );
  }
  if (presentation.state === 'hidden') return null;

  async function retry() {
    if (busy || inFlight.current || presentation.state !== 'available') return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('missing_session');
      // A retry preserves the input binding, not Desktop's process-local access
      // to a large source. The Desktop bridge owns the API-key-only authority
      // read and verifies the exact bytes before this UI may consume the grant.
      const bridge = localInputBridge();
      if (!bridge?.localInputReauthorizationState) {
        setError('Open this run in Implexa on the source Mac before retrying. Nothing was queued.');
        return;
      }
      const state = await bridge.localInputReauthorizationState(runId, requestId);
      if (state?.error === 'paid_action_settlement_recovery_pending') {
        setError('Wait for Implexa to finish recovering and archiving the existing paid clip before resuming. Nothing was queued.');
        return;
      }
      if (presentation.failureCode === 'paid_settled_batch_resume' && state?.paidSettlementArchiveChecked !== true) {
        setError('This Implexa app cannot confirm that paid settlement recovery finished. Update the app before resuming; nothing was queued.');
        return;
      }
      if (!state?.ok || typeof state.applicable !== 'boolean'
          || (state.applicable && typeof state.required !== 'boolean')) {
        throw new Error('local_input_reauthorization_unavailable');
      }
      if (state.applicable && state.required) {
        if (!bridge.reauthorizeRunInputs) {
          setError('This Implexa app cannot reconnect the original file; nothing was queued.');
          return;
        }
        const restored = await bridge.reauthorizeRunInputs(runId);
        if (!restored?.ok) {
          setError(restored?.canceled ? 'Original file selection canceled; nothing was queued.'
            : restored?.error === 'input_digest_mismatch'
              ? 'That file does not match the original source; nothing was queued.'
              : 'Could not verify the original source; nothing was queued.');
          return;
        }
        const rechecked = await bridge.localInputReauthorizationState(runId, requestId);
        if (!rechecked?.ok || rechecked.applicable !== true || rechecked.required !== false
            || (presentation.failureCode === 'paid_settled_batch_resume' && rechecked.paidSettlementArchiveChecked !== true)) {
          throw new Error('local_input_reauthorization_unavailable');
        }
      }
      const result = await callBackend(path, {
        jwt: session?.access_token, method: 'POST',
        body: { grantId: presentation.grantId },
      });
      if (!retryConfirmed(result)) throw new Error('unconfirmed');
      setQueued(true);
      router.refresh();
    } catch {
      setError('Could not queue the safe retry. The request may have changed; its current state was reloaded.');
      setConfirming(false);
      await readEligibility(() => true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/[0.06] px-3 py-3">
      <div className="text-sm font-semibold text-ink-100">{'paidPrelaunch' in presentation && presentation.paidPrelaunch ? PAID_RECOVERY_LABEL : RETRY_SAFELY_LABEL}</div>
      {presentation.state === 'available' && presentation.paidPrelaunch && (
        <p className="mt-1 text-xs text-ink-300 leading-relaxed">{presentation.failureCode === 'paid_settled_batch_resume' ? PAID_SETTLED_BATCH_RESUME_CLAIM : presentation.failureCode === 'paid_poststart_unclaimed' ? PAID_POSTSTART_UNCLAIMED_CLAIM : presentation.ownerRecoveryIndex ? PAID_CLOSED_CLASS_RECOVERY_CLAIM : presentation.failureCode === 'paid_owner_closed_prelaunch_recovery' ? PAID_CLOSED_OWNER_RECOVERY_CLAIM : presentation.failureCode === 'paid_unacknowledged_lease_retirement' ? PAID_ISSUED_LEASE_RETIREMENT_CLAIM : presentation.leaseRetirement ? PAID_LEASE_RETIREMENT_CLAIM : PAID_RECOVERY_CLAIM}</p>
      )}
      {presentation.state === 'available' && presentation.unknownRuntimeHistory && !['paid_poststart_unclaimed','paid_settled_batch_resume'].includes(presentation.failureCode) && (
        <p className="mt-1 text-xs text-ink-300">An earlier worker ran and its failed settlement remains preserved. Its owner recovery proved no managed paid submission, not global no-action.</p>
      )}
      {presentation.state === 'available' && presentation.ownerRecoveryIndex && (
        <p className="mt-1 text-xs text-ink-300">Owner recovery {presentation.ownerRecoveryIndex} of {presentation.ownerRecoveryLimit} in this window.</p>
      )}
      {mayClaimNoWork(presentation) && (
        <p className="mt-1 text-xs text-ink-300 leading-relaxed">{NO_WORK_CLAIM}</p>
      )}
      <ul className="mt-2 text-xs text-ink-400 leading-relaxed">
        <li>{RETRY_SAFELY_DISTINCTION}</li>
        <li>{RUN_AGAIN_DISTINCTION}</li>
      </ul>
      {presentation.state === 'disabled' && (
        <p className="mt-2 text-xs text-amber-300">
          {presentation.workMayHaveOccurred ? 'Retry safely is unavailable because work or an external action may have occurred: ' : 'Retry safely is unavailable: '}
          {presentation.explanation}
        </p>
      )}
      {presentation.state === 'available' && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} disabled={busy}
          className="mt-2 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
          Retry safely
        </button>
      )}
      {presentation.state === 'available' && confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-300">{presentation.ownerRecoveryIndex ? `Use owner recovery ${presentation.ownerRecoveryIndex} of ${presentation.ownerRecoveryLimit} for this closed attempt?` : presentation.failureCode === 'paid_owner_closed_prelaunch_recovery' ? 'Use the one additional recovery for this closed attempt?' : presentation.failureCode === 'paid_unacknowledged_lease_retirement' ? 'Retire the expired lease and use the one additional recovery?' : presentation.leaseRetirement ? 'Retire the expired lease and queue the same approved batch?' : 'Queue the same request with its frozen version and inputs?'}</span>
          <button type="button" onClick={() => void retry()} disabled={busy}
            className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? 'Queuing…' : 'Queue the same request'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-60">
            Keep it paused
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}

export default ControlPlaneRetry;
