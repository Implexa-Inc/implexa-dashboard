'use client';

/**
 * <ProfessionalV2ProposalCard /> — a saved `professional-generation-control.v2`
 * plan, and the one control that could authorize it.
 *
 * RULES THIS COMPONENT ENFORCES
 *
 *  * Every figure shown is the backend's: windows, prompts, per-take credits,
 *    the decomposition, the ceiling. Nothing is summed, priced or rounded here,
 *    and there is no money figure because the contract supplies none.
 *  * Approval passes through decideProfessionalApproval and nothing else. Six
 *    independent conditions, any one of which refuses; availability is the
 *    BACKEND's answer, so with the Professional server flags false this card
 *    shows the plan and offers no approval at all — not even a disabled one.
 *  * The ceiling is confirmed EXPLICITLY, by a control that names the exact
 *    number including a repair reserve that may never run. "Approve" alone is
 *    not consent to a maximum the user never read.
 *  * Success is claimed only when the response parses under the strict v2
 *    parser, names THIS proposal with the SAME proposal and graph digests, and
 *    reads lifecycle `approved`. A malformed or foreign `{ok:true}` is an answer
 *    we could not verify, and it is announced as unverified.
 *  * Edit destroys the approval identity locally, before navigating.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ProfessionalCostSummary from './professional-cost-summary';
import { capabilityWords } from '@/lib/quality-mode';
import type { ProfessionalV2ProposalViewModel } from '@/lib/generation-proposal-v2-envelope';
import {
  approvalRefFor, decideProfessionalApproval, interpretProfessionalApprovalResponse,
  invalidateApprovalRef, type ProfessionalApprovalRef,
} from '@/lib/professional-v2-entry';

type Props = {
  vm: ProfessionalV2ProposalViewModel;
  agentName: string | null;
  /** Where Edit sends the user to shape a NEW plan (usually the source run). */
  editHref: string | null;
};

function formatWindow(startMs: number, endMs: number): string {
  const seconds = (ms: number) => (ms / 1000).toFixed(3).replace(/\.?0+$/, '');
  return `${seconds(startMs)}s – ${seconds(endMs)}s`;
}

