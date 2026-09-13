'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import {
  formatPaidActionCost,
  paidActionModelLabel,
  validPaidActionApprovalResponse,
  type PaidActionApprovalView,
} from '@/lib/paid-action-approval';

export default function PaidActionApproval({ runId, view }: { runId: string; view: PaidActionApprovalView }) {
  const router = useRouter();
  const supabase = createClient();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (view.state === 'agent_update_required') {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/[0.08] p-5" aria-labelledby="paid-approval-update-title">
        <h2 id="paid-approval-update-title" className="text-sm font-semibold text-ink-100">Agent update required</h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-200">
          This run used an older paid-action manifest that does not contain the trusted inputs, placement and per-request details required for approval. Nothing can be approved from this screen.
        </p>
      </section>
    );
  }
  if (view.state !== 'ready') {
    return (
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/[0.08] p-5" aria-labelledby="paid-approval-unavailable-title">
        <h2 id="paid-approval-unavailable-title" className="text-sm font-semibold text-ink-100">Approval details unavailable</h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-200">
          Implexa could not verify the complete paid-action batch. Reload this page after the run is repaired; no provider work can be approved here.
        </p>
      </section>
    );
  }

  const { summary } = view;
  const total = formatPaidActionCost(summary.estimatedCost, summary.currency);
  const models = [...new Set(summary.requests.map((request) => paidActionModelLabel(request.model)))];
  const batchLabel = models.length === 1 ? models[0] : paidActionModelLabel(summary.provider);

  async function approve() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('authentication unavailable');
      const result = await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/paid-action-approval`, {
        jwt: session.access_token,
        method: 'POST',
        body: {
          approvalIntentId: summary.approvalIntentId,
          requestManifestArtifactId: summary.requestManifestArtifactId,
          requestManifestDigest: summary.requestManifestDigest,
          projectCheckpointId: summary.projectCheckpointId,
          projectCheckpointDigest: summary.projectCheckpointDigest,
        },
      });
      if (!validPaidActionApprovalResponse(result, summary)) throw new Error('approval response did not match the reviewed batch');
      router.push('/workflows');
      router.refresh();
    } catch {
      inFlight.current = false;
      setBusy(false);
      setError('Implexa could not verify whether this approval was recorded. Retry the same exact batch; an existing approval will be reused and no second batch will be created.');
    }
  }

  return (
    <section className="rounded-lg border border-amber-400/40 bg-amber-400/[0.06] p-5" aria-labelledby="paid-approval-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300">Paid provider approval</p>
          <h2 id="paid-approval-title" className="mt-1 text-lg font-semibold text-ink-50">
            Review {summary.requestCount} {batchLabel} generation{summary.requestCount === 1 ? '' : 's'}
          </h2>
          <p className="mt-1 text-sm text-ink-400">No provider request is submitted until you approve this exact immutable batch.</p>
          <p className="mt-1 text-xs text-ink-500">
            Provider {paidActionModelLabel(summary.provider)} · Operation <span className="font-mono">{summary.operation}</span>
          </p>
        </div>
        <div className="rounded-md border border-amber-400/30 bg-black/20 px-3 py-2 text-right">
          <p className="text-[10px] uppercase tracking-wider text-ink-500">Estimated total</p>
          <p className="text-base font-semibold text-amber-200">{total}</p>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Verified inputs</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {summary.inputs.map((input) => (
            <li key={input.semanticKey} className="rounded-md border border-ink-700/70 bg-ink-950/40 p-3">
              <p className="text-xs text-ink-500">{input.semanticKey}</p>
              <p className="mt-0.5 break-words text-sm font-medium text-ink-100">{input.displayName}</p>
              <p className="mt-1 break-all font-mono text-[10px] text-ink-500">Artifact {input.artifactId}</p>
              <p className="mt-0.5 break-all font-mono text-[10px] text-ink-500">SHA-256 {input.sha256}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Exact generation requests</h3>
        <ol className="mt-2 space-y-3">
          {summary.requests.map((request, index) => (
            <li key={request.requestId} className="rounded-md border border-ink-700/70 bg-ink-950/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-100">{index + 1}. {request.sceneId}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-ink-500">Request {request.requestId}</p>
                </div>
                <p className="text-sm font-medium text-amber-200">{formatPaidActionCost(request.estimatedCost, summary.currency)}</p>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-200">{request.prompt}</p>
              <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
                <div><dt className="text-ink-500">Source frames</dt><dd className="mt-0.5 text-ink-200">[{request.sourceRange.startFrame}, {request.sourceRange.endFrame}) · end exclusive</dd></div>
                <div><dt className="text-ink-500">Model</dt><dd className="mt-0.5 text-ink-200">{paidActionModelLabel(request.model)}</dd></div>
                <div><dt className="text-ink-500">Output</dt><dd className="mt-0.5 text-ink-200">{request.resolution}, {request.durationSeconds}s</dd></div>
                <div><dt className="text-ink-500">Used in</dt><dd className="mt-0.5 text-ink-200">{request.intendedUse}</dd></div>
                <div><dt className="text-ink-500">Saved to</dt><dd className="mt-0.5 break-all font-mono text-ink-200">{request.outputRelativePath}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4 rounded-md border border-ink-700/60 bg-black/20 p-3">
        <p className="text-[10px] uppercase tracking-wider text-ink-500">Frozen request manifest</p>
        <p className="mt-1 break-all font-mono text-[10px] text-ink-400">Artifact {summary.requestManifestArtifactId}</p>
        <p className="mt-0.5 break-all font-mono text-[10px] text-ink-400">SHA-256 {summary.requestManifestDigest}</p>
      </div>

      <div className="mt-3 rounded-md border border-ink-700/60 bg-black/20 p-3">
        <p className="text-[10px] uppercase tracking-wider text-ink-500">Verified project checkpoint</p>
        <p className="mt-1 break-all font-mono text-[10px] text-ink-400">Checkpoint {summary.projectCheckpointId}</p>
        <p className="mt-0.5 break-all font-mono text-[10px] text-ink-400">SHA-256 {summary.projectCheckpointDigest}</p>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
      <div aria-live="polite" className="mt-4">
        <button type="button" onClick={() => void approve()} disabled={busy} className="btn-primary px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? 'Approving exact batch…' : `Approve ${summary.requestCount} ${batchLabel} generation${summary.requestCount === 1 ? '' : 's'} — estimated ${total}`}
        </button>
      </div>
    </section>
  );
}
