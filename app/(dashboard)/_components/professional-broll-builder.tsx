'use client';

/**
 * <ProfessionalBrollBuilder /> — the Professional (multi-moment) lane.
 *
 * THE ORDER OF OPERATIONS IS THE PRODUCT:
 *
 *   edit → preview → (create) → approve, on a different screen
 *
 * Preview costs nothing and writes nothing; it is how the real compiled plan and
 * the real ceiling become visible before anything is durable. Create writes a
 * row and nothing else. Approval — the only step that commits money — never
 * happens here.
 *
 * EDITING AFTER A PREVIEW DESTROYS THE PREVIEW. Not greys it out, not marks it
 * stale: removes it, along with the identity it carried. A cost and an approval
 * identity left on screen beside a timeline that has since changed is the exact
 * shape of authorizing something you did not read.
 *
 * WHEN PROFESSIONAL IS UNAVAILABLE — which it is today, because the server
 * capability flags are false — the plan still compiles and is still shown, with
 * the backend's own list of what is missing. What is NOT offered is approval.
 * That is the honest disposition, and it is not softened here to make anything
 * convenient.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ProfessionalTimelineEditor from './professional-timeline-editor';
import ProfessionalCostSummary from './professional-cost-summary';
import { capabilityWords } from '@/lib/quality-mode';
import {
  newMoment, timelineFingerprint, validateTimeline, type TimelineMoment,
} from '@/lib/professional-v2-timeline';
import {
  parseProfessionalV2CreateResponse, parseProfessionalV2PreviewResponse,
  professionalEntryError, reconcileProposal,
} from '@/lib/professional-v2-entry';
import type { CompiledProfessionalV2Proposal } from '@/lib/generation-proposal-v2';

type Props = { runId: string; agentSubject: string };

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number | null; body: unknown }> {
  try {
    // The authenticated Dashboard proxy. The user's Supabase session never
    // leaves the server: this route reads it from the cookie session and
    // attaches it upstream. No token is held or sent from this component.
    const res = await fetch('/api/generation-proposals', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: null, body: { unavailable: true } };
  }
}

export default function ProfessionalBrollBuilder({ runId, agentSubject }: Props) {
  const router = useRouter();
  const createFlight = useRef(false);
  const [moments, setMoments] = useState<TimelineMoment[]>([newMoment(1, 0)]);
  const [preview, setPreview] = useState<CompiledProfessionalV2Proposal | null>(null);
  // The timeline the preview was compiled FOR. Approval identity in miniature:
  // if the live fingerprint moves away from this, the preview is not about the
  // plan on screen any more.
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [phase, setPhase] = useState<'editing' | 'previewing' | 'creating'>('editing');
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => validateTimeline(moments), [moments]);
  const fingerprint = useMemo(() => timelineFingerprint(moments), [moments]);
  const previewIsCurrent = preview !== null && previewFingerprint === fingerprint;

  const edit = useCallback((next: TimelineMoment[]) => {
    setMoments(next);
    // INVALIDATE. The compiled plan, its cost and its identity all described the
    // previous timeline.
    setPreview(null);
    setPreviewFingerprint(null);
    setError(null);
    createFlight.current = false;
  }, []);

  const onPreview = useCallback(async () => {
    if (!validation.ok) { setError('Fix the issues above before previewing.'); return; }
    setPhase('previewing'); setError(null); setPreview(null); setPreviewFingerprint(null);
    const submitted = moments;
    const submittedFingerprint = timelineFingerprint(submitted);
    const result = await post({
      action: 'preview-professional-v2', agentSubject, sourceRunId: runId, moments: submitted,
    });
    setPhase('editing');
    if (!result.ok) { setError(professionalEntryError(result.ok, result.body, 'preview', result.status)); return; }
    const compiled = parseProfessionalV2PreviewResponse(result.body, {
      agentSubject, sourceRunId: runId, moments: submitted,
    });
    if (!compiled) {
      setError('Implexa compiled something this build could not verify against the timeline you submitted, so it refused to show it. Nothing was created.');
      return;
    }
    const reconciled = reconcileProposal(submitted, compiled);
    if (!reconciled.ok) {
      // FAIL CLOSED. Not "prefer the backend's number" — a disagreement means the
      // plan that was priced is not the plan that was sent.
      setError(`Implexa's compiled plan does not match this timeline, so it cannot be used. ${reconciled.reason}`);
      return;
    }
    setPreview(compiled);
    setPreviewFingerprint(submittedFingerprint);
  }, [agentSubject, moments, runId, validation.ok]);

  const onCreate = useCallback(async () => {
    if (createFlight.current || !previewIsCurrent || !preview) return;
    createFlight.current = true;
    setPhase('creating'); setError(null);
    const submitted = moments;
    const result = await post({
      action: 'create-professional-v2', agentSubject, sourceRunId: runId, moments: submitted,
    });
    if (!result.ok) {
      createFlight.current = false;
      setPhase('editing');
      setError(professionalEntryError(result.ok, result.body, 'create', result.status));
      return;
    }
    const created = parseProfessionalV2CreateResponse(result.body, {
      agentSubject, sourceRunId: runId, moments: submitted,
    });
    if (!created) {
      createFlight.current = false;
      setPhase('editing');
      setError('The proposal was created with an identity or plan this build could not verify, so Implexa refused to open it. Reload this run before trying again.');
      return;
    }
    router.push(`/generations/${encodeURIComponent(created.proposalId)}`);
  }, [agentSubject, moments, preview, previewIsCurrent, router, runId]);

  const busy = phase !== 'editing';
  const unavailable = preview !== null && preview.availability !== true;

  return (
    <div className="space-y-4">
      <ProfessionalTimelineEditor moments={moments} onChange={edit} disabled={busy} />

      {/* Before a preview the figures are a labelled local estimate; after one
          they are the backend's compiled numbers. The component says which. */}
      {previewIsCurrent && preview ? (
        <ProfessionalCostSummary
          source="backend-compiled"
          cost={{
            expectedCredits: preview.initialCredits,
            repairReserveCredits: preview.repairReserveCredits,
            maximumCredits: preview.maximumCredits,
            variantTaskCount: preview.candidateTaskCount,
            repairTaskCount: preview.repairTaskCount,
            totalTaskCount: preview.taskCount,
            coverageMomentCount: preview.momentCount,
          }}
        />
      ) : validation.cost ? (
        <ProfessionalCostSummary source="local-estimate" cost={validation.cost} />
      ) : null}

      {unavailable && preview && (
        <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-medium">Professional generation is not available on your account yet.</p>
          <p className="mt-1 text-xs">
            Implexa compiled this plan so you can see exactly what it would run, but it cannot be
            approved and nothing will be generated. Missing:{' '}
            {preview.requiredMissingCapabilities.map(capabilityWords).join(', ')}.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button" onClick={onPreview} disabled={busy || !validation.ok}
          className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
        >
          {phase === 'previewing' ? 'Compiling plan…' : previewIsCurrent ? 'Re-compile plan' : 'Compile plan'}
        </button>
        {previewIsCurrent && preview && (
          <button
            type="button" onClick={onCreate} disabled={busy}
            className="rounded-md border border-ink-700 px-4 py-2 text-sm text-ink-200 disabled:opacity-50"
          >
            {phase === 'creating'
              ? 'Saving…'
              : unavailable ? 'Save this plan without approving' : 'Save this plan for approval'}
          </button>
        )}
        {preview !== null && !previewIsCurrent && (
          <p className="text-xs text-amber-300">
            The timeline changed since it was compiled. Compile it again before saving —
            the previous plan and its ceiling no longer describe what is on screen.
          </p>
        )}
      </div>

      <p className="text-[11px] leading-snug text-ink-500">
        Compiling and saving never generate anything and never spend credits. Generation
        starts only from a separate approval of a saved plan, on that plan&apos;s own screen.
      </p>
    </div>
  );
}
