'use client';

/**
 * <CoachDecisionCards /> — decide the proposed decisions (spec §1.2, §3.4, F0 items 6, 7).
 *
 * Implexa proposes; the Coach decides. Every card carries the §1.2 field set as the
 * backend returns it, its source annotations and evidence digests, where it would apply
 * and the compiler's confidence — and exactly TWO actions, because the wire has exactly
 * two: Confirm and Discard.
 *
 * ── WHAT THIS SURFACE REFUSES TO DO ──────────────────────────────────────────────
 *
 *  * IT DOES NOT HIDE A WEAK PROPOSAL. §3.4 requires an explicit `insufficient_evidence`
 *    when the recording cannot justify a claim, and a hidden one would let the Coach
 *    believe the recording said something it did not. So it renders with its own
 *    heading, and Confirm is refused WITH THE REASON SHOWN rather than rendered as a
 *    dead button — the rule `lib/review-room-state.ts` already enforces next door. The
 *    server refuses the same thing as `insufficient_evidence_not_confirmable`, in the
 *    same words.
 *
 *  * IT DOES NOT OFFER AN EDIT OR A MERGE. Neither exists on the wire. A control that
 *    rearranged cards on screen and stored nothing would be a control that lies by
 *    appearing to work.
 *
 *  * IT DOES NOT ACTIVATE ANYTHING, AND DOES NOT IMPLY IT WILL. There is no Activate
 *    control here, disabled or otherwise. A confirmed card renders as "confirmed, not
 *    yet a learning" with the server's own inert note, because the backend records
 *    `mint_deferred` rather than minting a canonical learning candidate: that needs
 *    supporting evidence from real runs, which a demonstration does not have.
 *
 * All rules come from `lib/coach-decision-cards.ts`, which is pure, so they are
 * executable in tests rather than asserted by reading this JSX.
 */

import { useCallback, useState } from 'react';
import {
  CONFIDENCE_LABELS, FIELD_LABELS, FIELD_ORDER, SCOPE_LABELS,
  confirmBlockedReason, confirmationSummary, discardBlockedReason,
  isInsufficientEvidence, learningStanding, standingSentence,
  type CoachDecisionCard, type DecisionAction,
} from '@/lib/coach-decision-cards';
import {
  DECISIONS_HEADING,
  INSUFFICIENT_EVIDENCE_BODY, INSUFFICIENT_EVIDENCE_HEADING,
} from '@/lib/training-review-copy';

export type CoachDecisionCardsProps = {
  cards: readonly CoachDecisionCard[];
  /**
   * Persist one decision. Returns a refusal sentence, or null on success. Supplied by
   * the training room so this component performs no I/O of its own.
   *
   * THE SERVER IS THE ONLY AUTHORITY ON THE RESULT. There is no optimistic local status
   * change here: a card moves to "confirmed" because a read said so, never because a
   * click did. Optimism would let a refused confirmation still read as confirmed.
   */
  onDecide?: (card: CoachDecisionCard, action: DecisionAction) => Promise<string | null>;
};

const STATUS_LABEL = {
  proposed: 'Proposed',
  confirmed: 'Confirmed',
  discarded: 'Discarded',
} as const;

