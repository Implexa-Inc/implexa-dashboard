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
import { getWorkflow, getMyWorkflow, listMyWorkflows, workflowRunInputs } from '@/lib/workflow-catalog';
import { remoteSafety } from '@/lib/remote-safety';
import { getConnectionStatus, warningsForAgent } from '@/lib/connections';
import { loadInboxItems } from '@/lib/inbox';
import { desktopAppLive, appActivateUrl } from '@/lib/app-links';
import AgentReadiness from '../../_components/agent-readiness';
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
import ScheduleManager from '../../_components/schedule-manager';
import { ActivationCard } from '../../_components/activation-card';
import AgentLearningsCard from '../../_components/agent-learnings-card';
import AgentExecutorPreference from '../../_components/agent-executor-preference';
import { ImplexaJudgePolicy } from '../../_components/implexa-judge-policy';
import AgentFeedback from '../../_components/agent-feedback';
import AgentEditButton from '../../_components/agent-edit-button';
import AgentUpdateGate from '../../_components/agent-update-gate';
import ReviseLandedPoller from '../../_components/revise-landed-poller';
import StepRow from '../../_components/step-row';
import ExtendChain from '../../_components/extend-chain';
import { getActivationChecklist } from '@/lib/activation';
import { getMyAgents } from '@/lib/agents-home';
import { isRevisePending, newestVersionAt } from '@/lib/revise-pending';
import GradeBadge from '../../_components/grade-badge';
import { isPausableRoutine } from '@/lib/schedule-trigger';
import { getAgentResume } from '@/lib/agent-discovery';
import AgentResume from '../../_components/agent-resume';

export const dynamic = 'force-dynamic';

