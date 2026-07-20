/**
 * /scheduled — manage the user's scheduled skill manifest.
 *
 * Server-rendered list of scheduled_skills (RLS-scoped to caller).
 * Per-row pause / resume / delete actions are handled by the
 * <ScheduleRow /> client component (it talks to /api/v2/scheduled-skills
 * via fetch).
 *
 * Empty state nudges the user to invoke /implexa:schedule from Claude Code.
 */

import { type TriggerType, isOnDemandRoutine } from '@/lib/schedule-trigger';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { listWorkflows } from '@/lib/workflow-catalog';
import { remoteSafetyFromCard, type RemoteSafety } from '@/lib/remote-safety';
import ScheduleRow from './schedule-row';

export const dynamic = 'force-dynamic';

// What a routine row needs to know about the workflow it runs (when its slug
// matches the catalog): which catalog source to deep-link, and the coarse
// remote-safe verdict for the row badge. The precise verdict lives on the
// workflow detail page.
type RoutineWorkflow = { source: string; safety: RemoteSafety };

type ScheduledSkill = {
  id:               string;
  skill_id:         string;
  skill_slug:       string;
  schedule_nl:      string;
  cron_expression:  string | null;
  trigger_type?:    TriggerType;
  watch_condition?: { watch?: string; until?: string } | null;
  timezone:         string;
  destination:      { type: 'dashboard' | 'slack-webhook' | 'slack-plugin' | 'email'; target?: string };
  post_run_action:  { type: string; repo?: string; script?: string } | null;
  status:           'active' | 'paused' | 'failed';
  last_run_at:      string | null;
  next_run_at:      string | null;
  run_count:        number;
  created_at:       string;
};

export default async function ScheduledPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // RLS scopes to caller. include all statuses so user can resume paused ones.
  // The workflow catalog read is the public path (the catalog is service-role
  // RLS); it tells us which routines run a workflow and lets the row deep-link
  // to /workflows + show the remote-safe verdict.
  const [{ data: schedules }, catalog] = await Promise.all([
    supabase
      .from('scheduled_skills')
      .select('id, skill_id, skill_slug, schedule_nl, cron_expression, trigger_type, watch_condition, timezone, destination, post_run_action, status, last_run_at, next_run_at, run_count, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    listWorkflows(),
  ]);

  // on_demand rows are activation artifacts with no clock and no loop — nothing
  // ever fires. This page is titled "Routines … runs a workflow on a schedule", so
  // listing them here presents an agent as autopilot when it is not. Same lie the
  // agent page told with its Pause button.
  const items: ScheduledSkill[] = ((schedules as ScheduledSkill[]) || []).filter((r) => !isOnDemandRoutine(r));
  const workflowBySlug = new Map<string, RoutineWorkflow>(
    catalog.map((c) => [c.slug, { source: c.source, safety: remoteSafetyFromCard(c) }]),
  );

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Routines</h1>
          <p className="text-ink-300 text-sm mt-1">
            Your autopilot. Each routine runs a workflow on a schedule, then delivers the result.
            Registered via{' '}
            <code className="bg-ink-900 px-1.5 py-0.5 rounded text-brand-400">/implexa:schedule</code>;
            output lands in <Link href="/runs" className="text-brand-500 hover:underline">Runs</Link>{' '}
            and (optionally) Slack.
          </p>
        </header>

        {items.length === 0 && (
          <section className="card text-sm text-ink-300">
            <p className="mb-3">No scheduled skills yet.</p>
            <p>
              From Claude Code, invoke{' '}
              <code className="bg-ink-900 px-1.5 py-0.5 rounded text-brand-400">/implexa:schedule</code>{' '}
              followed by a skill slug and a natural-language schedule, e.g.:
            </p>
            <pre className="mt-3 bg-ink-900 border border-ink-800 rounded-lg p-3 text-xs overflow-x-auto">
{`/implexa:schedule daily-ai-skills-pulse "daily at 8:55am"
/implexa:schedule standup-from-yesterday-commits "every weekday at 9am" to slack`}
            </pre>
          </section>
        )}

        {items.length > 0 && (
          <ul className="space-y-3">
            {items.map((s) => (
              <ScheduleRow key={s.id} schedule={s} workflow={workflowBySlug.get(s.skill_slug) || null} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
