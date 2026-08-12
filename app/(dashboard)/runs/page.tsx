/**
 * /runs — Runs as a calendar of activities.
 *
 * Powered by skill_runs (migration 0023). The month grid (<RunsCalendar/>) shows
 * each day's run activity with a status dot; clicking a day lists that day's runs,
 * each linking to /runs/[id] for the full deliverable. Replaces the old flat list
 * (the per-run detail now lives on the run page).
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { selectRuns } from '@/lib/run-state';
import RunsCalendar, { type CalRun } from '../_components/runs-calendar';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // RLS-scoped to caller. A lightweight slice (no output_markdown) — the calendar
  // only needs status + timing; the full deliverable is on /runs/[id].
  const items = await selectRuns(supabase, { limit: 200 });
  const runs: CalRun[] = items.map((r) => ({
    id: r.id,
    skillSlug: r.skill_slug,
    status: r.status ?? null,
    runState: r.run_state ?? null,
    reviewStatus: r.review_status ?? null,
    ranAt: r.ran_at,
    source: r.source ?? null,
  }));

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Runs</h1>
          <p className="text-ink-300 text-sm mt-1">
            What your autopilot delivered, by day. Tap a day to see its runs; tap a run for the full result.
          </p>
        </header>

        {runs.length === 0 ? (
          <section className="card text-sm text-ink-300">
            <p className="mb-3">No runs yet.</p>
            <p>
              Build an agent in <Link href="/workflows" className="text-brand-500 hover:underline">Agents</Link> and run it —
              its work shows up here.
            </p>
          </section>
        ) : (
          <RunsCalendar runs={runs} />
        )}
      </div>
    </main>
  );
}
