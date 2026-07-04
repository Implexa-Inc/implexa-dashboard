/**
 * /workflows/[slug] - one agent's everything-page, split into tabs (the
 * 2-section redesign: Your Agents -> this page). Header carries the primary
 * actions (Activate / Run now / Pause). The depth lives in three tabs:
 *   Overview - the step chain, where it can run, what you get, schedule, changelog
 *   Runs     - this agent's runs as colored todos (output pop-up + feedback inline)
 *   Setup    - the config interview + connection health + "tell Claude to change it"
 *
 * The workflow steps/outcome/capabilities come from the backend public read
 * path (lib/workflow-catalog.ts) because the catalog is service-role-only RLS.
 * The schedule + runs come straight from Supabase (scheduled_skills + skill_runs
 * are both RLS-scoped to the caller), which wires this page into the loop.
 *
 * ?source=web-seed|generated selects the catalog source; ?tab= deep-links a tab.
 */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getWorkflow, getMyWorkflow, listMyWorkflows } from '@/lib/workflow-catalog';
import { remoteSafety } from '@/lib/remote-safety';
import { getConnectionStatus, warningsForAgent } from '@/lib/connections';
import { loadInboxItems } from '@/lib/inbox';
import { detectRequirements } from '@/lib/requirements';
import { desktopAppLive, appActivateUrl } from '@/lib/app-links';
import AgentRequirements from '../../_components/agent-requirements';
import AgentNameEditor from '../../_components/agent-name-editor';
import { RemoteSafetyBadge } from '../../_components/remote-safety-badge';
import { ConnectionAttentionBanner } from '../../_components/connection-attention-banner';
import AgentActions from '../../_components/agent-actions';
import AgentPauseToggle from '../../_components/agent-pause-toggle';
import NotInApp from '../../_components/not-in-app';
import AgentTabs, { type TabDef } from '../../_components/agent-tabs';
import InboxList from '../../inbox/inbox-list';
import BackLink from '../../_components/back-link';
import AgentSetupCard from '../../_components/agent-setup-card';
import AgentLearningsCard from '../../_components/agent-learnings-card';
import AgentExecutorPreference from '../../_components/agent-executor-preference';
import AgentFeedback from '../../_components/agent-feedback';
import ImproveAgent from '../../_components/improve-agent';
import StepRow from '../../_components/step-row';
import ExtendChain from '../../_components/extend-chain';
import { getActivationChecklist } from '@/lib/activation';
import { getMyAgents } from '@/lib/agents-home';
import GradeBadge from '../../_components/grade-badge';

export const dynamic = 'force-dynamic';

