/**
 * /workflows/[slug] - one agent's everything-page, split into tabs (the
 * 2-section redesign: Your Agents -> this page). Header carries the primary
 * actions (Activate / Run now / Pause). The depth lives in three tabs:
 *   Overview - the step chain, where it can run, what you get, schedule, changelog
 *   Runs     - this agent's runs as colored todos (output pop-up + feedback inline)
 *   Setup    - the config interview + connection health + "tell Claude to change it"
 *
 * EVERYTHING the page needs arrives in ONE authenticated envelope read
 * (lib/agent-detail.ts → GET /api/v2/me/agents/:slug/detail): workflow (with
 * owner-privacy and installed-version authority applied server-side),
 * checklist, this agent's connection warnings, the owner/private grade, judge
 * policy, schedules, the Runs-tab rows, and raw run/revise lifecycle rows.
 * This replaced a ~9-request serial waterfall (two of which computed the
 * caller's ENTIRE roster to extract one agent's slice). The page still derives
 * queued/running + revise-pending itself from the raw lifecycle rows, so no
 * truth moves server-side. The marketplace discovery probe runs in parallel
 * with the envelope; the schedule-only fallback (no visible workflow) keeps
 * its RLS reads.
 *
 * ?source=web-seed|generated selects the catalog source; ?tab= deep-links a tab.
 */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listMyWorkflows, workflowRunInputs } from '@/lib/workflow-catalog';
