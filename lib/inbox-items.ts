/**
 * lib/inbox-items.ts — the PURE half of lib/inbox.ts.
 *
 * buildInboxItems maps raw skill_runs rows (+ per-run recommendations and
 * judge verdicts) to InboxItems. Shared by loadInboxItems (catalog-backed
 * names) and the agent-detail envelope path (one workflow, so the name/why
 * come from the envelope's own workflow section). Keeping ONE mapper is what
 * keeps the Runs tab's resolver-row filter, hold-kind gating, and state
 * derivation identical no matter which read supplied the rows.
 *
 * Alias-free and side-effect-free on purpose (type-only imports of the
 * component types): node:test can import this file directly.
 */

import { deriveRunState, type RunRow } from './run-state.ts';
import type { InboxItem, FeedbackQuestion } from '../app/(dashboard)/inbox/inbox-list';
import type { Recommendation } from '../app/(dashboard)/_components/next-agent-cards';

/** Tighten a workflow description into a single plain-english line. */
export function oneLine(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0] || trimmed;
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157).trimEnd()}…` : firstSentence;
}

/** Humanize a slug as a last-resort name so we never render a bare slug alone. */
export function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildInboxItems(
  runs: RunRow[],
  metaFor: (slug: string) => { name: string; why: string | null },
  recsById: Map<string, Recommendation[]>,
  judgmentByRun: Map<string, NonNullable<InboxItem['judgment']>>,
): InboxItem[] {
  return runs
    // Drop "resolver" rows — bookkeeping placeholders run_agent_now opens during a
    // continue while the real deliverable records on the linked continuation run.
    // They self-describe ("Resolver row opened … No separate action needed here")
    // and must not show as their own todo. (Filter in JS, not a NOT-ILIKE query,
    // which would also drop legitimate null-output rows.)
    .filter((r) => !((r as { output_markdown?: string | null }).output_markdown || '').startsWith('Resolver row opened'))
    .map((r) => {
    const meta = metaFor(r.skill_slug);
    return {
      id:              r.id,
      slug:            r.skill_slug,
      source:          (r as { source?: string | null }).source || 'scheduled',
      name:            meta.name,
      why:             meta.why,
      output_markdown: (r as { output_markdown?: string | null }).output_markdown ?? null,
      ran_at:          (r as { ran_at: string }).ran_at,
      pending:         (r as { review_status?: string | null }).review_status === 'pending',
      stepsState:      Array.isArray((r as { steps_state?: unknown }).steps_state) ? (r as { steps_state?: InboxItem['stepsState'] }).steps_state ?? null : null,
      holdKind:        (() => {
        const hk = (r as { hold_kind?: string | null }).hold_kind;
        return hk === 'approval_before_action' || hk === 'review_delivered_result' || hk === 'needs_input' ? hk : null;
      })(),
      state:           deriveRunState(r),
      verification:    ((r as { verification_status?: string | null }).verification_status ?? null) as InboxItem['verification'],
      feedbackQuestions: (r as { feedback_questions?: FeedbackQuestion[] | null }).feedback_questions ?? null,
      feedbackAnswers:   (r as { feedback_answers?: Record<string, string> | null }).feedback_answers ?? null,
      feedbackAt:        (r as { feedback_at?: string | null }).feedback_at ?? null,
      recommendations:   recsById.get(r.id) ?? null,
      judgment:          judgmentByRun.get(r.id) ?? null,
    } satisfies InboxItem;
  });
}
