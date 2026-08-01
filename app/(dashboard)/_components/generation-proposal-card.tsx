'use client';

/**
 * <GenerationProposalCard /> — exactly what the backend proposes, and the one
 * button that authorizes it.
 *
 * RULES THIS COMPONENT ENFORCES:
 *
 *  * Every figure shown is the backend's: clips, prompts, windows, credits per
 *    clip, the maximum. Nothing is summed, priced, or rounded here. There is no
 *    dollar figure because the contract supplies none.
 *  * Approve sends the proposal id + version + digest THE USER SAW, with one
 *    idempotency key minted once per mounted card. A double-click sends exactly
 *    one request (beginApproval); a deliberate retry reuses the same key.
 *  * Approval success says what was AUTHORIZED. It never says paid or charged.
 *  * Edit forgets the approval identity locally (editReset) — an edited proposal
 *    can only be approved after the backend issues a new id/version/digest.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GenerationProposalViewModel } from '@/lib/generation-proposal';
import {
  approvalConfirmationCopy, approvalErrorCopy, beginApproval, buildApprovalRequest,
  editReset, formatWindow, proposalActions, requestedByLine, settleApproval,
  type ApprovalFlight, type EditableProposalRef,
} from '@/lib/generation-proposal-state';
import { qualityModeLabel } from '@/lib/quality-mode';

type Props = {
  vm: GenerationProposalViewModel;
  agentName: string | null;
  /** Where Edit sends the user to shape a NEW proposal (usually the source run). */
  editHref: string | null;
};