type Routine = {
  id: string;
  skill_slug: string;
  schedule_nl: string;
  cron_expression: string;
  status: 'active' | 'paused' | 'failed';
  last_run_at: string | null;
  run_count: number;
  destination: { type: string; target?: string };
  /** Claude Code scheduled-task id — enables the "Open in Claude" deep link. */
  claude_task_id: string | null;
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

export default async function WorkflowDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { source?: string; tab?: string };
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

  // Not in the workflow catalog — but it may still be a scheduled SKILL the user
  // scheduled/paused (a skill isn't a "workflow", so the catalog read 404s). Open
  // a minimal agent page built from its schedule so Pause/Resume + runs still work,
  // instead of a dead 404 when someone clicks a paused agent.
  if (!workflow) {
    const [{ data: schedRows }, skillRuns] = await Promise.all([
      supabase
        .from('scheduled_skills')
        .select('id, skill_slug, schedule_nl, cron_expression, status, last_run_at, run_count, destination, claude_task_id')
        .eq('skill_slug', params.slug)
        .order('created_at', { ascending: false }),
      loadInboxItems(supabase, 20, params.slug),
    ]);
    const sched = (schedRows as Routine[]) || [];
    if (sched.length === 0) notFound();
    const pausable = sched.find((r) => r.status === 'active' || r.status === 'paused') || null;
    const niceName = params.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="max-w-4xl mx-auto">
          <nav className="text-sm text-ink-500 mb-6"><BackLink fallback="/workflows" label="Back" /></nav>
          <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-50">{niceName}</h1>
              <code className="text-xs text-ink-500 font-mono block mt-2">{params.slug}</code>
            </div>
            {pausable && (
              <AgentPauseToggle routineId={pausable.id} initialStatus={pausable.status} />
            )}
          </header>

          <div className="card mb-6">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500 mb-3">Schedule</h2>
            <ul className="space-y-3 text-sm">
              {sched.map((r) => (
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
          </div>

          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500 mb-3">Runs</h2>
          {skillRuns.length === 0 ? (
            <p className="text-sm text-ink-500 italic">No runs yet.</p>
          ) : (
            <InboxList initialItems={skillRuns} basePath={`/workflows/${params.slug}`} heading={null} />
          )}
        </div>
      </main>
    );
  }

  // Schedule for this workflow (RLS-scoped) + this agent's runs as todo items so
  // the Runs tab reuses the same colored-todo + output pop-up + feedback machinery
  // as Home. This is what links the workflow to its routine and its output.
  const [{ data: routineRows }, agentRuns] = await Promise.all([
    supabase
      .from('scheduled_skills')
      .select('id, skill_slug, schedule_nl, cron_expression, status, last_run_at, run_count, destination, claude_task_id')
      .eq('skill_slug', workflow.slug)
      .order('created_at', { ascending: false }),
    loadInboxItems(supabase, 20, workflow.slug),
  ]);

  const routines: Routine[] = (routineRows as Routine[]) || [];
  // The routine to Pause/Resume from the header (the live one, if any).
  const pausableRoutine = routines.find((r) => r.status === 'active' || r.status === 'paused') || null;

  // Connection health for THIS agent: warn loudly if it needs an account that is
  // not reachable in the Implexa browser. Degrades to no banner when the read is
  // not live yet (getConnectionStatus returns null).
  const connWarnings = warningsForAgent(await getConnectionStatus(), workflow.slug);
  const safety = remoteSafety(workflow);
  const boundCount = workflow.steps.filter((s) => s.ref && !s.gap).length;

  // Activation state drives the primary action: Activate (not yet on) vs Run now
  // (queues a run-request that Claude Code picks up). Null (agent not in the
  // user's library yet) falls back to the Activate path.
  const checklist = await getActivationChecklist(workflow.slug);
  const isActive = checklist?.state === 'active';
  const pendingQuestions = checklist?.pendingQuestions ?? 0;
  // Setup-tab dot = the unanswered config questions you can clear in that tab.
  // (A signed-out account gets its own loud banner above the tabs.)
  const setupAttention = pendingQuestions > 0;

  // In-flight state for THIS agent, so the primary action reflects reality on
  // open (not always "Run now"): a queued run (pending run_request the drainer
  // hasn't picked up) → "Queued"; one it has picked up, or a live skill_run →
  // "Running". RLS-scoped; bounded to a 12h window so a stuck/abandoned request
  // doesn't pin the button forever. Best-effort — any error just falls back to
  // the normal Run-now button.
  let inFlight: 'queued' | 'running' | null = null;
  try {
    const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data: reqRows } = await supabase
      .from('run_requests')
      .select('status')
      .eq('workflow_slug', workflow.slug)
      .in('kind', ['run', 'continue', 'revise'])
      .in('status', ['pending', 'consumed'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    if (reqRows?.[0]) inFlight = reqRows[0].status === 'consumed' ? 'running' : 'queued';
    if (!inFlight) {
      const { data: runRows } = await supabase
        .from('skill_runs').select('id').eq('skill_slug', workflow.slug).eq('run_state', 'running').limit(1);
      if (runRows?.length) inFlight = 'running';
    }
  } catch { /* fall back to Run now */ }

  // ── tab panels (server-rendered, handed to the client tab shell) ──

  // What the user needs on their side before running (paid services + the free
  // tools we auto-install), derived from the agent's steps.
  const requirements = detectRequirements(workflow.steps);

  // The proof-layer grade (run_outcome_ledger, 0091). Owner view: pull their
  // private grade from the /me/agents feed (delivered N% over M real runs). Falls
  // back to the public aggregate (min-N gated) for a non-owner visitor. Null when
  // there isn't a real grade yet — the index refuses to flatter a thin history.
  let grade: { hasGrade: boolean; rate: number; label: 'reliable' | 'mixed' | 'unproven'; runs: number; confidence: number } | null = null;
  try {
    const mine = await getMyAgents();
    const owned = mine ? [...mine.active, ...mine.needsActivation].find((x) => x.slug === params.slug) : null;
    grade = owned?.grade ?? null;
    if (!grade) {
      const API = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');
      const r = await fetch(`${API}/api/v2/agents/${encodeURIComponent(params.slug)}/grade`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (r.ok) { const b = await r.json(); if (b?.grade?.hasGrade) grade = b.grade; }
    }
  } catch { /* no grade shown */ }

  // Chain detection + "add a step" candidates. A chain = ≥2 workflow-ref steps.
  // For one, offer to extend it (the cycle-checked path): the user's OTHER agents,
  // minus this chain and the agents already in it. Only fetched when it's a chain.
  const chainHopSlugs = new Set(
    workflow.steps.filter((s) => s.kind === 'workflow' && s.ref?.slug).map((s) => s.ref!.slug),
  );
  const isChain = chainHopSlugs.size >= 2;
  let chainCandidates: Array<{ slug: string; source: string; name: string }> = [];
  if (isChain) {
    const mine = await listMyWorkflows();
    chainCandidates = mine
      .filter((w) => w.slug !== workflow.slug && !chainHopSlugs.has(w.slug))
      .map((w) => ({ slug: w.slug, source: w.source, name: w.name }));
  }

  const overviewPanel = (
    <>
      {/* What you'll need , prerequisites up front, before the run */}
      <AgentRequirements req={requirements} />

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Steps" value={`${workflow.steps.length}`} />
        <Stat label="From skills" value={`${boundCount}`} />
        <Stat label="Runs" value={`${workflow.activity.run_count}`} highlight={workflow.activity.run_count > 0} />
        <Stat label="Last run" value={rel(workflow.activity.last_run_at)} />
      </div>

      {/* Track record — the proof-layer grade, graded on real runs (0091). */}
      {grade && (
        <div className="card mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500 mb-1">Track record</h2>
            <p className="text-sm text-ink-200">
              Delivered <span className="font-semibold text-ink-50">{Math.round(grade.rate * 100)}%</span> across {grade.runs} real run{grade.runs === 1 ? '' : 's'}.
              <span className="text-ink-500"> Graded on what actually happened, not a benchmark.</span>
            </p>
          </div>
          <GradeBadge grade={grade} />
        </div>
      )}

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
        {/* Extend this chain in place (cycle-checked) — append one of your other
            agents as a new step, instead of building a duplicate chain. */}
        {isChain && (
          <div className="mt-3 pt-3 border-t border-ink-800">
            <ExtendChain slug={workflow.slug} candidates={chainCandidates} />
          </div>
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

      {/* Schedule - the loop wiring (runs now live in the Runs tab) */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500">Schedule</h2>
          <Link href={`/workflows/${workflow.slug}/activate`} className="text-xs text-brand-500 hover:underline">manage</Link>
        </div>
        {routines.length === 0 ? (
          <p className="text-sm text-ink-500">
            Runs on-demand (the Run now button above). To run it automatically, add a schedule on its{' '}
            <Link href={`/workflows/${workflow.slug}/activate`} className="text-brand-500 hover:underline">activation page</Link>.
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
                  {/* Undocumented Claude route (verified 2026-06-12) — keep the
                      dashboard as the fallback path beside it. */}
                  {r.claude_task_id && (
                    <>
                      {' · '}
                      <a
                        href={`claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(r.claude_task_id)}`}
                        className="text-brand-500 hover:underline"
                        title="Opens this routine in the Claude desktop app (toggle, history, Run now)."
                      >
                        Open in Claude ↗
                      </a>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
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
    </>
  );

  const runsPanel = agentRuns.length === 0 ? (
    <div className="card p-6 text-center">
      <div className="text-2xl mb-2" aria-hidden="true">✓</div>
      <p className="text-ink-100 font-medium">No runs yet.</p>
      <p className="text-ink-400 text-sm mt-1">
        Use Run now above, or put it on a schedule. Its output shows up here, newest first.
      </p>
    </div>
  ) : (
    <InboxList initialItems={agentRuns} basePath={`/workflows/${workflow.slug}`} heading={null} />
  );

  const setupPanel = (
    <>
      <AgentExecutorPreference slug={workflow.slug} />
      {/* The agent's config interview — answer its questions here so it runs
       * unattended (no stopping to ask in Claude Code). Renders nothing when
       * the agent declares no questions. */}
      <div id="agent-setup" className="mb-6 scroll-mt-20">
        <AgentSetupCard slug={workflow.slug} source={workflow.source} />
        {/* The primary Activate/Run action lives up in the page header — far
         * enough from this card that saving your answers here left you with no
         * next step in view (founder feedback: "I have to click Done, go back,
         * and then activate"). Mirror it right here so Save answers is
         * immediately followed by the actual next action, no navigating away. */}
        <div className="mt-3">
          <AgentActions
            slug={workflow.slug}
            name={workflow.name}
            isActive={isActive}
            requiresLocal={checklist?.requiresLocal}
            source={workflow.source}
            nextRunAt={checklist?.nextRunAt}
            pendingQuestions={checklist?.pendingQuestions}
            claudeTaskId={pausableRoutine?.claude_task_id}
            inFlight={inFlight}
            align="start"
          />
        </div>
      </div>

      {/* The private per-(user, agent) learnings that accumulate as it runs
       * (backend migration 0105) — durable preferences injected into every run.
       * Private to this user; never edits the shared agent definition. */}
      <div id="agent-learnings" className="mb-6 scroll-mt-20">
        <AgentLearningsCard slug={workflow.slug} />
      </div>

      {/* Edit what the agent DOES — a plain-language change rewrites its steps
          (kind='revise') into a new version. Distinct from config answers above.
          id + scroll-mt matches the other setup-panel anchors (agent-setup,
          agent-learnings) — the header's "Edit" link jumps straight here. */}
      <div id="agent-improve" className="mb-6 scroll-mt-20">
        <ImproveAgent slug={workflow.slug} />
      </div>

      {/* "Or have feedback? Tell Claude to change it." */}
      <AgentFeedback slug={workflow.slug} name={workflow.name} />
    </>
  );

  const tabs: TabDef[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'runs', label: agentRuns.length ? `Runs (${agentRuns.length})` : 'Runs' },
    { key: 'setup', label: 'Setup', attention: setupAttention },
  ];

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <nav className="text-sm text-ink-500 mb-6">
          <BackLink fallback="/workflows" label="Back" />
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
              <div className="flex items-center gap-2.5 flex-wrap">
                {/* Rename is a per-user alias (your view only, never the shared
                    name), so it's available on EVERY agent — not just generated. */}
                <AgentNameEditor slug={workflow.slug} source={workflow.source} initialName={workflow.name} editable={true} />
                {/* Distinct from the rename pencil above: this jumps to "Edit this
                    agent" (ImproveAgent, in the Setup tab) — changing what the
                    agent DOES, not its display name. It used to be discoverable
                    only by scrolling to the bottom of Setup (founder ask: surface
                    it right next to the name so people know they can edit it). */}
                <Link
                  href={`/workflows/${encodeURIComponent(workflow.slug)}?source=${encodeURIComponent(workflow.source)}&tab=setup#agent-improve`}
                  className="text-xs text-ink-400 hover:text-ink-200 underline underline-offset-2"
                >
                  Edit
                </Link>
              </div>
              <code className="text-xs text-ink-500 font-mono block mt-2">{workflow.slug}</code>
              <p className="text-ink-200 mt-3">{workflow.job || workflow.description}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {/→|->/.test(workflow.name || '') && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-violet-500/40 text-violet-600 dark:text-violet-300" title="A chain — runs several agents in sequence, each feeding the next">⛓ Chain</span>
                )}
                <RemoteSafetyBadge safety={safety} />
              </div>
            </div>
            <div className="flex-none flex flex-col items-end gap-2">
              <AgentActions
                slug={workflow.slug}
                name={workflow.name}
                isActive={isActive}
                requiresLocal={checklist?.requiresLocal}
                source={workflow.source}
                nextRunAt={checklist?.nextRunAt}
                pendingQuestions={checklist?.pendingQuestions}
                claudeTaskId={pausableRoutine?.claude_task_id}
                inFlight={inFlight}
              />
              {pausableRoutine && (
                <AgentPauseToggle routineId={pausableRoutine.id} initialStatus={pausableRoutine.status} />
              )}
              {/* Desktop-first: open this agent in the app (gated until the app
                  ships; web actions above remain the fallback). */}
              {desktopAppLive() && (
                <NotInApp>
                  <a href={appActivateUrl(workflow.slug)} className="text-[11px] text-brand-500 hover:underline">
                    Open in the Implexa app ↗
                  </a>
                </NotInApp>
              )}
            </div>
          </div>
        </header>

        {/* Connection warning - an account this agent needs is signed out. Loud,
         * above the tabs, with a one-tap sign-in. Renders nothing when healthy. */}
        {connWarnings.length > 0 && (
          <ConnectionAttentionBanner warnings={connWarnings} scope="agent" className="mb-6" />
        )}

        <AgentTabs
          tabs={tabs}
          initial={searchParams.tab}
          panels={{ overview: overviewPanel, runs: runsPanel, setup: setupPanel }}
        />
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
