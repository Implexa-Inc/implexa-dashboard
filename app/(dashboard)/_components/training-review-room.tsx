'use client';

/**
 * <TrainingReviewRoom /> — Review Room's surface, Training Review's authority.
 *
 * SPEC §3.3 (Training Review is not Run Review), §2.4 (honest privacy copy),
 * §5 F0 items 5, 6 and 8.
 *
 * ── WHAT THIS ROOM CAN AND CANNOT WRITE ──────────────────────────────────────────
 *
 * It holds a `TrainingReviewWritePath`, derived from a `training_source` subject. Every
 * write it makes goes through `lib/training-review-client.ts`, which seals each request
 * against that path — so each one carries a training identity and a training action
 * name, is posted to `/api/training-review`, and is resolved by an allowlist that can
 * emit no path outside `/api/v2/agents/training/`.
 *
 * There is no `runId` in this file. Not undefined — absent. A demonstration precedes a
 * revision and may exist before any run, so there is nothing to name, and §8 forbids
 * inventing a synthetic one to make run-bound tables accept training.
 *
 * ── WHAT IS DELIBERATELY NOT HERE (F0 must-nots) ─────────────────────────────────
 *
 * No Start recording. No screen or microphone permission prompt. No Run. No Activate.
 * Not as disabled controls — absent, because a disabled Activate button is still a
 * promise about what this foundation does.
 */

import { useCallback, useMemo, useState } from 'react';
import CoachDecisionCards from './coach-decision-cards';
import TrainingAuthorityProjection from './training-authority-projection';
import { reviewSubjectLabel, writePathFor, type TrainingSourceSubject } from '@/lib/review-subject';
import {
  confirmTrainingDecision, fetchTransport, type TrainingTransport,
} from '@/lib/training-review-client';
import type { CoachDecisionCard, DecisionAction } from '@/lib/coach-decision-cards';
import type { TrainingProjectionStatus } from '@/lib/training-review-projection';
import {
  COACH_STEPS,
  EVIDENCE_PREVIEW_NOTICE, NO_RECORDING_UPLOAD_NOTICE,
  PRIVACY_PROMISE, PRIVACY_QUALIFIER, PRIVACY_SCOPE_NOTICE,
} from '@/lib/training-review-copy';

export type TrainingReviewRoomProps = {
  subject: TrainingSourceSubject;
  agentName: string;
  /** The read-only record (F0 item 8), read server-side or by the caller. */
  projection: TrainingProjectionStatus;
  /** The frozen submission these decisions were compiled from, when there is one. */
  submissionId?: string | null;
  /** Test seam. Production uses the default fetch transport; nothing else may fetch. */
  transport?: TrainingTransport;
};

/**
 * §2.4, in full and unedited.
 *
 * The promise and its qualifier are shown TOGETHER, always. "The full recording stays
 * on this Mac" on its own reads as "nothing is uploaded", which is not true — selected
 * moments are — and §2.4 requires the product to say exactly what does travel.
 */
function PrivacyPanel({ custodyLine }: { custodyLine: string }) {
  return (
    <section
      className="rounded-md border border-ink-800 bg-ink-950/50 px-3 py-2.5"
      aria-label="What Implexa keeps"
    >
      <h2 className="text-[13px] font-medium text-ink-200">What Implexa keeps</h2>
      <p className="mt-1.5 text-[13px] text-ink-300">{PRIVACY_PROMISE}</p>
      <p className="mt-1.5 text-[13px] text-ink-400">{PRIVACY_QUALIFIER}</p>
      <ul className="mt-1.5 space-y-1 text-[13px] text-ink-400">
        <li>{EVIDENCE_PREVIEW_NOTICE}</li>
        <li>{PRIVACY_SCOPE_NOTICE}</li>
        <li>{custodyLine}</li>
      </ul>
    </section>
  );
}

export default function TrainingReviewRoom(props: TrainingReviewRoomProps) {
  const { subject, agentName, projection, submissionId = null, transport = fetchTransport } = props;

  // The discriminant selects the write path once, here. Everything below writes
  // through it, and it can only ever be the training one.
  const path = useMemo(() => writePathFor(subject), [subject]);

  const [persistError, setPersistError] = useState<string | null>(null);

  const decisions: readonly CoachDecisionCard[] = projection.live ? projection.projection.decisions : [];

  const custodyLine = projection.live && projection.projection.source?.custody === 'evidence_selected'
    ? 'Selected moments have been saved to your private Agent history.'
    : NO_RECORDING_UPLOAD_NOTICE;

  const onConfirm = useCallback(async (card: CoachDecisionCard, action: DecisionAction): Promise<string | null> => {
    if (!submissionId) {
      return 'These decisions are not attached to a frozen submission yet, so nothing was saved.';
    }
    const disposition = action.type === 'accept' ? 'accepted'
      : action.type === 'edit' ? 'edited'
      : action.type === 'merge' ? 'merged'
      : 'discarded';
    const result = await confirmTrainingDecision(path, {
      submissionId,
      decisionId: card.id,
      disposition,
      ...(action.type === 'merge' ? { mergedIntoDecisionId: action.intoId } : {}),
      ...(action.type === 'edit' ? { edits: card.content } : {}),
    }, transport);
    if (result.ok) { setPersistError(null); return null; }
    setPersistError(result.error);
    return result.error;
  }, [path, submissionId, transport]);

  return (
    <div className="space-y-4" data-review-authority={path.authority} data-review-subject-kind={subject.kind}>
      <header>
        <p className="text-[12px] uppercase tracking-wide text-ink-500">{reviewSubjectLabel(subject)}</p>
        <h1 className="text-[15px] font-medium text-ink-100">Teaching {agentName}</h1>
        {/* §2.3: the customer's five steps, in the customer's words. No recovery
            locators, fencing epochs or evidence-repair packets appear anywhere. */}
        <ol className="mt-1.5 flex flex-wrap gap-1.5 text-[12px] text-ink-500" aria-label="Coaching steps">
          {COACH_STEPS.map((step, index) => (
            <li key={step}>{index > 0 && <span aria-hidden="true">→ </span>}{step}</li>
          ))}
        </ol>
      </header>

      <PrivacyPanel custodyLine={custodyLine} />

      {persistError && (
        <p role="alert" className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[13px] text-amber-200">
          {persistError}
        </p>
      )}

      <CoachDecisionCards cards={decisions} onConfirm={onConfirm} />

      <TrainingAuthorityProjection status={projection} />
    </div>
  );
}