export default function ProfessionalV2ProposalCard({ vm, agentName, editHref }: Props) {
  const router = useRouter();
  // Minted ONCE per mounted card. A deliberate retry after an unverified result
  // reuses it, so even a request that timed out ambiguously cannot double-authorize.
  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `approve-${crypto.randomUUID()}`
      : `approve-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  );
  const [ref, setRef] = useState<ProfessionalApprovalRef>(() => approvalRefFor(vm, null));
  const [confirmedCeiling, setConfirmedCeiling] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const compiled = vm.compiled;
  const tasksById = useMemo(() => new Map(compiled.tasks.map((t) => [t.taskId, t])), [compiled.tasks]);
  // An unavailable plan still carries its graph, so it renders as a PREVIEW: the
  // plan is shown and no money action exists at all.
  const previewOnly = compiled.availability !== true;
  const edited = ref.proposalId === null;

  const decision = decideProfessionalApproval({
    vm, ref,
    currentTimelineFingerprint: null,
    confirmedMaximumCredits: confirmedCeiling ? compiled.maximumCredits : null,
    idempotencyKey: idempotencyKeyRef.current,
    inFlight: inFlight || settled,
    now: Date.now(),
  });

  const onApprove = useCallback(async () => {
    if (inFlight || settled) return;
    // The gate is re-evaluated at CLICK TIME with a fresh clock: a card that sat
    // open past its expiry must not approve on a stale verdict.
    const gate = decideProfessionalApproval({
      vm, ref,
      currentTimelineFingerprint: null,
      confirmedMaximumCredits: confirmedCeiling ? compiled.maximumCredits : null,
      idempotencyKey: idempotencyKeyRef.current,
      inFlight: false,
      now: Date.now(),
    });
    if (!gate.ok) { setError(gate.message); return; }
    setInFlight(true); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/generation-proposals', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(gate.request),
      });
      const body = await res.json().catch(() => null);
      const read = interpretProfessionalApprovalResponse(res.ok, body, ref);
      if (read.outcome === 'confirmed') {
        setSettled(true);
        setNotice(`Authorized up to ${compiled.maximumCredits} credits across ${compiled.taskCount} generations. This is not a payment — usage is recorded as the work actually runs.`);
        router.refresh();
        return;
      }
      if (read.outcome === 'refused') {
        setError(`Implexa refused this approval (${read.code}). Nothing was authorized.`);
        router.refresh();
        return;
      }
      setError('We could not confirm whether this approval went through. Reload to see the current state — retrying from this card cannot authorize it twice.');
      router.refresh();
    } catch {
      setError('We could not reach Implexa to approve this. Nothing is known to have been authorized — try again.');
    } finally {
      setInFlight(false);
    }
  }, [compiled.maximumCredits, compiled.taskCount, confirmedCeiling, inFlight, ref, router, settled, vm]);

  const onCancel = useCallback(async () => {
    setCancelBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/generation-proposals', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', proposalId: vm.proposalId }),
      });
      const body = await res.json().catch(() => null);
      const parsed = res.ok && body && typeof body === 'object'
        && (body as { lifecycle_state?: unknown }).lifecycle_state === 'cancelled'
        && (body as { proposal_id?: unknown }).proposal_id === vm.proposalId;
      if (parsed) { setNotice('Plan cancelled. Nothing was authorized.'); router.refresh(); return; }
      setError('We could not confirm whether this cancellation went through. Reload to see the current state.');
      router.refresh();
    } catch {
      setError('We could not reach Implexa to cancel this.');
    } finally { setCancelBusy(false); }
  }, [router, vm.proposalId]);

  const onEdit = useCallback(() => {
    // Forget the approval identity FIRST, so nothing on this card can approve the
    // old plan after the user has decided to change it.
    setRef(invalidateApprovalRef());
    setConfirmedCeiling(false);
    setError(null); setNotice(null);
    if (editHref) router.push(editHref);
  }, [editHref, router]);

  return (
    <section aria-label="Professional generation plan" className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink-100">
            {/* COVERAGE and TAKES, always as two numbers. */}
            Professional timeline — {compiled.momentCount} B-roll moment{compiled.momentCount === 1 ? '' : 's'}
            {' from '}{compiled.candidateTaskCount} generated take{compiled.candidateTaskCount === 1 ? '' : 's'}
            {compiled.repairTaskCount > 0 && ` + ${compiled.repairTaskCount} repair reserve${compiled.repairTaskCount === 1 ? '' : 's'}`}
          </h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Requested by {agentName ?? vm.agentSubject} · plan {compiled.controlContractVersion}
          </p>
        </div>
        <div className="text-right text-xs text-ink-400">
          <p>{compiled.moments[0]?.providerIdentity.provider} · {compiled.moments[0]?.providerIdentity.model}</p>
          <p className="mt-0.5">Expires {new Date(vm.expiresAt).toLocaleString()}</p>
        </div>
      </header>

      <div className="mt-4">
        <ProfessionalCostSummary
          source="backend-compiled"
          cost={{
            expectedCredits: compiled.initialCredits,
            repairReserveCredits: compiled.repairReserveCredits,
            maximumCredits: compiled.maximumCredits,
            variantTaskCount: compiled.candidateTaskCount,
            repairTaskCount: compiled.repairTaskCount,
            totalTaskCount: compiled.taskCount,
            coverageMomentCount: compiled.momentCount,
          }}
        />
      </div>

      <ol className="mt-4 space-y-3">
        {compiled.moments.map((moment, index) => (
          <li key={moment.momentId} className="rounded border border-ink-800 bg-ink-950 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-ink-200">Moment {index + 1}</span>
              <span className="font-mono text-ink-400">{formatWindow(moment.startMs, moment.endMs)}</span>
              <span className="text-ink-500">{moment.durationSeconds}s · {moment.ratio}</span>
              <span className="ml-auto text-ink-300">{moment.maximumCredits} credits max</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-snug text-ink-300">{moment.prompt}</p>
            <p className="mt-1.5 text-[11px] text-ink-500">
              {moment.variantsRequested} take{moment.variantsRequested === 1 ? '' : 's'} at {moment.creditsPerTask} credits each ·
              {' '}Judge {moment.judgeMode === 'off' ? 'off — every take is returned, nothing is selected' : 'ranked — one take is selected'} ·
              {' '}{moment.maxRepairs === 0 ? 'no repair reserve' : `${moment.maxRepairs} repair held in reserve`}
            </p>
            <ul className="mt-2 space-y-1.5">
              {[...moment.candidateTaskIds, ...moment.repairTaskIds].map((taskId) => {
                const task = tasksById.get(taskId);
                if (!task) return null;
                return (
                  <li key={taskId} className="rounded border border-ink-800/70 bg-ink-900/40 p-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-medium text-ink-300">
                        {task.kind === 'candidate' ? `Take ${task.ordinal}` : `Repair reserve ${task.ordinal}`}
                      </span>
                      <span className="ml-auto text-ink-400">{task.credits} credits</span>
                    </div>
                    {task.kind === 'repair' && (
                      <p className="mt-1 text-[11px] text-ink-500">
                        Contingent — spent only if the Judge fails a take for this moment.
                      </p>
                    )}
                    {/* The EXACT string the provider receives, not the source text. */}
                    <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-ink-500">{task.promptText}</p>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-[11px] text-ink-500">
        This plan authorizes per-moment generation and a projection. It does not authorize a
        final rendered file{compiled.finalRenderAuthorized ? '' : ' — assembly stays a projection'}.
      </p>

      {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}

      {previewOnly && (
        <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
          Professional generation is not available on your account yet, so this plan cannot be
          approved or run. Missing: {compiled.requiredMissingCapabilities.map(capabilityWords).join(', ')}.
        </p>
      )}

      {edited && (
        <p className="mt-3 text-xs text-amber-300">
          You chose to edit this plan. This card can no longer approve it — the edit produces a
          new plan with its own approval.
        </p>
      )}

      {!previewOnly && (
        <>
          <label className="mt-4 flex items-start gap-2 text-xs text-ink-200">
            <input
              type="checkbox" checked={confirmedCeiling} disabled={inFlight || settled || edited}
              onChange={(e) => setConfirmedCeiling(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I understand this authorizes <strong>up to {compiled.maximumCredits} credits</strong> across{' '}
              {compiled.taskCount} generations — {compiled.initialCredits} for the{' '}
              {compiled.candidateTaskCount} take{compiled.candidateTaskCount === 1 ? '' : 's'}, plus{' '}
              {compiled.repairReserveCredits} held in reserve for repairs that may never run.
            </span>
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button" onClick={onApprove} disabled={!decision.ok}
              className="rounded-md bg-ink-100 px-3 py-2 text-sm font-medium text-ink-950 disabled:opacity-40"
            >
              {inFlight ? 'Approving…' : settled ? 'Approved' : `Approve up to ${compiled.maximumCredits} credits`}
            </button>
            {editHref && (
              <button
                type="button" onClick={onEdit} disabled={inFlight}
                className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 disabled:opacity-40"
              >
                Edit
              </button>
            )}
            {!edited && vm.lifecycle === 'awaiting_approval' && (
              <button
                type="button" onClick={onCancel} disabled={inFlight || cancelBusy}
                className="rounded-md border border-ink-800 px-3 py-2 text-sm text-ink-400 hover:text-red-300 disabled:opacity-40"
              >
                Cancel
              </button>
            )}
          </div>
          {!decision.ok && !inFlight && !settled && (
            <p className="mt-2 text-[11px] text-amber-300">{decision.message}</p>
          )}
          <p className="mt-2 text-[11px] leading-snug text-ink-500">
            Approving authorizes this exact timeline and nothing else. It is not a payment —
            usage is recorded as the work actually runs.
          </p>
        </>
      )}

      {previewOnly && editHref && (
        <div className="mt-3">
          <button
            type="button" onClick={onEdit}
            className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200"
          >
            Edit this plan
          </button>
        </div>
      )}
    </section>
  );
}
