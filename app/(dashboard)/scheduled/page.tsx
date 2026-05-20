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

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ScheduleRow from './schedule-row';

export const dynamic = 'force-dynamic';

type ScheduledSkill = {
  id:               string;
  skill_id:         string;
  skill_slug:       string;
  schedule_nl:      string;
  cron_expression:  string;
  timezone:         string;
  destination:      { type: 'dashboard' | 'slack-webhook' | 'slack-plugin'; target?: string };
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
  const { data: schedules } = await supabase
    .from('scheduled_skills')
    .select('id, skill_id, skill_slug, schedule_nl, cron_expression, timezone, destination, status, last_run_at, next_run_at, run_count, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const items: ScheduledSkill[] = (schedules as ScheduledSkill[]) || [];

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Scheduled skills</h1>
          <p className="text-ink-300 text-sm mt-1">
            Recurring runs registered via{' '}
            <code className="bg-ink-900 px-1.5 py-0.5 rounded text-brand-400">/implexa:schedule</code>.
            Output lands in <Link href="/runs" className="text-brand-500 hover:underline">/runs</Link>{' '}
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
              <ScheduleRow key={s.id} schedule={s} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
