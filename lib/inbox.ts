/**
 * lib/inbox.ts , the single loader for the Home todo (and the legacy /inbox).
 *
 * The "one todo inbox" is the spine of the 2-section redesign: Home shows every
 * run as a colored todo (red = take action, amber = give feedback, green = done)
 * and each row's next action happens in a pop-up. Both Home (/overview) and the
 * still-live /inbox route render the SAME list from this one loader, so there is
 * a single source of truth for what "needs you".
 *
 * RLS-scoped to the caller via the passed server Supabase client. Reads the live
 * run-state columns (migration 0065) when present and the improvement-loop
 * feedback columns (migration 0074); both degrade cleanly when absent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { listWorkflows } from '@/lib/workflow-catalog';
import { selectRuns, deriveRunState } from '@/lib/run-state';
import type { InboxItem, FeedbackQuestion } from '@/app/(dashboard)/inbox/inbox-list';

// Tighten a workflow description into a single plain-english line. Catalog
// descriptions can be a few sentences; the inbox only needs the lead clause.
function oneLine(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0] || trimmed;
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157).trimEnd()}…` : firstSentence;
}

// Humanize a slug as a last-resort name so we never render a bare slug alone.
function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * loadInboxItems , the recent deliverables for the caller as todo items,
 * newest first. `limit` bounds the window (Home and /inbox both use 40).
 * `slug` scopes to one agent's runs (the agent page's Runs tab).
 */
export async function loadInboxItems(
  supabase: SupabaseClient,
  limit = 40,
  slug?: string,
): Promise<InboxItem[]> {
  const [runs, catalog] = await Promise.all([
    selectRuns(supabase, {
      limit,
      onlyWithOutput: true,
      slug,
      // The improvement-loop columns: the run's own feedback questions + the
      // user's answers, so each result can show one-tap feedback (migration 0074).
      extraColumns: 'feedback_questions, feedback_answers, feedback_at',
    }),
    listWorkflows(),
  ]);

  const bySlug = new Map(catalog.map((c) => [c.slug, c]));

  return runs.map((r) => {
    const wf = bySlug.get(r.skill_slug);
    return {
      id:              r.id,
      slug:            r.skill_slug,
      source:          r.source || 'scheduled',
      name:            wf?.name || humanize(r.skill_slug),
      why:             oneLine(wf?.primary_outcome) || oneLine(wf?.description),
      output_markdown: r.output_markdown ?? null,
      ran_at:          r.ran_at,
      pending:         r.review_status === 'pending',
      state:           deriveRunState(r),
      feedbackQuestions: (r as { feedback_questions?: FeedbackQuestion[] | null }).feedback_questions ?? null,
      feedbackAnswers:   (r as { feedback_answers?: Record<string, string> | null }).feedback_answers ?? null,
      feedbackAt:        (r as { feedback_at?: string | null }).feedback_at ?? null,
    } satisfies InboxItem;
  });
}
