/**
 * /workflows/[slug] - one workflow in full: the ordered step chain (skill /
 * tool / decision, with bound skill refs and any gaps), the remote-safe
 * verdict, the outcome prior, the schedule + recent runs, and the changelog.
 *
 * The workflow steps/outcome/capabilities come from the backend public read
 * path (lib/workflow-catalog.ts) because the catalog is service-role-only RLS.
 * The schedule + runs come straight from Supabase (scheduled_skills + skill_runs
 * are both RLS-scoped to the caller), which is what wires this page into the
 * Routines <-> Workflows <-> Runs loop.
 *
 * ?source=web-seed|generated selects which catalog source to read (defaults to
 * web-seed, the seeded catalog).
 */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getWorkflow, getMyWorkflow, type WorkflowStep } from '@/lib/workflow-catalog';
import { remoteSafety } from '@/lib/remote-safety';
import { RemoteSafetyBadge } from '../../_components/remote-safety-badge';
import CopyRunCommand from '../../_components/copy-run-command';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://implexa.ai';

type Routine = {
  id: string;
  skill_slug: string;
  schedule_nl: string;
  cron_expression: string;
  status: 'active' | 'paused' | 'failed';
  last_run_at: string | null;
  run_count: number;
  destination: { type: string; target?: string };
};

type Run = {
  id: string;
  skill_slug: string;
  status: 'completed' | 'failed' | 'partial';
  ran_at: string;
  source: string;
};

