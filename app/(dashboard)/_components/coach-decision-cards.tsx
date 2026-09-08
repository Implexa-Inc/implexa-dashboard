'use client';

/**
 * <CoachDecisionCards /> — confirm the proposed decisions (spec §1.2, §3.4, F0 item 6).
 *
 * Implexa proposes; the Coach decides. Every card carries the full §1.2 field set, its
 * source annotations and evidence digests, its scope and its proposed destination —
 * and four actions: accept, edit, merge, discard.
 *
 * ── WHAT THIS SURFACE REFUSES TO DO ──────────────────────────────────────────────
 *
 *  * IT DOES NOT HIDE A WEAK PROPOSAL. §3.4 requires an explicit `insufficient_evidence`
 *    when the recording cannot justify a claim, and a hidden one would let the Coach
 *    believe the recording said something it did not. So it renders with its own
 *    heading, and Accept is refused WITH THE REASON SHOWN rather than rendered as a
 *    dead button — the rule `lib/review-room-state.ts` already enforces next door.
 *
 *  * IT DOES NOT ACTIVATE ANYTHING. There is no Activate control here, disabled or
 *    otherwise. Confirming links an inert candidate; §1.3 keeps acceptance and
 *    activation separate, and F0 must not activate at all.
 *
 * All state transitions come from `lib/coach-decision-cards.ts`, which is pure, so the
 * rules are executable in tests rather than asserted by reading this JSX.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  DESTINATION_LABELS, FIELD_LABELS, FIELD_ORDER, SCOPE_LABELS,
  acceptBlockedReason, applyDecisionAction, confirmationSummary,
  type CoachDecisionCard, type DecisionAction, type DecisionContent,
} from '@/lib/coach-decision-cards';
import {
  INSUFFICIENT_EVIDENCE_BODY, INSUFFICIENT_EVIDENCE_HEADING,
} from '@/lib/training-review-copy';

export type CoachDecisionCardsProps = {
  cards: readonly CoachDecisionCard[];
  /**
   * Persist one confirmed disposition. Returns a refusal sentence, or null on success.
   * Supplied by the training room so this component performs no I/O of its own.
   */
  onConfirm?: (card: CoachDecisionCard, action: DecisionAction) => Promise<string | null>;
};

const DISPOSITION_LABEL = {
  proposed: 'Proposed',
  accepted: 'Confirmed',
  edited: 'Edited by you',
  merged: 'Merged',
  discarded: 'Discarded',
} as const;

