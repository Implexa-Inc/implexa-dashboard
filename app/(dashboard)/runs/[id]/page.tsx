/**
 * /runs/[id] — clean permalink for ONE run's deliverable.
 *
 * Where Implexa's "ready to review" links land (record_scheduled_run →
 * implexa://runs/<id>, web fallback https://app.implexa.ai/runs/<id>). Unlike
 * the Results overlay (which only knows the recent feed), this RLS-fetches ANY
 * run by id, so a deep link to an older run still resolves. Renders the
 * deliverable as MARKDOWN (the overlay's look), not a raw <pre> dump — the old
 * page showed the slug + raw source, which is the "ugly page" the founder hit.
 *
 * RLS-scoped: a run that isn't the caller's resolves to null and renders a
 * friendly not-found rather than leaking.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import { getWorkspaceRoot } from '@/lib/run-env';
import RunMarkdown from '../../_components/run-markdown';
import { desktopAppLive, appRunUrl } from '@/lib/app-links';
import { getWorkflow, getMyWorkflow } from '@/lib/workflow-catalog';
import { deriveRunState, runLiveness, type RunRow, type RunProgress, type RunStep } from '@/lib/run-state';
import RunStepChecklist from '../../_components/run-step-checklist';
import { RunStateBadge } from '../../_components/run-state-badge';
import { RunVerificationBadge, type VerificationStatus } from '../../_components/run-verification-badge';
import BackLink from '../../_components/back-link';
import OpenInAppPrompt from '../../_components/open-in-app-prompt';
import NotInApp from '../../_components/not-in-app';
import RunActions from '../../_components/run-actions';
import RunContinueBox from '../../_components/run-continue-box';
import RunActionItems, { type RunActionItem } from '../../_components/run-action-items';
import FinishRunButton from '../../_components/finish-run-button';
import GrantPermissionsButton from '../../_components/grant-permissions-button';
import StuckRunButton from '../../_components/stuck-run-button';
import RunShareButton from '../../_components/run-share-button';
import ClearAlertButton from '../../_components/clear-alert-button';
import NextAgentCards, { type Recommendation } from '../../_components/next-agent-cards';
import RunFeedback, { type FeedbackQuestion } from '../../_components/run-feedback';
import MakeRecurring from '../../_components/make-recurring';
import RunChainSuggestions from '../../_components/run-chain-suggestions';
import { EngineOverrideBanner } from '../../_components/engine-override-banner';
import { FinalizeRecoveredButton } from '../../_components/finalize-recovered-button';
import { deriveRecoveredWork } from '@/lib/run-recovery';
import { RunJudgmentCard, type JudgeRepairRequest, type RunJudgment } from '../../_components/run-judgment-card';
import { RunJudgmentPending } from '../../_components/run-judgment-pending';

export const dynamic = 'force-dynamic';

// A held deliverable that names a step the AGENT runs ON APPROVAL (render/publish/
// deploy) → "Approve & finish". Otherwise it's deliver-only ("posted by hand",
// a draft you act on) → "Mark as done". Intentionally STRICT (deferred-work phrases,
// not generic "post"/"publish" mentions) so a draft you post yourself isn't mistaken
// for agent work. Shared verbatim with the inbox overlay's detection.
// Phrasings that mean "this run is HELD before a consequential/costly step it runs
// ON APPROVAL" → show "Approve & finish" (fire the step), not "Mark as done" (which
// would discard it). Tested against markdown with emphasis stripped (see below), so
// "held *before*" / "approve to **fire**" still match. Kept specific to approval-gated
// ACTIONS (not delivery destinations) so a deliver-only draft never false-matches.
const SHIP_STEP_RE = /\b(to ship|on approval|approve to (?:render|publish|post|deploy|fire|generate|assemble|send|spend|run)|approve (?:&|and) (?:ship|finish|render|fire)|approve before|held before|before (?:any )?(?:runway|heygen)\b|ready[- ]to[- ]fire|then \(expensive\)|final approval)/i;

// A run that stopped MID-PIPELINE leaves the remaining steps in its own notes — a
// "What happens next / To finish / blocked on …" heading, or explicit "remaining /
// still to do / blocked on" phrasing. When a DELIVERED (not-held) run looks like
// this, we offer a one-tap "Finish this run" (founder: "I have no clue how to
// continue"). Markdown emphasis stripped so "**blocked**" still matches.
const PARTIAL_RUN_RE = /(^|\n)#{0,4}\s*[^\n]*\b(what happens next|to finish|to complete|remaining steps?|still (?:to do|needed|left)|blocked on|drops? (?:straight )?into step|the moment the .* (?:exists|is ready))\b/i;

// The agent was caught needing browser / computer-use access it doesn't have on
// this Mac — the pre-flight check (backend prompts) records this exact-style
// message instead of letting the run hang on an ungranted-permission dialog. We
// detect it and offer a one-click "Grant browser access" that opens Claude with
// a grant-only prompt (NOT a trip to onboarding).
const NEEDS_BROWSER_GRANT_RE = /Needs browser access on this Mac|grant Computer Use|Screen Recording \+ Accessibility|the browser is unavailable/i;

// A run that closed with NO deliverable used to just say "No deliverable recorded
// for this run." — a dead end with zero diagnosis (founder testing hit this on a
// run the A0 watchdog force-closed after 4h of total silence: a bare red "Failed",
// no reason, no next step). run_close_reason (mig 0101) already carries the real
// answer; this turns it into plain language instead of making the user go hunting
// in Runs for an explanation we already have. NULL = a voluntary close (the agent's
// own output IS the explanation) -> no message here.
function closeReasonMessage(reason: string | null): string | null {
  switch (reason) {
    case 'silence_ceiling_forced':
      return "It went silent for a long time with no update, so Implexa stopped it automatically. It's safe to run again.";
    case 'orphaned_parent_gone':
      return 'Its routine was paused or removed while it was still running, so Implexa closed it automatically.';
    case 'exit_code_nonzero':
      return 'The process exited with an error.';
    case 'exit_signal':
      return 'The process was terminated (killed) before it could finish.';
    case 'exit_timeout':
      return 'It ran past its time limit and was stopped.';
    case 'exit_clean_no_completion_signal':
      return 'The process exited without ever reporting whether it finished.';
    default:
      return null;
  }
}

function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function rel(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id, email')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const { data: run } = await supabase
    .from('skill_runs')
    .select('id, scheduled_skill_id, orchestration_id, skill_slug, source, output_markdown, status, duration_ms, delivery, review_status, ran_at, run_state, started_at, last_progress_at, completed_at, expected_duration_ms, stalled_at')
    .eq('id', params.id)
    .maybeSingle();

  const r = run as RunRow | null;

  if (!r) {
    // RLS didn't return it. Ask the backend (privacy-safe) whether it exists at
    // all: if it does, it's under a DIFFERENT Implexa account than the one
    // signed in (the cross-account footgun: agents run under whichever account
    // is connected in your Claude, which may not be the one you're browsing as).
    let existsElsewhere = false;
    try {
      const res = await callBackend(`/api/v2/runs/${encodeURIComponent(params.id)}/exists`, { jwt: session.access_token });
      existsElsewhere = !!res?.exists && !res?.mine;
    } catch { /* fall back to the generic message */ }

    return (
      <main className="min-h-screen px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <BackLink fallback="/overview" label="Home" className="text-xs text-ink-500 hover:text-ink-200 inline-flex items-center gap-1.5" />
          {existsElsewhere ? (
            <div className="card mt-4 text-sm text-ink-300">
              <p className="font-medium text-ink-100 mb-1">This run is in a different Implexa account.</p>
              <p className="leading-relaxed">
                You&apos;re signed in as <span className="text-ink-100">{profile.email}</span>, but this run lives under another account.
                Your agents and their runs belong to whichever account is connected to your Claude or Codex, so open the dashboard signed in with that account to see it.
              </p>
              <form action="/auth/signout" method="POST" className="mt-3">
                <button className="text-sm font-medium rounded-md px-3.5 py-2 bg-brand-500/15 text-brand-600 dark:text-brand-400 hover:bg-brand-500/25 transition-colors">
                  Sign out to switch account
                </button>
              </form>
            </div>
          ) : (
            <div className="card mt-4 text-sm text-ink-300">
              <p className="font-medium text-ink-100 mb-1">Run not found.</p>
              <p>This run doesn&apos;t exist (it may have been deleted). See your{' '}
                <Link href="/overview" className="text-brand-500 hover:underline">home</Link>.</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  let executionContext: { executor?: 'claude' | 'codex'; thread_id?: string | null; workspace?: string | null } | null = null;
  try {
    const { data } = await supabase.from('run_execution_contexts')
      .select('executor, thread_id, workspace').eq('run_id', r.id).maybeSingle();
    executionContext = data || null;
  } catch { /* pre-migration run: use the legacy Claude recovery path */ }

  // Engine-pin override disclosure (2026-07-18 review, Stage C #3 — deterministic,
  // not a model instruction). original_preference (migration 0119) and
  // selected_executor live on the run_requests row this run was claimed from, not
  // on skill_runs itself — joined by run_id. Best-effort: 0118/0119 may not be
  // applied yet (same class as 0116/0117), or this run predates the whole reroute
  // mechanism (no run_requests row at all, e.g. a manual/legacy insert) — the
  // banner component itself renders nothing when the fields are absent, so a
  // degraded fetch here is silently safe, never a broken page.
  let engineRouting: { original_preference?: string | null; selected_executor?: string | null; selection_reason?: string | null } | null = null;
  try {
    const { data } = await supabase.from('run_requests')
      .select('original_preference, selected_executor, selection_reason').eq('run_id', r.id).maybeSingle();
    engineRouting = data || null;
  } catch { /* 0118/0119 not applied yet, or no run_requests row for this run — banner just stays hidden */ }

  // Resolve the agent this run belongs to. Used to have been a .find() over the
  // full listWorkflows() catalog — but that catalog is heavily cached (1h) and,
  // more importantly, is the PUBLIC-ish list; a private/unproven/just-generated
  // agent (the founder's own tax-return agent, minutes old) never appears in it,
  // so `wf` silently came back undefined and the run title fell back to plain
  // (non-clickable) text — the exact bug the founder hit. Mirrors the agent
  // page's own resolution: try the public read first, then the caller's OWN
  // (private) workflows, same as workflows/[slug]/page.tsx does.
  let wf: Awaited<ReturnType<typeof getWorkflow>> = null;
  try {
    wf = (await getWorkflow(r.skill_slug)) || (await getMyWorkflow(r.skill_slug));
  } catch { /* best-effort — title/agent-link simply falls back to plain text */ }
  const name = wf?.name || humanize(r.skill_slug);
  const pending = r.review_status === 'pending';        // shippable deliverable → Approve & finish
  const needsInput = r.review_status === 'needs_input'; // blocked on a question → Continue only
  const held = pending || needsInput;

  // Live step trace (migration 0080): each entry is a note the run reported at a
  // step boundary. For a stalled run, the last entry is WHERE it got stuck.
  // Fetched defensively in its OWN query so a pre-migration schema (no progress
  // column) can never turn the whole run fetch into a 42703 error — this page
  // hard-fails to "not found" on a select error, and we must not regress that.
  let progress: RunProgress | null = null;
  try {
    const { data: pr } = await supabase
      .from('skill_runs').select('progress').eq('id', params.id).maybeSingle();
    progress = ((pr as { progress?: RunProgress } | null)?.progress) ?? null;
  } catch { /* column not present yet — trace simply doesn't render */ }
  const steps = progress?.history ?? [];

  // Live per-step checklist (migration 0089): the canonical done/running/pending
  // list for a chain/workflow run, distinct from the free-text trace above. Same
  // defensive own-query pattern as `progress` — a pre-migration schema (no
  // steps_state column) must never 42703 the whole page.
  let stepsState: RunStep[] = [];
  try {
    const { data: ss } = await supabase
      .from('skill_runs').select('steps_state').eq('id', params.id).maybeSingle();
    const raw = (ss as { steps_state?: RunStep[] } | null)?.steps_state;
    if (Array.isArray(raw)) stepsState = raw as RunStep[];
  } catch { /* column not present yet — checklist simply doesn't render */ }

  // Has a DIFFERENT automatic recovery already delivered the real answer for
  // this run? (2026-07-24 fix.) A successfully-recovered run's PARENT row stays
  // stalled/failed with an empty output_markdown forever — its heartbeat is
  // refused once superseded — so without this check it would look perpetually
  // "recoverable" here even though the continuation already did the real work.
  // Same defensive own-query pattern as progress/stepsState above.
  let alreadyRecoveredElsewhere = false;
  try {
    const { data: rec } = await supabase
      .from('run_recovery_attempts')
      .select('id').eq('target_run_id', params.id).eq('status', 'recovered').limit(1).maybeSingle();
    alreadyRecoveredElsewhere = !!rec;
  } catch { /* table not present yet — nothing to gate on, the server re-checks anyway */ }

  // Salvage affordance: this run may have DONE the work and died before reporting
  // it (the founder's Remotion render, twice). The server re-checks this AND the
  // already-recovered-elsewhere fact under lock; see lib/run-recovery.ts on why
  // the mirror stays optimistic.
  const recovered = alreadyRecoveredElsewhere
    ? { recoverable: false, looksComplete: false, lastNote: null, stepCount: 0 }
    : deriveRecoveredWork({ runState: r.run_state, outputMarkdown: r.output_markdown, progress, stepsState });

  // Next-agent recommendations (recommendation engine v1, RECOMMENDATION_ENGINE_PLAN
  // §1.5). Fetched defensively in its OWN query — the skill_runs.recommendations
  // jsonb column may not be live yet, and a 42703 here must never break the page
  // (same precedent as `progress` above). Absent column ⇒ no cards.
  let recommendations: Recommendation[] = [];
  try {
    const { data: rec } = await supabase
      .from('skill_runs').select('recommendations').eq('id', params.id).maybeSingle();
    const raw = (rec as { recommendations?: unknown } | null)?.recommendations;
    if (Array.isArray(raw)) recommendations = raw as Recommendation[];
  } catch { /* column not present yet — cards simply don't render */ }

  // Improvement-loop feedback (migration 0074), the same columns lib/inbox.ts
  // loads for the Results overlay. Fetched defensively in its OWN query so a
  // pre-migration schema (no feedback_* columns) can never 42703 the page —
  // absent columns just mean we fall back to the GENERIC_FEEDBACK questions in
  // <RunFeedback>, so every run stays rateable from this permalink too.
  let feedbackQuestions: FeedbackQuestion[] | null = null;
  let feedbackAnswers: Record<string, string> | null = null;
  let feedbackAt: string | null = null;
  try {
    const { data: fb } = await supabase
      .from('skill_runs')
      .select('feedback_questions, feedback_answers, feedback_at')
      .eq('id', params.id)
      .maybeSingle();
    const row = fb as {
      feedback_questions?: FeedbackQuestion[] | null;
      feedback_answers?: Record<string, string> | null;
      feedback_at?: string | null;
    } | null;
    feedbackQuestions = row?.feedback_questions ?? null;
    feedbackAnswers = row?.feedback_answers ?? null;
    feedbackAt = row?.feedback_at ?? null;
  } catch { /* columns not present yet — RunFeedback uses its generic fallback */ }

  // Proposed follow-up actions for this run (run_actions, migration 0090). The
  // structured version of the deliverable's "Holds / Next steps" — surfaced as
  // one-tap buttons at the TOP of the run. Defensive own-query: a pre-migration
  // schema (no run_actions table) must never 42703 the page — absent ⇒ no buttons.
  let runActions: RunActionItem[] = [];
  try {
    const { data: ra } = await supabase
      .from('run_actions')
      .select('id, kind, label, summary, preset_prompt, fulfillment, confirmation_label, readiness, blocker, confidence, status')
      .eq('run_id', params.id)
      .in('status', ['open', 'acting'])
      .order('rank', { ascending: true });
    if (Array.isArray(ra)) runActions = ra as RunActionItem[];
  } catch { /* table not present yet — action buttons simply don't render */ }

  // Completion Controller verdict (migration 0102, skill_runs.verification_status)
  // — did this run actually PRODUCE its deliverable, and with what confidence?
  // Deterministic evidence, not an AI opinion. Same query also grabs
  // run_close_reason (mig 0101) — HOW a run with no output actually ended (a real
  // exit-code failure vs A0's silence-ceiling force-close), so a run that closed
  // with nothing to show can say WHY instead of a dead-end "No deliverable
  // recorded" (founder testing hit this on a watchdog force-close). Defensive
  // own-query: a pre-0101/0102 schema must never 42703 the whole page.
  let verificationStatus: VerificationStatus = null;
  let closeReason: string | null = null;
  try {
    const { data: vr } = await supabase
      .from('skill_runs').select('verification_status, run_close_reason').eq('id', params.id).maybeSingle();
    const row = vr as { verification_status?: VerificationStatus; run_close_reason?: string | null } | null;
    verificationStatus = row?.verification_status ?? null;
    closeReason = row?.run_close_reason ?? null;
  } catch { /* columns not present yet — badge/reason simply don't render */ }

  // Optional model review (0121), intentionally separate from the deterministic
  // Completion Controller above. A missing migration/policy simply renders no card.
  let judgment: RunJudgment | null = null;
  let judgmentPending = false;
  let repairRequest: JudgeRepairRequest | null = null;
  try {
    const { data: jr } = await supabase.from('run_judgments')
      .select('id, verdict, summary, criteria_results, evidence_refs, paths_taken, next_action, repair_prompt, repair_round, repair_limit, worker_executor, worker_model, judge_executor, judge_model, deterministic_verification, created_at, feedback')
      .eq('run_id', params.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    judgment = (jr as RunJudgment | null) || null;
  } catch { /* 0121 not applied, or no judgment — keep the run page intact */ }
  if (judgment?.id && judgment.verdict === 'repair') {
    try {
      const { data: rr } = await supabase.from('run_requests')
        .select('status, run_id, created_at').eq('judge_origin_judgment_id', judgment.id).limit(1).maybeSingle();
      repairRequest = (rr as JudgeRepairRequest | null) || null;
    } catch { /* 0122 not applied, or queue failed — the manual Continue fallback stays visible */ }
  }
  // 'cancelled' is included alongside pending/consumed so the client can tell a
  // request that is genuinely still in flight apart from one that will NEVER
  // produce a verdict — without this, a cancelled request looked identical to
  // an active one and the page had no way to stop showing "reviewing".
  let judgeRequestStatus: 'pending' | 'consumed' | 'cancelled' | null = null;
  let judgeRequestCreatedAt: string | null = null;
  if (!judgment) {
    try {
      // created_at is fetched so the client can stop polling on its own after a
      // reasonable ceiling, even if the underlying request never reaches a
      // terminal status — a worker session that crashes right after CLAIMING
      // the request (consumed) but before ever calling recordJudgment leaves it
      // stuck there with no failure marker at all (run_requests has no
      // 'failed' status), and without a deadline the browser would refresh
      // every 20s forever.
      const { data: jq } = await supabase.from('run_requests')
        .select('status, created_at').eq('judge_target_run_id', params.id)
        .in('status', ['pending', 'consumed', 'cancelled']).order('created_at', { ascending: false }).limit(1).maybeSingle();
      judgmentPending = !!jq;
      judgeRequestStatus = (jq && jq.status) || null;
      judgeRequestCreatedAt = (jq && jq.created_at) || null;
    } catch { /* 0121 not applied — no pending state */ }
  }

  const agentHref = wf
    ? `/workflows/${encodeURIComponent(r.skill_slug)}?source=${encodeURIComponent(wf.source)}`
    : `/workflows/${encodeURIComponent(r.skill_slug)}`;

  // The routine's Claude task id (when this agent has a live schedule) powers the
  // "Open the routine in Claude" deep link + the "Continue in Claude" handoff that
  // lets the user actually resume a run paused at a human-approval gate. We also
  // read the routine's STATUS so a paused routine's leftover running/stalled row
  // renders as a quiet "Paused" rather than a loud "This run stalled" card.
  // Prefer the run's own parent routine (scheduled_skill_id); fall back to the
  // agent's schedule by slug for legacy rows that predate scheduled_skill_id.
  const schedQuery = supabase
    .from('scheduled_skills')
    .select('claude_task_id, status, destination, post_run_action')
    .limit(1);
  const { data: schedRows } = r.scheduled_skill_id
    ? await schedQuery.eq('id', r.scheduled_skill_id)
    : await schedQuery.eq('skill_slug', r.skill_slug);
  const claudeTaskId = schedRows?.[0]?.claude_task_id || null;
  const routinePaused = schedRows?.[0]?.status === 'paused';

  // Does APPROVING trigger DEFERRED AGENT WORK it does itself (render/publish/deploy
  // on approval) vs is it DELIVER-ONLY (a draft/brief the human acts on — "posted by
  // hand")? Drives the held-run primary: "Approve & finish" (queue a continue so the
  // agent does that work) vs "Mark as done" (just close — no pointless "all done"
  // run). DEFAULT deliver-only; flip to ship ONLY on a strong signal — an auto
  // post_run_action, or the deliverable explicitly naming a step it runs ON APPROVAL.
  // (A delivery destination like email/dashboard/slack is NOT a ship step — it just
  // sends you the result; treating it as ship made HN drafts queue a dead continue.)
  const hasShipStep =
    !!schedRows?.[0]?.post_run_action ||
    (!!r.output_markdown && SHIP_STEP_RE.test(r.output_markdown.replace(/[*_`]/g, '')));

  // On-demand detection for the "make it recurring" nudge: does this agent have
  // ANY recurring (cron) schedule on the books (active or paused)? If not, it
  // only ever runs when the user kicks it off — so once a run finishes cleanly
  // we offer to put it on a clock. Defensive own-query (pre-cron-column schemas
  // must never 42703 the page); on any error we simply don't show the nudge.
  let isOnDemand = false;
  try {
    const { data: cronRows } = await supabase
      .from('scheduled_skills')
      .select('id')
      .eq('skill_slug', r.skill_slug)
      .not('cron_expression', 'is', null)
      .neq('status', 'deleted')
      .limit(1);
    isOnDemand = (cronRows?.length ?? 0) === 0;
  } catch { /* can't tell → don't nudge */ }

  const info = deriveRunState({ ...r, routine_paused: routinePaused });

  // This run has NOTHING to show. The real explanation often already exists on a
  // SIBLING run for the same agent — a retry that completed, OR (the case the
  // founder hit) an earlier/later run that self-explained why it stopped (e.g.
  // "Held for you to run attended — not safe to do hands-off") while THIS row
  // just silently timed out with zero output. Surface it inline so the user isn't
  // left confused across two runs of the same agent that tell two different
  // stories. Triggers whenever this run has no output AND either looks broken
  // (info.attention) or has a KNOWN close reason (closeReason) — matching the
  // amber box's own condition below, so the two always show together. The query
  // deliberately does NOT require run_state='completed': a sibling that's ALSO
  // technically 'failed' but wrote a real explanation is exactly what's useful
  // here — output_markdown being non-null is the only signal that matters.
  // Defensive own-query; never regress the page to "not found" on error.
  let siblingRun: { id: string; review_status: string | null; run_state: string | null } | null = null;
  if ((info.attention || closeReason) && !r.output_markdown) {
    try {
      let q = supabase
        .from('skill_runs')
        .select('id, review_status, run_state')
        .neq('id', r.id)
        .not('output_markdown', 'is', null)
        // MUST be a run that EXPLAINS A STOP, never a prior SUCCESS (2026-07-23
        // incident). Without this, a broken Continue with no output linked to the
        // agent's last GOOD run — so "view the reason" opened a completed
        // deliverable and implied the work had happened. It hadn't. A completed
        // run's output is a deliverable, not an explanation of why THIS run
        // stopped; only a non-completed sibling can be that.
        .neq('run_state', 'completed')
        .order('ran_at', { ascending: false })
        .limit(1);
      q = r.scheduled_skill_id
        ? q.eq('scheduled_skill_id', r.scheduled_skill_id)
        : q.eq('skill_slug', r.skill_slug);
      const { data: sib } = await q;
      siblingRun = (sib?.[0] as { id: string; review_status: string | null; run_state: string | null } | undefined) ?? null;
    } catch { /* defensive — link simply doesn't render */ }
  }

  // The run's workspace root powers clickable file paths in the deliverable
  // (resolve a relative `reels/day-18/` to an absolute path the desktop bridge
  // can open / Finder can reveal). Unknown → <FilePathCode> copies the relative
  // path instead. Best-effort; never blocks the page.
  const workspaceRoot = await getWorkspaceRoot(session.access_token);

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <BackLink fallback="/overview" label="Home" className="text-xs text-ink-500 hover:text-ink-200 inline-flex items-center gap-1.5" />

        {/* web→app handoff: the https email link lands here; offer the bounce into
            the desktop app. Dormant until the app ships (desktopAppLive). */}
        {desktopAppLive() && (
          <NotInApp>
            <div className="mt-4">
              <OpenInAppPrompt runId={r.id} />
            </div>
          </NotInApp>
        )}

        <header className="mt-4 mb-6">
          {/* The title itself is the primary way back to the agent now (founder
              ask: the small "open agent" text link below was too easy to miss).
              The Link lives INSIDE the h1 so the page keeps its heading landmark
              either way; only wrap it in a Link when we actually know the agent
              (wf) so we never link to a workflow we couldn't resolve. */}
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50">
            {wf ? (
              <Link
                href={`/workflows/${encodeURIComponent(r.skill_slug)}?source=${encodeURIComponent(wf.source)}`}
                className="hover:underline"
              >
                {name}
              </Link>
            ) : name}
          </h1>
          <div className="flex items-center gap-2.5 mt-2 flex-wrap">
            <RunStateBadge info={info} size="xs" />
            <RunVerificationBadge status={verificationStatus} size="xs" />
            <span className="text-xs text-ink-500">{rel(r.ran_at)}</span>
            <span className="text-xs text-ink-600 font-mono">{r.skill_slug}</span>
            {desktopAppLive() && (
              <NotInApp>
                <a href={appRunUrl(r.id)} className="text-xs text-brand-500 hover:underline">
                  open in the Implexa app ↗
                </a>
              </NotInApp>
            )}
          </div>
        </header>

        <EngineOverrideBanner
          originalPreference={engineRouting?.original_preference}
          selectedExecutor={engineRouting?.selected_executor}
          selectionReason={engineRouting?.selection_reason}
        />

        <RunJudgmentCard judgment={judgment} repairRequest={repairRequest} currentRunId={r.id} />
        {judgmentPending && <RunJudgmentPending requestStatus={judgeRequestStatus} createdAt={judgeRequestCreatedAt} />}
        {judgment?.verdict === 'repair' && ['pending', 'consumed'].includes(repairRequest?.status || '') && (
          <RunJudgmentPending phase="repair" requestStatus={(repairRequest?.status as 'pending' | 'consumed') || null} createdAt={repairRequest?.created_at || null} />
        )}

        {/* Share — prominent on ANY completed run with a deliverable, so the owner
            can turn it into a public, forkable Run Card without hunting (founder
            ask). Amber + share icon. The detailed URL/copy state expands in place. */}
        {r.run_state === 'completed' && r.output_markdown && (
          <div className="mb-6">
            <RunShareButton runId={r.id} />
          </div>
        )}

        {/* The ONE action surface for a held run — context-aware primary (Approve &
            finish / Mark as done / Answer & continue), Request-changes on demand, a
            quiet Dismiss, and power-user escapes under "⋯". Replaces the old banner +
            Approve & finish + Mark done + always-open Continue box + Hide/Dismiss pile. */}
        {held && (
          <div className="mb-6">
            <RunActions
              runId={r.id}
              agentName={name}
              reviewStatus={pending ? 'pending' : 'needs_input'}
              hasShipStep={hasShipStep}
              claudeTaskId={claudeTaskId}
              skillSlug={r.skill_slug}
            />
          </div>
        )}

        {/* Caught needing browser / computer-use access → one-click "Grant browser
            access" that opens Claude with a grant-only prompt (it pops the macOS
            permission dialog + pairs Chrome), instead of bouncing to onboarding. */}
        {!!r.output_markdown && NEEDS_BROWSER_GRANT_RE.test(r.output_markdown) && (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] p-4">
            <p className="text-sm font-medium text-ink-100">This run needed browser or screen access it didn&apos;t have here</p>
            {/* Deliberately does NOT claim the Chrome extension is ungranted — it
                often IS connected (the run says so), and asserting otherwise
                misled the founder. The real gap is usually Computer Use, or the
                run happening unattended in the background. Offer BOTH fixes. */}
            <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
              A step here drives a browser or your screen, and that wasn&apos;t fully available in this run — usually
              because Computer Use (Screen Recording + Accessibility) isn&apos;t granted yet, or it ran unattended in the
              background. Grant it once and re-run, or run it from the app while you&apos;re at your desk. Implexa never
              sees your logins.
            </p>
            <div className="mt-3">
              <GrantPermissionsButton />
            </div>
            <p className="mt-2 text-xs text-amber-700/80 dark:text-amber-300/70">
              Click → Implexa opens Claude with a pre-filled prompt → press Enter → Claude asks for permissions →
              choose &quot;Always Allow&quot; (preferred). Or just re-run it attended from the agent page.
            </p>
          </div>
        )}

        {/* Non-held alert (stalled / failed) has no approval to act on — just the
            quiet "hide from alerts" (the retry CTA lives in the deliverable block). */}
        {!held && (info.attention || info.state === 'failed') && (
          <div className="mb-6">
            <ClearAlertButton runId={r.id} pending={false} />
          </div>
        )}

        {/* Proposed follow-up actions (run_actions, 0090) — the one-tap "what's
            next" for a DELIVERED run (publish / approve render / …). Held runs use
            RunActions above; this is for the delivered-with-next-steps case the
            founder flagged (a run that shipped real follow-ups but went silent). */}
        {!held && runActions.length > 0 && (
          <div className="mb-6">
            <RunActionItems runId={r.id} actions={runActions} />
          </div>
        )}

        {/* "Finish this run" — a DELIVERED run that clearly stopped mid-pipeline
            (its notes list remaining/blocked steps) gets a one-tap finish, so the
            user never has to read prose to figure out how to continue. Suppressed
            when the run already surfaced granular run_actions (no double CTA). */}
        {!held && r.run_state === 'completed' && !!r.output_markdown &&
          runActions.length === 0 &&
          PARTIAL_RUN_RE.test(r.output_markdown.replace(/[*_`]/g, '')) && (
          <div className="mb-6">
            <FinishRunButton runId={r.id} />
          </div>
        )}

        {/* Live per-step checklist: which of the chain's steps are done / running
            / pending, updating on poll while in flight. Only when the run reported
            structured step state (a chain/workflow via record_run_heartbeat). */}
        {(stepsState.length > 0 || info.state === 'running') && (
          <RunStepChecklist runId={r.id} initialSteps={stepsState} live={info.state === 'running'} />
        )}

        {/* Live step trace: where the run is / where it got stuck. Only when the
            run reported step notes (on-demand + long runs via record_run_heartbeat). */}
        {steps.length > 0 && (
          <div className="mb-6 rounded-lg border border-ink-800 bg-ink-950/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-ink-300">Step trace</span>
              {info.state === 'running' && (
                <span className="text-[10px] uppercase tracking-wide font-semibold text-sky-700 dark:text-sky-300 bg-sky-500/15 rounded px-1.5 py-0.5">live</span>
              )}
            </div>
            <ol className="space-y-2">
              {steps.map((e, i) => {
                const isLast = i === steps.length - 1;
                const dot = isLast && info.attention
                  ? 'bg-amber-500 dark:bg-amber-400'
                  : isLast && info.state === 'running'
                    ? 'bg-sky-500 dark:bg-sky-400'
                    : 'bg-ink-600';
                return (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className={`mt-[7px] h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      {e.step && <span className="font-mono text-xs text-ink-500 mr-1.5">{e.step}</span>}
                      <span className="text-ink-200">{e.note || 'progress'}</span>
                      <span className="text-ink-600 text-xs ml-2">{rel(e.at)}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
            {info.state === 'stalled' && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-3 leading-relaxed">
                Stuck here. This is the last step it reported before it stopped making progress.
              </p>
            )}
          </div>
        )}

        {r.output_markdown ? (
          <>
            <div className="prose prose-sm max-w-none rounded-lg border border-ink-800 bg-ink-950/60 p-5">
              <RunMarkdown markdown={r.output_markdown} workspaceRoot={workspaceRoot} />
            </div>
            {/* (Share moved to the top of the run view — see the amber "Share this
                run" button under the header. The growth-loop Run Card lives there.) */}
          </>
        ) : (info.attention || closeReason) ? (
          // A stalled/failed run has no deliverable. Don't dead-end at a blank
          // "no deliverable" line: say what happened + give the one action. This
          // also fires for a run that A0's watchdog force-closed (run_close_reason
          // set) even when info.attention is false — the exact case that used to
          // render a bare, unexplained "Failed" with nothing else on the page.
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-5">
            <div className="text-sm font-semibold text-ink-50 mb-1">
              {info.label === 'Failed' ? 'This run did not finish' : 'This run stalled'}
            </div>
            <p className="text-sm text-ink-300 leading-relaxed">{closeReasonMessage(closeReason) ?? info.reason}</p>
            {info.permissionBlocked && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2 leading-relaxed">
                It was blocked on a permission it could not auto-approve (often a file write or a tool outside the
                pre-approved set). Open the agent, grant it on the setup card, then run it again.
              </p>
            )}
            {siblingRun && (
              <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/[0.07] px-3 py-2.5 text-sm">
                {/* Honest lead-in: only call it "good news" when the sibling is an
                    actual clean success. A held run (needs_input/pending) or a
                    sibling that's ALSO failed but wrote a real explanation (the
                    founder's exact confusion — one silent timeout next to another
                    run of the same agent that self-explained why it stopped) gets
                    neutral framing instead of a false "finished" claim. */}
                <span className="text-ink-200">
                  {siblingRun.review_status === 'needs_input' || siblingRun.review_status === 'pending'
                    ? 'This agent has a related run waiting on you — it explains what happened. '
                    : siblingRun.run_state === 'failed'
                      ? 'This agent has a related run with more detail on what happened. '
                      : 'Good news — this agent already has a finished run. '}
                </span>
                <Link
                  href={`/runs/${siblingRun.id}`}
                  className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                >
                  View the run to see the reason{siblingRun.review_status === 'needs_input' || siblingRun.review_status === 'pending' ? ' (needs you)' : ''} →
                </Link>
              </div>
            )}
            {/* The run may have finished its work and died before reporting it —
                the trace above (or the step checklist) is the evidence. Never
                auto-promoted: the user reads it and decides. Withheld entirely
                when a DIFFERENT automatic recovery already delivered the real
                answer for this run (alreadyRecoveredElsewhere) — the server would
                refuse it anyway, but showing the button over a stale trace when
                the real result already exists elsewhere is worse than showing
                nothing. */}
            {recovered.recoverable && (
              <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/[0.07] px-3 py-3">
                <div className="text-sm font-semibold text-ink-100 mb-0.5">Work recovered — review and finalize</div>
                <p className="text-sm text-ink-300 leading-relaxed">
                  This run reported {recovered.stepCount} step{recovered.stepCount === 1 ? '' : 's'} and then stopped
                  without recording a result. If the trace above shows the work finished, you can mark it done.
                </p>
                <div className="mt-3">
                  <FinalizeRecoveredButton runId={r.id} looksComplete={recovered.looksComplete} />
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <StuckRunButton
                engine={executionContext?.executor || 'claude'}
                threadId={executionContext?.thread_id}
                workspace={executionContext?.workspace}
                runId={r.id}
                claudeTaskId={claudeTaskId}
                permissionCapability={info.permissionBlocked ? (NEEDS_BROWSER_GRANT_RE.test(r.output_markdown || '') ? 'computerUse' : 'browser') : null}
              />
              <Link href={agentHref} className="btn-outline text-sm px-4 py-2">Run again</Link>
              <Link href="/overview" className="btn-outline text-sm px-4 py-2">Back to home</Link>
            </div>
          </div>
        ) : r.run_state === 'running' && runLiveness(r).state !== 'alive' ? (
          // A RUNNING run with no deliverable used to fall through to the bare
          // "No deliverable recorded" line below — which is true and useless. The
          // founder sat on this exact page for 20 minutes watching a spinner while
          // the row's own last_progress_at had never moved off started_at (run
          // ec42bac6). We knew. We just didn't say. Say it.
          <div className="rounded-lg border border-ink-800 bg-ink-950/60 p-5">
            <div className="text-sm font-semibold text-ink-50 mb-1">{info.label === 'Not started' ? 'This run has not actually started' : 'No progress reported recently'}</div>
            <p className="text-sm text-ink-300 leading-relaxed">{info.reason}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-400 italic">No deliverable recorded for this run.</p>
        )}

        {/* UNIVERSAL "Continue this run" — a FINISHED run must never dead-end.
            REGRESSION FIX (2026-07-18, founder hit this on a Done+Verified video
            assembly run): <RunActions> consolidated ~10 controls and its comment
            says it "replaces … the always-open Continue box" — but it only renders
            when `held`, so a cleanly-completed run lost EVERY path to iterate. The
            box itself (<RunContinueBox/>) still documented case 3, "iterate on a
            finished run's output", yet was rendered nowhere but the inbox — and the
            inbox only lists runs needing attention, so a finished run appeared in
            neither place. Held runs keep using <RunActions> above (it has its own
            continue); this is its non-held twin, sitting right under the deliverable
            you just read. Failed/stalled runs are already covered by "Run again" +
            <StuckRunButton> in the no-deliverable branch, so this stays scoped to a
            real deliverable and never stacks a second CTA on a failure. */}
        {!held && r.output_markdown && (
          <div className="mt-5">
            <RunContinueBox runId={r.id}
              agentName={name}
              pending={false}
              initialNote={judgment?.verdict === 'repair' ? (judgment.repair_prompt || judgment.next_action || '') : ''}
            />
          </div>
        )}

        {/* Jump to this agent's OTHER runs. A held run often references sibling
            runs ("Day 16/17 are still pending") — make it one click to go act on
            them, instead of Open agent → Runs → hunt for the run. */}
        <div className="mt-4 text-xs">
          <Link
            href={`${agentHref}${agentHref.includes('?') ? '&' : '?'}tab=runs`}
            className="text-ink-400 hover:text-ink-200 inline-flex items-center gap-1.5"
          >
            <span aria-hidden>↩</span> See {name}&apos;s other runs — open one to continue it
          </Link>
        </div>

        {/* Per-run feedback — the same form the Results overlay shows, so a run
            opened from an Active-Agents card / email / Telegram / the calendar is
            rateable right here instead of forcing a detour through the Runs tab.
            Only when there's a deliverable to rate (matches the overlay). */}
        {r.output_markdown && (
          <div className="mt-5 rounded-lg border border-ink-800 bg-ink-900/40 p-4">
            <RunFeedback
              runId={r.id}
              feedbackQuestions={feedbackQuestions}
              feedbackAnswers={feedbackAnswers}
              feedbackAt={feedbackAt}
              heading
              agentSlug={r.skill_slug}
            />
          </div>
        )}

        {/* Make it recurring — once an ON-DEMAND agent delivers a clean result,
            offer to put it on a schedule so it runs hands-off from now on (the
            whole point of Implexa). Only when there's a real deliverable and the
            agent has no recurring schedule yet. */}
        {r.output_markdown && isOnDemand && (
          <MakeRecurring slug={r.skill_slug} agentName={name} />
        )}

        {/* Chain this agent — "this agent's output feeds your weekly SEO agent".
            One tap composes them into a pipeline. Renders nothing when this
            agent isn't part of any suggested chain. */}
        {r.output_markdown && <RunChainSuggestions slug={r.skill_slug} />}

        {/* Next agents to build — the run's own recommendations, right under its
            output (recommendation engine v1). Renders nothing when there are none. */}
        <NextAgentCards runId={r.id} recommendations={recommendations} />
      </div>
    </main>
  );
}