function rel(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function StepRow({ step }: { step: WorkflowStep }) {
  const bound = step.ref && !step.gap;
  return (
    <li className="flex gap-3 py-3">
      <div className="flex-none mt-0.5">
        <span
          className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold tabular-nums ${
            bound
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-ink-800 text-ink-400'
          }`}
        >
          {step.order}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {step.kind !== 'skill' && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-ink-700 text-ink-400">
              {step.kind}
            </span>
          )}
          {step.gap && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-700 dark:text-amber-300">
              gap
            </span>
          )}
        </div>
        <p className="text-sm text-ink-100">{step.label}</p>
        {step.detail ? (
          <p className="mt-1 text-xs text-ink-400 leading-relaxed">{step.detail}</p>
        ) : bound && step.ref_summary?.description ? (
          <p className="mt-1 text-xs text-ink-400 leading-relaxed">{step.ref_summary.description}</p>
        ) : null}
        {bound && step.same_as_step ? (
          <p className="mt-1 text-xs text-ink-500">
            ↳ same skill as step {step.same_as_step}
            {step.ref_summary?.name ? ` (${step.ref_summary.name})` : ''}
          </p>
        ) : null}
        {bound && !step.same_as_step && step.ref_summary?.preview ? (
          <p className="mt-1.5 text-xs text-ink-500 leading-relaxed border-l border-ink-700 pl-3">
            {step.ref_summary.preview}
          </p>
        ) : null}
        {bound && step.ref && step.ref.source === 'org' ? (
          // Org skills are the user's OWN captured skills: private, no public
          // page. Show the name plainly instead of a public link that 404s.
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            {step.ref_summary?.name ? `your skill: ${step.ref_summary.name}` : `your skill: ${step.ref.slug}`}
          </span>
        ) : bound && step.ref ? (
          <a
            href={`${SITE_URL}/s/${encodeURIComponent(step.ref.source)}/${encodeURIComponent(step.ref.slug)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            {step.ref_summary?.name ? `full skill: ${step.ref_summary.name}` : `uses verified skill: ${step.ref.slug}`}
          </a>
        ) : step.kind === 'decision' ? (
          <span className="mt-1 block text-xs text-ink-500">decision step</span>
        ) : (
          <span className="mt-1 block text-xs text-ink-500">your model fills this step</span>
        )}
        {step.fallbacks.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5">
            {step.fallbacks.map((fb) => (
              <li key={fb} className="text-xs text-ink-500">
                <span className="text-ink-600">no integration? </span>
                {fb}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

export default async function WorkflowDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { source?: string };
}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const source = searchParams.source || 'web-seed';
  const w = await getWorkflow(params.slug, source);
  // Fall back to the other known source before giving up (a generated workflow
  // reached without ?source, or vice versa).
  const wPublic = w || (await getWorkflow(params.slug, source === 'web-seed' ? 'generated' : 'web-seed'));
  // Last resort: the caller's OWN private (unshared) workflow, which the public
  // read 404s by design. Owner-scoped authed read so users can view their own.
  const workflow = wPublic
    || (await getMyWorkflow(params.slug, source === 'web-seed' ? 'generated' : source))
    || (await getMyWorkflow(params.slug, 'community'));
  if (!workflow) notFound();

  // Schedule + runs for this workflow - both RLS-scoped to the caller. This is
  // what links the workflow to its routine and its delivered output.
  const [{ data: routineRows }, { data: runRows }] = await Promise.all([
    supabase
      .from('scheduled_skills')
      .select('id, skill_slug, schedule_nl, cron_expression, status, last_run_at, run_count, destination')
      .eq('skill_slug', workflow.slug)
      .order('created_at', { ascending: false }),
    supabase
      .from('skill_runs')
      .select('id, skill_slug, status, ran_at, source')
      .eq('skill_slug', workflow.slug)
      .order('ran_at', { ascending: false })
      .limit(10),
  ]);

  const routines: Routine[] = (routineRows as Routine[]) || [];
  const runs: Run[] = (runRows as Run[]) || [];
  const safety = remoteSafety(workflow);
  const boundCount = workflow.steps.filter((s) => s.ref && !s.gap).length;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <nav className="text-sm text-ink-500 mb-6">
          <Link href="/workflows" className="hover:underline">← All agents</Link>
        </nav>

        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {workflow.vertical && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-ink-700 text-ink-400">
                {workflow.vertical}
              </span>
            )}
            {workflow.cadence && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-ink-700 text-amber-700 dark:text-amber-300">
                {workflow.cadence}
              </span>
            )}
            {workflow.unproven && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-amber-500/40 text-amber-700 dark:text-amber-300">
                auto-generated · unproven
              </span>
            )}
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-semibold tracking-tight text-ink-50">{workflow.name}</h1>
              <code className="text-xs text-ink-500 font-mono block mt-2">{workflow.slug}</code>
              <p className="text-ink-200 mt-3">{workflow.job || workflow.description}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <RemoteSafetyBadge safety={safety} />
              </div>
            </div>
            <div className="flex-none">
              <CopyRunCommand slug={workflow.slug} kind="workflow" />
            </div>
          </div>
        </header>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Steps" value={`${workflow.steps.length}`} />
          <Stat label="From skills" value={`${boundCount}`} />
          <Stat label="Runs" value={`${workflow.activity.run_count}`} highlight={workflow.activity.run_count > 0} />
          <Stat label="Last run" value={rel(workflow.activity.last_run_at)} />
        </div>

        {/* Remote verdict explainer */}
        <div className="card mb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500">Where this can run</h2>
            <RemoteSafetyBadge safety={safety} size="xs" />
          </div>
          <p className="text-sm text-ink-200">{safety.reason}</p>
          {safety.estimated && (
            <p className="text-xs text-ink-500 mt-2">
              Estimated from the step chain. The authoritative verdict comes from the watchdog once this agent runs on a schedule.
            </p>
          )}
        </div>

        {/* What you get */}
        {workflow.primary_outcome && (
          <div className="card mb-6">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500 mb-2">What you get</h2>
            <p className="text-sm text-ink-200">{workflow.primary_outcome}</p>
            {workflow.signals.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {workflow.signals.map((sig) => (
                  <span key={sig} className="text-[10px] px-2 py-1 rounded bg-ink-800 text-ink-300">{sig}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Steps */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500">The steps</h2>
            <span className="text-xs text-ink-500">
              {workflow.steps.length} steps
              {boundCount > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400"> · {boundCount} from verified skills</span>
              )}
            </span>
          </div>
          {workflow.steps.length === 0 ? (
            <p className="text-sm text-ink-500 italic">No steps recorded.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {workflow.steps.map((s) => (
                <StepRow key={`${s.order}-${s.label.slice(0, 16)}`} step={s} />
              ))}
            </ul>
          )}
        </div>

        {/* Caveat */}
        {workflow.caveat && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-5 mb-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-200 mb-1">Keep in mind</h2>
            <p className="text-sm text-amber-800 dark:text-amber-100/80">{workflow.caveat}</p>
          </div>
        )}

        {/* Runs hands-free with */}
        {workflow.capabilities.length > 0 && (
          <div className="card mb-6">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500 mb-3">Runs hands-free with</h2>
            <ul className="space-y-3">
              {workflow.capabilities.map((cap) => (
                <li key={cap.id} className="text-sm">
                  <div className="text-ink-100">{cap.name}</div>
                  <div className="text-xs text-ink-400 mt-0.5">{cap.why}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Schedule + runs - the loop wiring */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500">Schedule</h2>
              <Link href="/scheduled" className="text-xs text-brand-500 hover:underline">manage</Link>
            </div>
            {routines.length === 0 ? (
              <p className="text-sm text-ink-500">
                Not on a schedule yet. Copy the run command above and approve a schedule in your Claude or Codex to run it automatically.
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {routines.map((r) => (
                  <li key={r.id}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-ink-200">{r.schedule_nl}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                        r.status === 'active'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : r.status === 'paused'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                      }`}>{r.status}</span>
                    </div>
                    <div className="text-xs text-ink-400 mt-0.5">
                      {r.run_count} run{r.run_count === 1 ? '' : 's'} · last {rel(r.last_run_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500">Recent runs</h2>
              <Link href="/runs" className="text-xs text-brand-500 hover:underline">all runs</Link>
            </div>
            {runs.length === 0 ? (
              <p className="text-sm text-ink-500">No runs yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`inline-block size-2 rounded-full ${
                        r.status === 'completed' ? 'bg-emerald-400' : r.status === 'partial' ? 'bg-amber-400' : 'bg-rose-400'
                      }`} aria-hidden="true" />
                      <span className="text-ink-300">{r.status}</span>
                    </span>
                    <span className="text-xs text-ink-500">{rel(r.ran_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Changelog */}
        {workflow.versions.length > 0 && (
          <div className="card mb-6">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500">Changelog</h2>
              {workflow.proposed_count > 0 && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-amber-500/40 text-amber-700 dark:text-amber-300">
                  {workflow.proposed_count} proposed
                </span>
              )}
            </div>
            <ol className="space-y-2 text-sm">
              {workflow.versions.map((v) => (
                <li key={v.version} className="flex items-start gap-2">
                  <span className="text-xs font-medium text-ink-300 tabular-nums flex-none">v{v.version}</span>
                  <div className="min-w-0">
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-ink-700 text-ink-400">{v.source}</span>
                    {v.summary && <p className="text-xs text-ink-400 mt-0.5">{v.summary}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Sources */}
        {workflow.sources.length > 0 && (
          <div className="card">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500 mb-3">Built from</h2>
            <ul className="space-y-2">
              {workflow.sources.map((src) => (
                <li key={src}>
                  <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-brand-500 hover:underline break-all">
                    {src}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card !p-3 ${highlight ? '!border-success-400/40' : ''}`}>
      <div className={`text-xl font-semibold tabular-nums ${highlight ? 'text-success-600 dark:text-success-400' : 'text-ink-50'}`}>{value}</div>
      <div className="text-xs text-ink-400 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