export default function GenerationProposalCard({ vm, agentName, editHref }: Props) {
  const router = useRouter();
  // Minted ONCE per mounted card. A retry after a retryable error reuses it, so
  // even a request that timed out ambiguously can never double-authorize.
  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `approve-${crypto.randomUUID()}` : `approve-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  );
  const [flight, setFlight] = useState<ApprovalFlight>({ phase: 'idle' });
  // The approval identity lives in STATE so Edit can destroy it. Approve reads
  // from here, never from the prop, so an edited card has nothing left to send.
  const [ref, setRef] = useState<EditableProposalRef>({
    proposalId: vm.proposalId, proposalVersion: vm.proposalVersion, proposalDigest: vm.proposalDigest,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const acts = useMemo(() => proposalActions(vm, Date.now()), [vm]);
  const edited = ref.proposalId === null;

  const onApprove = useCallback(async () => {
    const { next, shouldSend } = beginApproval(flight);
    setFlight(next);
    if (!shouldSend) return;
    setError(null); setNotice(null);
    if (!ref.proposalId || !ref.proposalVersion || !ref.proposalDigest) {
      // Edited locally: there is deliberately no identity left to approve with.
      setError('This proposal was edited. Approve the new proposal it produces instead.');
      setFlight((s) => settleApproval(s, 'retryable_error'));
      return;
    }
    const req = buildApprovalRequest(
      { proposalId: ref.proposalId, proposalVersion: ref.proposalVersion, proposalDigest: ref.proposalDigest },
      idempotencyKeyRef.current,
    );
    try {
      const res = await fetch('/api/generation-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          proposalId: ref.proposalId,
          proposalVersion: req.body.proposalVersion,
          proposalDigest: req.body.proposalDigest,
          idempotencyKey: req.idempotencyKey,
        }),
      });
      const body = await res.json().catch(() => ({ ok: false, error: 'unreadable_response' }));
      if (body?.ok) {
        setFlight((s) => settleApproval(s, 'success'));
        setNotice(approvalConfirmationCopy(vm));
        router.refresh();
        return;
      }
      if (body?.unavailable) {
        // The approve may or may not have landed. Honest words + a re-read; the
        // idempotency key makes a deliberate retry safe.
        setError('We could not confirm whether this approval went through. Reload to see the current state — retrying with this same card cannot approve it twice.');
        setFlight((s) => settleApproval(s, 'retryable_error'));
        router.refresh();
        return;
      }
      setError(approvalErrorCopy(String(body?.error || 'proposal_transition_failed')));
      setFlight((s) => settleApproval(s, 'retryable_error'));
      router.refresh();
    } catch {
      setError('We could not reach Implexa to approve this. Nothing is known to have been authorized — try again.');
      setFlight((s) => settleApproval(s, 'retryable_error'));
    }
  }, [flight, ref, vm, router]);

  const onCancel = useCallback(async () => {
    setCancelBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/generation-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', proposalId: vm.proposalId }),
      });
      const body = await res.json().catch(() => ({ ok: false, error: 'unreadable_response' }));
      if (body?.ok) { setNotice('Proposal cancelled. Nothing was authorized.'); router.refresh(); return; }
      setError(approvalErrorCopy(String(body?.error || 'proposal_transition_failed')));
    } catch {
      setError('We could not reach Implexa to cancel this.');
    } finally { setCancelBusy(false); }
  }, [vm.proposalId, router]);

  const onEdit = useCallback(() => {
    // Forget the approval identity FIRST, so nothing on this card can approve the
    // old payload after the user has decided to change it.
    setRef(editReset(ref));
    setNotice(null);
    setError(null);
    if (editHref) router.push(editHref);
  }, [ref, editHref, router]);

  const busy = flight.phase === 'submitting';

  return (
    <section aria-label="Generation proposal" className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink-100">
            {qualityModeLabel(vm.qualityMode)} generation — {vm.taskCount} clip{vm.taskCount === 1 ? '' : 's'}
          </h2>
          <p className="mt-0.5 text-xs text-ink-400">{requestedByLine(vm, agentName)}</p>
        </div>
        <div className="text-right text-xs text-ink-400">
          {vm.provider && vm.model && <p>{vm.provider} · {vm.model}</p>}
          <p className="mt-0.5">Expires {new Date(vm.expiresAt).toLocaleString()}</p>
        </div>
      </header>

      {/* Every clip, verbatim: window, exact prompt, duration/ratio, credits. */}
      <ul className="mt-3 space-y-2">
        {vm.tasks.map((task) => (
          <li key={task.taskId} className="rounded border border-ink-800 bg-ink-950 p-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-ink-200">{task.momentId} — {task.variant}</span>
              <span className="font-mono text-ink-400">{formatWindow(task.window)}</span>
              <span className="text-ink-500">{task.durationSeconds}s · {task.ratio}</span>
              <span className="ml-auto text-ink-300">{task.credits} credits</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-snug text-ink-400">{task.promptText}</p>
          </li>
        ))}
      </ul>

      <dl className="mt-3 space-y-1 text-xs text-ink-400">
        <div className="flex gap-1.5">
          <dt className="font-medium text-ink-300">Maximum total:</dt>
          {/* Credits only. This contract supplies no dollar figure, so none is shown. */}
          <dd>{vm.maximumCredits} credits</dd>
        </div>
        {vm.reviewRequirements.length > 0 && (
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium text-ink-300">Review:</dt>
            <dd>{vm.reviewRequirements.map((r) => r.replace(/_/g, ' ')).join(', ')}</dd>
          </div>
        )}
      </dl>

      {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}

      {acts.blockedReason && !edited && (
        <p className="mt-3 text-xs text-amber-300">{acts.blockedReason}</p>
      )}
      {edited && (
        <p className="mt-3 text-xs text-amber-300">
          You chose to edit this proposal. This card can no longer approve it — the
          edit produces a new proposal with its own approval.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || edited || !acts.canApprove || flight.phase === 'settled'}
          onClick={onApprove}
          className="rounded-md bg-ink-100 px-3 py-2 text-sm font-medium text-ink-950 disabled:opacity-40"
        >
          {acts.approveLabel}
        </button>
        {acts.canEdit && (
          <button
            type="button" disabled={busy} onClick={onEdit}
            className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 disabled:opacity-40"
          >
            Edit
          </button>
        )}
        {acts.canCancel && !edited && (
          <button
            type="button" disabled={busy || cancelBusy} onClick={onCancel}
            className="rounded-md border border-ink-800 px-3 py-2 text-sm text-ink-400 hover:text-red-300 disabled:opacity-40"
          >
            Cancel
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink-500">
        Approving authorizes this exact set of clips and nothing else. It is not a
        payment — usage is recorded as the work actually runs.
      </p>
    </section>
  );
}