type Routine = {
  id: string;
  skill_slug: string;
  schedule_nl: string;
  cron_expression: string | null;
  trigger_type?: string | null;
  fire_at?: string | null;
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
  searchParams: { source?: string; tab?: string; legacy?: string };
}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  if (searchParams.legacy !== '1') {
    const resume = await getAgentResume(params.slug, session.access_token);
    if (resume) return <AgentResume agent={resume} />;
  }

  const source = searchParams.source || 'web-seed';
  // OWNER-SCOPED FRESH READ FIRST (2026-07-18 founder report): a revise (or
  // continue/build) can land on the caller's OWN agent seconds before they open
  // this exact page — the new step must show up immediately. getWorkflow's public
  // catalog read is cached for 10 minutes (see workflow-catalog.ts's
  // callMcpTool(..., 600)) for good reason on the BROWSE-someone-else's-shared-
  // agent path, but this page's most common visitor is the owner checking their
  // OWN agent right after editing it — and `||` short-circuits on the FIRST
  // truthy result, so once a shared agent's cached public read ever succeeds, the
  // always-fresh owner-scoped read below was never even attempted, silently
  // hiding the edit for up to 10 minutes. getMyWorkflow is owner-scoped
  // (cache: 'no-store') and correctly returns null for an agent that isn't the
  // caller's own, so trying it first costs a cheap extra round-trip on the
  // browse-a-public-agent path and nothing else — it never masks a real 404.
  const mine = (await getMyWorkflow(params.slug, source === 'web-seed' ? 'generated' : source))
    || (await getMyWorkflow(params.slug, 'community'));
  const w = mine || (await getWorkflow(params.slug, source));
  // Fall back to the other known source before giving up (a generated workflow
  // reached without ?source, or vice versa).
  const workflow = w || (await getWorkflow(params.slug, source === 'web-seed' ? 'generated' : 'web-seed'));

  // Not in the workflow catalog — but it may still be a scheduled SKILL the user
  // scheduled/paused (a skill isn't a "workflow", so the catalog read 404s). Open
  // a minimal agent page built from its schedule so Pause/Resume + runs still work,
  // instead of a dead 404 when someone clicks a paused agent.
  if (!workflow) {
    const [{ data: schedRows }, skillRuns] = await Promise.all([
      supabase
        .from('scheduled_skills')
        .select('id, skill_slug, schedule_nl, cron_expression, status, last_run_at, run_count, destination, claude_task_id, trigger_type, fire_at')
        .eq('skill_slug', params.slug)
        .order('created_at', { ascending: false }),
      loadInboxItems(supabase, 20, params.slug),
    ]);
    const sched = (schedRows as Routine[]) || [];
    if (sched.length === 0) notFound();
    const pausable = sched.find((r) => (r.status === 'active' || r.status === 'paused') && isPausableRoutine(r)) || null;
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
  const [{ data: routineRows }, agentRuns, judgePolicy] = await Promise.all([
    supabase
      .from('scheduled_skills')
      .select('id, skill_slug, schedule_nl, cron_expression, status, last_run_at, run_count, destination, claude_task_id, trigger_type, fire_at')
      .eq('skill_slug', workflow.slug)
      .order('created_at', { ascending: false }),
    loadInboxItems(supabase, 20, workflow.slug),
    // Judge policy for THIS agent (RLS select-own scopes it to the caller). Read
    // defensively: pre-0121/0124 the table or the 'observe' value may not exist,
    // and a missing policy must degrade to "no badge", never break the page.
    supabase
      .from('user_agent_judge_policies')
      .select('mode')
      .eq('skill_slug', workflow.slug)
      .maybeSingle()
      .then((r) => (r && r.data ? r.data.mode : null), () => null),
  ]);

  const routines: Routine[] = (routineRows as Routine[]) || [];
  // The routine to Pause/Resume from the header (the live one, if any).
  const pausableRoutine = routines.find((r) => (r.status === 'active' || r.status === 'paused') && isPausableRoutine(r)) || null;
  // The routine the inline ScheduleManager edits: the live clock if any (regardless
  // of status, so a 'failed' one is still editable), else null → on-demand agent.
  const scheduleRoutine = pausableRoutine || routines.find((r) => isPausableRoutine(r)) || null;

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
  // Required-only — the same predicate Run gates on, so Overview can never claim
  // "ready" while Run would stop you. Falls back to the total on an older backend
  // (before blockingQuestions existed), which is the pre-change behaviour.
  const blockingQuestions = checklist?.blockingQuestions ?? pendingQuestions;
  const optionalQuestions = checklist?.optionalQuestions ?? 0;
  // The ONE authoritative requirements list, server-computed (the dashboard used
  // to detect these itself from a hand-copied table that had already drifted).
  // Server-side we only know whether a KEY EXISTS on the machine, never whether
  // THIS agent is granted it (grants are local-only). So the Overview line reports
  // the weaker, honest claim; the per-agent truth is resolved client-side inside
  // the requirements panel, which keeps its row actionable until the grant lands.
  const reqServices = checklist?.requirements?.services ?? [];
  const missingServices = reqServices.filter((x) => !x.keyOnMachine).map((x) => x.name);
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
  // A queued/in-progress EDIT (kind='revise') is tracked separately from a run:
  // it's a rewrite of the agent's steps, not a run — so it must NOT read as
  // "Queued ✓ / Running" on Run now, and while it's pending Run now is blocked
  // (running the OLD version mid-rewrite is a footgun). Cleared once the user's
  // Claude drains the revise request (status → done) and a new version lands.
  // SELF-HEALING (2026-07-16): the open-request check is only the TRIGGER — it's
  // AND-gated with "no version landed since the ask" (isRevisePending). A session
  // that lands the version but skips resolve_run_request leaves the request stuck
  // at 'consumed' forever (a revise has no skill_run, so no server backstop closes
  // it); without the gate that pinned "Updating…" indefinitely. workflow.versions
  // is already in scope from the detail read — no extra round-trip.
  let revisePending = false;
  try {
    const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data: reqRows } = await supabase
      .from('run_requests')
      .select('status, kind, created_at')
      .eq('workflow_slug', workflow.slug)
      .in('kind', ['run', 'continue', 'revise'])
      .in('status', ['pending', 'consumed'])
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    revisePending = isRevisePending(reqRows, newestVersionAt(workflow.versions));
    const runReq = (reqRows || []).find((r) => r.kind === 'run' || r.kind === 'continue');
    if (runReq) inFlight = runReq.status === 'consumed' ? 'running' : 'queued';
    if (!inFlight) {
      const { data: runRows } = await supabase
        .from('skill_runs').select('id').eq('skill_slug', workflow.slug).eq('run_state', 'running').limit(1);
      if (runRows?.length) inFlight = 'running';
    }
  } catch { /* fall back to Run now */ }

  // ── tab panels (server-rendered, handed to the client tab shell) ──

  // What the user needs on their side before running (paid services + the free
  // tools we auto-install), derived from the agent's steps.

  // The proof-layer grade (run_outcome_ledger, 0091). Owner view: pull their
  // private grade from the /me/agents feed (delivered N% over M real runs). Falls
  // back to the public aggregate (min-N gated) for a non-owner visitor. Null when
  // there isn't a real grade yet — the index refuses to flatter a thin history.
  let grade: { hasGrade: boolean; rate: number; label: 'reliable' | 'mixed' | 'unproven'; runs: number; confidence: number } | null = null;
  try {
    const mine = await getMyAgents();
    // Unavailable feed -> no grade shown. Omitting a grade is honest; inventing one is not.
    const owned = mine.status === 'ready' ? [...mine.active, ...mine.needsActivation].find((x) => x.slug === params.slug) : null;
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
      {/* Readiness, not a shopping list. "What you'll need" is PROVISIONING and
          now lives in Activate, where it can be finished and then collapse — it
          used to sit here permanently, never reflecting satisfaction, offering
          "Get it" for keys the user already had. */}
      <AgentReadiness
        slug={workflow.slug}
        isActive={isActive}
        blockingQuestions={blockingQuestions}
        optionalQuestions={optionalQuestions}
        requirementsSatisfied={missingServices.length === 0}
        missingServices={missingServices}
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Steps" value={`${workflow.steps.length}`} />
        <Stat label="From skills" value={`${boundCount}`} />
        <Stat label="Runs" value={`${workflow.activity.run_count}`} highlight={workflow.activity.run_count > 0} />
        <Stat label="Last run" value={rel(workflow.activity.last_run_at)} />
      </div>

      {/* Build evidence — whether this agent was assembled from parts that
          have actually delivered in real runs, not merely from semantic matches. */}
      {workflow.build_evidence && workflow.build_evidence.status !== 'pending' && (
        <div className="card mb-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500 mb-1">Build evidence</h2>
          {Number(workflow.build_evidence.provenSteps || 0) > 0 ? (
            <p className="text-sm text-ink-200">
              Real-run evidence on <span className="font-semibold text-ink-50">{workflow.build_evidence.provenSteps}</span> step{workflow.build_evidence.provenSteps === 1 ? '' : 's'}
              {Number(workflow.build_evidence.verifiedSteps || 0) > 0 ? (
                <> · <span className="text-emerald-600 dark:text-emerald-400">{workflow.build_evidence.verifiedSteps} verified</span></>
              ) : null}
              {Number(workflow.build_evidence.patternSteps || 0) > 0 ? (
                <> · <span className="text-emerald-600 dark:text-emerald-400">{workflow.build_evidence.patternSteps} adapted from delivered agents</span></>
              ) : null}
              <span className="text-ink-500">. Unproven matches can still inspire steps, but they do not count as proof.</span>
            </p>
          ) : (
            <p className="text-sm text-ink-400">
              New agent — no proven run history yet. Implexa will learn from verified runs and feedback after this runs.
            </p>
          )}
        </div>
      )}

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
              <span className="text-emerald-600 dark:text-emerald-400">
                {' '}· {Number(workflow.build_evidence?.provenSteps || 0) > 0
                  ? `${workflow.build_evidence?.provenSteps} from proven runs`
                  : `${boundCount} bound skills`}
              </span>
            )}
          </span>
        </div>
        {workflow.steps.length === 0 ? (
          <p className="text-sm text-ink-500 italic">No steps recorded.</p>
        ) : (
          <ul className="divide-y divide-ink-800">
            {workflow.steps.map((s) => (
              <StepRow
                key={`${s.order}-${s.label.slice(0, 16)}`}
                step={s}
                showBuildEvidence={Boolean(workflow.build_evidence && workflow.build_evidence.status !== 'pending')}
              />
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

      {/* Schedule — edit / pause / make-on-demand inline, no navigating away. */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-500">Schedule</h2>
          {scheduleRoutine && (
            <span className="text-xs text-ink-400">
              {scheduleRoutine.run_count} run{scheduleRoutine.run_count === 1 ? '' : 's'} · last {rel(scheduleRoutine.last_run_at)}
            </span>
          )}
        </div>
        <ScheduleManager slug={workflow.slug} agentName={workflow.name} routine={scheduleRoutine} />
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
      {/* Same run-input identity the header's <AgentActions/> gets — the card
          renders its own Run now, and a Run button that can't build the envelope
          is a refusal the user has no way to answer from that screen. */}
      {checklist && <ActivationCard checklist={checklist} surface="setup" runInputs={workflowRunInputs(workflow)} />}
      <div className="mb-6">
        <ImplexaJudgePolicy slug={workflow.slug} />
      </div>
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
            blockingQuestions={checklist?.blockingQuestions}
            claudeTaskId={pausableRoutine?.claude_task_id}
            inFlight={inFlight}
            revisePending={revisePending}
            workflowVersionId={workflow.workflow_version_id}
            inputContract={workflow.input_contract}
            inputContractDigest={workflow.input_contract_digest}
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

      {/* "Edit what the agent DOES" now lives in the header's Edit Agent pop-up
          (<AgentEditButton/>) instead of a card here — one place, opened right
          where the click happens, instead of a tab-switch-and-scroll. */}

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
            {/* Judge state belongs beside the other "what is this agent" facts, so
                you can see at a glance that a second model reviews this agent's runs
                without opening Setup.
                The two ON modes are NOT collapsed into one badge on purpose: observe
                only reviews, every_run may queue a repair that RE-RUNS the agent on
                your own subscription. A badge that said just "ON" for both would hide
                the one that spends money. */}
            {judgePolicy === 'observe' && (
              <span
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-violet-500/40 text-violet-600 dark:text-violet-300"
                title="Implexa Judge reviews every run of this agent and reports back. Nothing is changed or re-run."
              >
                Judge: on
              </span>
            )}
            {judgePolicy === 'every_run' && (
              <span
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-violet-500/40 text-violet-600 dark:text-violet-300"
                title="Implexa Judge reviews every run AND may automatically re-run this agent to repair what it safely can, on your own subscription."
              >
                Judge: on · repair
              </span>
            )}
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                {/* Rename is a per-user alias (your view only, never the shared
                    name), so it's available on EVERY agent — not just generated. */}
                <AgentNameEditor slug={workflow.slug} source={workflow.source} initialName={workflow.name} editable={true} />
                {/* Distinct from the rename pencil above: this opens the
                    plain-language "edit what this agent does" form directly (a
                    pop-up, not a tab-switch-and-scroll — founder feedback: the
                    old Link "doesn't do anything" visible at the click itself).
                    The Setup tab no longer carries its own copy of this form. */}
                <AgentEditButton slug={workflow.slug} />
              </div>
              <code className="text-xs text-ink-500 font-mono block mt-2">{workflow.slug}</code>
              {revisePending && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2 max-w-xl">
                  <span className="mt-0.5 inline-block h-2 w-2 flex-none rounded-full bg-violet-500 animate-pulse" aria-hidden />
                  <p className="text-xs text-violet-700 dark:text-violet-300 leading-snug">
                    <span className="font-medium">Rewrite in progress.</span> Your Claude is updating this agent’s
                    steps with your edit. Running is paused until it lands — every future run then uses the new version.
                    {/* A revise lands ASYNCHRONOUSLY (the drainer calls revise_workflow
                        minutes later). Without this the page kept showing the OLD steps
                        until a manual reload — the banner was the only thing that ever
                        updated. Re-running the server render is the check. */}
                    <ReviseLandedPoller revisePending={revisePending} />
                  </p>
                </div>
              )}
              <p className="text-ink-200 mt-3">{workflow.job || workflow.description}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {/→|->/.test(workflow.name || '') && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-violet-500/40 text-violet-600 dark:text-violet-300" title="A chain — runs several agents in sequence, each feeding the next">⛓ Chain</span>
                )}
                <RemoteSafetyBadge safety={safety} />
              </div>
            </div>
            <div className="flex-none flex flex-col items-end gap-2">
              {workflow.update_available?.input_contract_digest && (
                <AgentUpdateGate
                  workflowId={workflow.id}
                  update={{ ...workflow.update_available, input_contract_digest: workflow.update_available.input_contract_digest }}
                />
              )}
              <AgentActions
                slug={workflow.slug}
                name={workflow.name}
                isActive={isActive}
                requiresLocal={checklist?.requiresLocal}
                source={workflow.source}
                nextRunAt={checklist?.nextRunAt}
                pendingQuestions={checklist?.pendingQuestions}
                blockingQuestions={checklist?.blockingQuestions}
                claudeTaskId={pausableRoutine?.claude_task_id}
                inFlight={inFlight}
                revisePending={revisePending}
                workflowVersionId={workflow.workflow_version_id}
                inputContract={workflow.input_contract}
                inputContractDigest={workflow.input_contract_digest}
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