export default function CoachDecisionCards({ cards: initial, onConfirm }: CoachDecisionCardsProps) {
  const [cards, setCards] = useState<readonly CoachDecisionCard[]>(initial);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const open = useMemo(
    () => cards.filter((card) => card.disposition === 'proposed' || card.disposition === 'edited'),
    [cards],
  );

  const run = useCallback(async (action: DecisionAction) => {
    const card = cards.find((entry) => entry.id === action.id);
    if (!card) { setRefusal('That decision is no longer on this submission.'); return; }
    const result = applyDecisionAction(cards, action);
    if (!result.ok) { setRefusal(result.refusal); return; }
    setRefusal(null);
    // Local state moves FIRST so an edit is never lost to a failed round-trip; a
    // persistence refusal is then shown next to the card rather than silently
    // reverting the Coach's words.
    setCards(result.cards);
    if (!onConfirm) return;
    setBusy(action.id);
    try {
      const error = await onConfirm(result.cards.find((entry) => entry.id === action.id)!, action);
      if (error) setRefusal(error);
    } finally {
      setBusy(null);
    }
  }, [cards, onConfirm]);

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
        <h2 className="text-[13px] font-medium text-ink-200">Confirm what you taught</h2>
        <p className="text-[12px] text-ink-500">{confirmationSummary(cards)}</p>
      </div>

      {refusal && (
        <p role="alert" className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[13px] text-amber-200">
          {refusal}
        </p>
      )}

      {cards.map((card) => {
        const blocked = acceptBlockedReason(card);
        const isEditing = editing === card.id;
        const terminal = card.disposition === 'discarded' || card.disposition === 'merged';
        return (
          <article
            key={card.id}
            data-decision-id={card.id}
            data-disposition={card.disposition}
            data-insufficient-evidence={card.insufficientEvidence ? 'true' : 'false'}
            className={`rounded-md border px-3 py-2.5 ${
              card.insufficientEvidence
                ? 'border-amber-900/60 bg-amber-950/10'
                : 'border-ink-800 bg-ink-950/50'
            } ${terminal ? 'opacity-60' : ''}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] uppercase tracking-wide text-ink-500">
                {DISPOSITION_LABEL[card.disposition]}
              </span>
              <span className="text-[12px] text-ink-500">
                {DESTINATION_LABELS[card.destination]}
              </span>
            </div>

            {card.insufficientEvidence && (
              <div className="mt-2 rounded border border-amber-900/50 bg-amber-950/20 px-2 py-1.5">
                <p className="text-[13px] font-medium text-amber-200">{INSUFFICIENT_EVIDENCE_HEADING}</p>
                <p className="mt-0.5 text-[13px] text-ink-400">{INSUFFICIENT_EVIDENCE_BODY}</p>
              </div>
            )}

            {isEditing ? (
              <EditForm
                card={card}
                onCancel={() => setEditing(null)}
                onSave={async (content) => { setEditing(null); await run({ type: 'edit', id: card.id, content }); }}
              />
            ) : (
              <dl className="mt-2 space-y-1.5">
                {FIELD_ORDER.map((field) => {
                  const raw = card.content[field];
                  const value = field === 'scope' ? SCOPE_LABELS[card.content.scope] : (raw as string | null);
                  return (
                    <div key={field} data-field={field}>
                      <dt className="text-[12px] text-ink-500">{FIELD_LABELS[field]}</dt>
                      <dd className="text-[13px] text-ink-300">
                        {value && String(value).trim()
                          ? value
                          : <span className="text-ink-600">Not stated.</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}

            <p className="mt-2 text-[12px] text-ink-500">
              {card.evidence.annotationIds.length
                ? `${card.evidence.annotationIds.length} moment${card.evidence.annotationIds.length === 1 ? '' : 's'} from your recording`
                : 'No moment from the recording'}
              {card.evidence.evidenceDigests.length
                ? ` · ${card.evidence.evidenceDigests.length} evidence digest${card.evidence.evidenceDigests.length === 1 ? '' : 's'}`
                : ''}
              {card.confidence === null ? '' : ` · Implexa's confidence ${Math.round(card.confidence * 100)}%`}
              {card.affectedStep ? ` · step ${card.affectedStep}` : ''}
            </p>
            {card.mergedIntoId && (
              <p className="mt-1 text-[12px] text-ink-500">Merged into {card.mergedIntoId.slice(0, 8)}…</p>
            )}

            {!terminal && !isEditing && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!!blocked || busy === card.id}
                  onClick={() => { void run({ type: 'accept', id: card.id }); }}
                  className="rounded border border-ink-700 px-2 py-1 text-[13px] text-ink-200 disabled:opacity-40"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(card.id)}
                  className="rounded border border-ink-700 px-2 py-1 text-[13px] text-ink-200"
                >
                  Edit
                </button>
                {open.length > 1 && (
                  <label className="text-[13px] text-ink-400">
                    <span className="sr-only">Merge this decision into another</span>
                    <select
                      aria-label={`Merge ${card.id} into`}
                      value=""
                      onChange={(e) => {
                        const intoId = e.currentTarget.value;
                        if (intoId) void run({ type: 'merge', id: card.id, intoId });
                      }}
                      className="rounded border border-ink-700 bg-ink-950 px-2 py-1 text-[13px] text-ink-200"
                    >
                      <option value="">Merge into…</option>
                      {open.filter((other) => other.id !== card.id).map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.content.trigger.trim() || `Decision ${other.id.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => { void run({ type: 'discard', id: card.id }); }}
                  className="rounded border border-ink-800 px-2 py-1 text-[13px] text-ink-400"
                >
                  Discard
                </button>
                {/* The reason is SHOWN. A disabled button with no explanation is how a
                    user concludes the product is broken rather than that they have
                    something left to write. */}
                {blocked && <span className="text-[12px] text-amber-300">{blocked}</span>}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function EditForm({ card, onSave, onCancel }: {
  card: CoachDecisionCard;
  onSave: (content: Partial<DecisionContent>) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DecisionContent>(card.content);
  return (
    <div className="mt-2 space-y-2">
      {FIELD_ORDER.filter((field) => field !== 'scope').map((field) => (
        <label key={field} className="block">
          <span className="block text-[12px] text-ink-500">{FIELD_LABELS[field]}</span>
          <textarea
            aria-label={FIELD_LABELS[field]}
            rows={2}
            value={(draft[field] as string | null) ?? ''}
            onChange={(e) => setDraft((current) => ({ ...current, [field]: e.currentTarget.value }))}
            className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-[13px] text-ink-200"
          />
        </label>
      ))}
      <label className="block">
        <span className="block text-[12px] text-ink-500">{FIELD_LABELS.scope}</span>
        <select
          aria-label={FIELD_LABELS.scope}
          value={draft.scope}
          onChange={(e) => setDraft((current) => ({ ...current, scope: e.currentTarget.value as DecisionContent['scope'] }))}
          className="rounded border border-ink-700 bg-ink-950 px-2 py-1 text-[13px] text-ink-200"
        >
          {(Object.keys(SCOPE_LABELS) as (keyof typeof SCOPE_LABELS)[]).map((scope) => (
            <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { void onSave(draft); }}
          className="rounded border border-ink-700 px-2 py-1 text-[13px] text-ink-200"
        >
          Save your wording
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-ink-800 px-2 py-1 text-[13px] text-ink-400">
          Cancel
        </button>
      </div>
    </div>
  );
}
