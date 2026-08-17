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
import { selectRuns } from '@/lib/run-state';
import type { InboxItem, FeedbackQuestion } from '@/app/(dashboard)/inbox/inbox-list';
import type { Recommendation } from '@/app/(dashboard)/_components/next-agent-cards';

// oneLine / humanize / the pure row→item mapper live in lib/inbox-items.ts
// (alias-free so node:test and the agent-detail envelope path can import them).
import { buildInboxItems, oneLine, humanize } from './inbox-items';

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
      extraColumns: 'feedback_questions, feedback_answers, feedback_at, steps_state, hold_kind',
    }),
    listWorkflows(),
  ]);

  const bySlug = new Map(catalog.map((c) => [c.slug, c]));

  // Next-agent recommendations (rec engine v1, RECOMMENDATION_ENGINE_PLAN §1.5).
  // Fetched in a SEPARATE query — NOT via selectRuns extraColumns — so a missing
  // skill_runs.recommendations column (42703) can never empty out the whole inbox;
  // it just yields no recommendations. (selectRuns' fallback also drops extraColumns,
  // so a not-yet-live column there would break the feed.)
  const recsById = new Map<string, Recommendation[]>();
  if (runs.length) {
    const { data: recRows } = await supabase
      .from('skill_runs')
      .select('id, recommendations')
      .in('id', runs.map((r) => r.id));
    for (const row of (recRows as { id: string; recommendations?: unknown }[] | null) ?? []) {
      if (Array.isArray(row.recommendations)) {
        recsById.set(row.id, row.recommendations as Recommendation[]);
      }
    }
  }

  // Implexa Judge verdicts for these runs. SEPARATE query for the same reason as
  // recommendations above: pre-0121/0124 the table or its columns may not exist,
  // and a missing-column error must cost the VERDICT only — never empty the inbox.
  // Newest-first so the map keeps the latest verdict per run.
  const judgmentByRun = new Map<string, NonNullable<InboxItem['judgment']>>();
  if (runs.length) {
    try {
      const { data: jRows } = await supabase
        .from('run_judgments')
        .select('id, run_id, verdict, summary, next_action, created_at')
        .in('run_id', runs.map((r) => r.id))
        .order('created_at', { ascending: false });
      for (const row of (jRows as { id: string; run_id: string; verdict: string; summary: string | null; next_action: string | null }[] | null) ?? []) {
        if (!judgmentByRun.has(row.run_id)) {
          judgmentByRun.set(row.run_id, {
            id: row.id,
            verdict: row.verdict as NonNullable<InboxItem['judgment']>['verdict'],
            summary: row.summary,
            next_action: row.next_action,
          });
        }
      }
    } catch { /* no verdicts rather than no inbox */ }
  }

  return buildInboxItems(
    runs,
    (slug2) => {
      const wf = bySlug.get(slug2);
      return { name: wf?.name || humanize(slug2), why: oneLine(wf?.primary_outcome) || oneLine(wf?.description) };
    },
    recsById,
    judgmentByRun,
  );
}