import { getAgentDetail } from '@/lib/agent-detail';
import { remoteSafety } from '@/lib/remote-safety';
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

  // ONE ENVELOPE, OWNER-SCOPED AND ALWAYS FRESH (cache: 'no-store'). The
  // backend resolves the workflow with the same owner-first source preference
  // the old probe chain had (2026-07-18 founder report: a landed revise must
  // show immediately — the envelope read is never cached), applies the private-
  // workflow visibility gate, and pins the installed version authority. The
  // marketplace discovery probe used to be a SERIAL hop in front of everything;
  // it now runs in parallel with the envelope and simply wins when the agent is
  // a marketplace one.
  const detailPromise = getAgentDetail(params.slug, session.access_token, { source: searchParams.source });
  if (searchParams.legacy !== '1') {
    const resume = await getAgentResume(params.slug, session.access_token);
    if (resume.status === 'found') return <AgentResume agent={resume.agent} />;
    if (resume.status === 'unavailable') return <main className="min-h-screen px-4 py-10"><div className="mx-auto max-w-4xl rounded-md border border-amber-500/30 bg-amber-500/10 p-4"><h1 className="text-lg font-semibold text-ink-50">Agent unavailable</h1><p role="alert" className="mt-2 text-sm text-amber-200">{resume.reason} Marketplace readiness could not be verified, so running is disabled. Try again.</p></div></main>;
  }

  const detailResult = await detailPromise;

  // A FAILED READ IS NOT A MISSING AGENT. 'unavailable' used to fall through to
  // the schedule-only branch below, which calls notFound() when the agent has
  // no schedule row — so a backend blip told the owner their agent had been
  // deleted. The reader distinguishes not_found from unavailable precisely so
  // this branch can, and the schedule-only fallback stays reserved for its real
  // case: a scheduled SKILL that genuinely is not in the workflow catalog.
  if (detailResult.status === 'unavailable') {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-4xl rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
          <h1 className="text-lg font-semibold text-ink-50">Agent status unavailable</h1>
          <p role="alert" className="mt-2 text-sm text-amber-200">
            We could not load <code className="font-mono">{params.slug}</code> right now. This does not mean the agent
            is gone — the read failed. Reload to try again.
          </p>
          <p className="mt-3 text-sm"><BackLink fallback="/workflows" label="Back to your agents" /></p>
        </div>
      </main>
    );
  }

  const detail = detailResult.status === 'ready' ? detailResult.detail : null;
  const workflow = detail?.workflow ?? null;

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

  // Schedules, this agent's runs (same colored-todo machinery as Home), and the
  // judge policy all arrived in the envelope — mapped through the SAME helpers
  // the old per-source reads used (buildInboxItems, mapActivationChecklist), so
  // each tab shows exactly what it showed before.
  const agentRuns = detail!.runs;
  const judgePolicy = detail!.judgePolicy;
  const routines: Routine[] = detail!.routines;
  // The routine to Pause/Resume from the header (the live one, if any).
  const pausableRoutine = routines.find((r) => (r.status === 'active' || r.status === 'paused') && isPausableRoutine(r)) || null;
  // The routine the inline ScheduleManager edits: the live clock if any (regardless
  // of status, so a 'failed' one is still editable), else null → on-demand agent.
  const scheduleRoutine = pausableRoutine || routines.find((r) => isPausableRoutine(r)) || null;

  // Connection health for THIS agent (envelope-scoped — the full-roster
  // /me/connections read is gone from this page).
  //
  // UNAVAILABLE IS NOT HEALTHY. An unreadable connection registry produces the
  // same empty warning list as a genuinely healthy agent, so silence here used
  // to mean "we checked and it's fine" when it actually meant "we never got to
  // look". The two now render differently and the unreadable one blocks the
  // run actions that depend on a reachable account.
  const connWarnings = detail!.connectionWarnings;
  const connectionsUnavailable = detail!.isUnavailable('connections');
  // Same problem, worse consequence: a checklist we could not read used to
  // fall through to `checklist === null`, which the Activate/Run controls treat
  // as "not in your library yet" and render as an actionable Activate button.
  // That offers to activate an agent whose readiness nobody verified.
  const activationUnavailable = detail!.isUnavailable('activation');
  const judgeUnavailable = detail!.isUnavailable('judge_policy');
  const gradeUnavailable = detail!.isUnavailable('grade');
  // Same class again: an unreadable run list renders as "No runs yet" and an
  // unreadable schedule list as "runs on demand". Both are assertions about
  // this agent that the failed read cannot support.
  const runsUnavailable = detail!.isUnavailable('runs');
  const schedulesUnavailable = detail!.isUnavailable('schedules');
  // Any section whose failure makes the primary action unsafe to offer.
  const actionsBlocked = activationUnavailable || connectionsUnavailable;
  const safety = remoteSafety(workflow);
  const boundCount = workflow.steps.filter((s) => s.ref && !s.gap).length;

  // Activation state drives the primary action: Activate (not yet on) vs Run now
  // (queues a run-request that Claude Code picks up). Null (agent not in the
  // user's library yet) falls back to the Activate path.
  const checklist = detail!.checklist;
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
  // The envelope carries the RAW rows (same 12h window / kinds / statuses the
  // page used to query itself); the derivation — the truth — stays here,
  // unchanged. A missing lifecycle section falls back to the Run-now defaults,
  // exactly like the old catch block.
  if (detail!.lifecycle) {
    const reqRows = detail!.lifecycle.requests;
    revisePending = isRevisePending(reqRows, newestVersionAt(workflow.versions));
    const runReq = reqRows.find((r) => r.kind === 'run' || r.kind === 'continue');
    if (runReq) inFlight = runReq.status === 'consumed' ? 'running' : 'queued';
    if (!inFlight && detail!.lifecycle.runningRun) inFlight = 'running';
  }

  // ── tab panels (server-rendered, handed to the client tab shell) ──

  // What the user needs on their side before running (paid services + the free
  // tools we auto-install), derived from the agent's steps.

  // The proof-layer grade (run_outcome_ledger, 0091), from the envelope. The
  // backend applies the same owner/public visibility the /me/agents roster read
  // used to (private for roster agents, min-N-gated public otherwise) — for ONE
  // slug, without computing the roster. Null when there isn't a real grade yet —
  // the page still refuses to flatter a thin history.
  const grade = detail!.grade;

  // Chain detection + "add a step" candidates. A chain = ≥2 workflow-ref steps.
  // For one, offer to extend it (the cycle-checked path): the user's OTHER agents,
  // minus this chain and the agents already in it. Only fetched when it's a chain.
  const chainHopSlugs = new Set(
    workflow.steps.filter((s) => s.kind === 'workflow' && s.ref?.slug).map((s) => s.ref!.slug),
  );
  const isChain = chainHopSlugs.size >= 2;
  let chainCandidates: Array<{ slug: string; source: string; name: string }> = [];
  if (isChain) {
    // Chain-only extra read; passes the session token so the helper does not
    // re-run getSession().
    const mine = await listMyWorkflows(session.access_token);
    chainCandidates = mine
      .filter((w) => w.slug !== workflow.slug && !chainHopSlugs.has(w.slug))
      .map((w) => ({ slug: w.slug, source: w.source, name: w.name }));
  }

  // WHICH TAB — resolved server-side from ?tab= (deep links preserved), with a
  // safe fallback to Overview. Only this panel's tree is built and serialized;
  // the other two used to ride every page view even though one tab is visible.
  const tabKeys = ['overview', 'runs', 'setup'];
  const activeTab = searchParams.tab && tabKeys.includes(searchParams.tab) ? searchParams.tab : 'overview';

  const overviewPanel = () => (
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
        {schedulesUnavailable ? (
          // NOT the on-demand state. ScheduleManager REPLACES any existing
          // routine on save, so offering the editor over an unread schedule
          // list invites the user to overwrite a cadence we failed to show
          // them. Say so and withhold the control instead.
          <p role="status" className="text-sm text-ink-300">
            Schedule unavailable — we could not read whether this agent runs on a clock, so editing is disabled to
            avoid replacing a schedule you cannot see. Reload to try again.
          </p>
        ) : (
          <ScheduleManager slug={workflow.slug} agentName={workflow.name} routine={scheduleRoutine} />
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

  const runsPanel = () => runsUnavailable ? (
    // NOT the empty state: we did not read the history, so we cannot say it is
    // empty. The old empty state ("No runs yet") is a factual claim.
    <div role="status" className="card p-6 text-center">
      <p className="text-ink-100 font-medium">Run history unavailable</p>
      <p className="text-ink-400 text-sm mt-1">
        We could not load this agent’s runs. This is not the same as having none — reload to try again.
      </p>
    </div>
  ) : agentRuns.length === 0 ? (
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

  const setupPanel = () => (
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
            statusUnavailable={actionsBlocked}
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
                statusUnavailable={actionsBlocked}
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

        {/* A section we could not read says so, in the place its answer would
         * have gone. Silence here is what made an unread check look like a
         * passed one. */}
        {(actionsBlocked || judgeUnavailable || gradeUnavailable || runsUnavailable || schedulesUnavailable) && (
          <div role="status" className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3">
            <div className="text-sm font-semibold text-ink-100">Some status could not be loaded</div>
            <ul className="mt-1 space-y-0.5 text-sm text-ink-300">
              {activationUnavailable && (
                <li>Setup and readiness status unavailable — we could not check what this agent still needs.</li>
              )}
              {connectionsUnavailable && (
                <li>Connection status unavailable — we could not check whether its accounts are signed in.</li>
              )}
              {judgeUnavailable && <li>Judge policy unavailable — whether a second model reviews this agent is unknown.</li>}
              {gradeUnavailable && <li>Track record unavailable — this is not the same as having no runs.</li>}
              {runsUnavailable && <li>Run history unavailable — the Runs tab is not showing an empty history, it is showing none.</li>}
              {schedulesUnavailable && <li>Schedule unavailable — we could not read whether this agent runs on a clock.</li>}
            </ul>
            <p className="mt-2 text-xs text-ink-400">
              {actionsBlocked
                ? 'Running is paused until this loads, because starting a run depends on it. Reload to try again.'
                : 'Reload to try again.'}
            </p>
          </div>
        )}

        <AgentTabs
          tabs={tabs}
          active={activeTab}
          panel={activeTab === 'runs' ? runsPanel() : activeTab === 'setup' ? setupPanel() : overviewPanel()}
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