export default function CoachDecisionCards({ cards, onDecide }: CoachDecisionCardsProps) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(async (card: CoachDecisionCard, action: DecisionAction) => {
    const blocked = action.type === 'confirm' ? confirmBlockedReason(card) : discardBlockedReason(card);
    if (blocked) { setRefusal(blocked); return; }
    setRefusal(null);
    if (!onDecide) return;
    setBusy(card.proposalId);
    try {
      const error = await onDecide(card, action);
      if (error) setRefusal(error);
    } finally {
      setBusy(null);
    }
  }, [onDecide]);

  if (!cards.length) {
    return (
      <section className="rounded-md border border-ink-800 bg-ink-950/50 px-3 py-2.5" aria-label="Proposed decisions">
        <p className="text-[13px] text-ink-400">
          No decisions have been proposed from this recording yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-label="Proposed decisions">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-medium text-ink-200">{DECISIONS_HEADING}</h2>
        <p className="text-[12px] text-ink-500">{confirmationSummary(cards)}</p>
      </div>

      {refusal && (
        <p role="alert" className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[13px] text-amber-200">
          {refusal}
        </p>
      )}

      {cards.map((card) => {
        const blocked = confirmBlockedReason(card);
        const weak = isInsufficientEvidence(card);
        const standing = learningStanding(card);
        const decided = card.status !== 'proposed';
        return (
          <article
            key={card.proposalId}
            data-decision-id={card.proposalId}
            data-decision-status={card.status}
            data-canonical-link-state={card.canonicalLinkState}
            data-influence-state={card.influenceState}
            data-learning-standing={standing}
            data-insufficient-evidence={weak ? 'true' : 'false'}
            className={`rounded-md border px-3 py-2.5 ${
              weak ? 'border-amber-900/60 bg-amber-950/10' : 'border-ink-800 bg-ink-950/50'
            } ${card.status === 'discarded' ? 'opacity-60' : ''}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] uppercase tracking-wide text-ink-500">
                {STATUS_LABEL[card.status]}
              </span>
              <span className="text-[12px] text-ink-500">
                {card.proposedScope ? SCOPE_LABELS[card.proposedScope] : 'Nowhere yet'}
              </span>
            </div>

            {weak && (
              <div className="mt-2 rounded border border-amber-900/50 bg-amber-950/20 px-2 py-1.5">
                <p className="text-[13px] font-medium text-amber-200">{INSUFFICIENT_EVIDENCE_HEADING}</p>
                <p className="mt-0.5 text-[13px] text-ink-400">
                  {card.insufficientEvidenceReason ?? INSUFFICIENT_EVIDENCE_BODY}
                </p>
                {card.kindNote && <p className="mt-0.5 text-[12px] text-ink-500">{card.kindNote}</p>}
              </div>
            )}

            <dl className="mt-2 space-y-1.5">
              {FIELD_ORDER.map((field) => (
                <div key={field} data-field={field}>
                  <dt className="text-[12px] text-ink-500">{FIELD_LABELS[field]}</dt>
                  <dd className="text-[13px] text-ink-300">
                    {card.content[field] ?? <span className="text-ink-600">Not stated.</span>}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-2 text-[12px] text-ink-500">
              {card.sourceAnnotationIds.length
                ? `${card.sourceAnnotationIds.length} moment${card.sourceAnnotationIds.length === 1 ? '' : 's'} from your recording`
                : 'No moment from the recording'}
              {card.evidenceDigests.length
                ? ` · ${card.evidenceDigests.length} evidence digest${card.evidenceDigests.length === 1 ? '' : 's'}`
                : ''}
              {card.confidence ? ` · ${CONFIDENCE_LABELS[card.confidence]}` : ''}
              {card.affectedStepIndex === null ? '' : ` · step ${card.affectedStepIndex}`}
              {card.affectedCapabilityIdentity ? ` · ${card.affectedCapabilityIdentity}` : ''}
            </p>

            {/* WHAT THIS HAS AND HAS NOT CHANGED. Rendered on EVERY card, decided or
                not, because the one question a Coach will ask of this screen is whether
                any of it taught the Agent anything — and the honest answer here is
                always no. */}
            <p className="mt-1.5 text-[12px] text-ink-400" data-standing-sentence={standing}>
              {standingSentence(card)}
            </p>

            {!decided && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!!blocked || busy === card.proposalId}
                  onClick={() => { void run(card, { type: 'confirm', proposalId: card.proposalId }); }}
                  className="rounded border border-ink-700 px-2 py-1 text-[13px] text-ink-200 disabled:opacity-40"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={busy === card.proposalId}
                  onClick={() => { void run(card, { type: 'discard', proposalId: card.proposalId }); }}
                  className="rounded border border-ink-800 px-2 py-1 text-[13px] text-ink-400 disabled:opacity-40"
                >
                  Discard
                </button>
                {/* The reason is SHOWN. A disabled button with no explanation is how a
                    user concludes the product is broken rather than that the recording
                    did not justify the claim. */}
                {blocked && <span className="text-[12px] text-amber-300">{blocked}</span>}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
