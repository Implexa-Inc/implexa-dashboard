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
import { listWorkflows } from '@/lib/workflow-catalog';
import { deriveRunState, type RunRow, type RunProgress, type RunStep } from '@/lib/run-state';
import RunStepChecklist from '../../_components/run-step-checklist';
import { RunStateBadge } from '../../_components/run-state-badge';
import { RunVerificationBadge, type VerificationStatus } from '../../_components/run-verification-badge';
import BackLink from '../../_components/back-link';
import OpenInAppPrompt from '../../_components/open-in-app-prompt';
import NotInApp from '../../_components/not-in-app';
import RunActions from '../../_components/run-actions';
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

  const [{ data: run }, catalog] = await Promise.all([
    supabase
      .from('skill_runs')
      .select('id, scheduled_skill_id, orchestration_id, skill_slug, source, output_markdown, status, duration_ms, delivery, review_status, ran_at, run_state, started_at, last_progress_at, completed_at, expected_duration_ms, stalled_at')
      .eq('id', params.id)
      .maybeSingle(),
    listWorkflows(),
  ]);

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

  const wf = catalog.find((c) => c.slug === r.skill_slug);
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
  // Deterministic evidence, not an AI opinion. Defensive own-query: a pre-0102
  // schema must never 42703 the whole page — absent column ⇒ no badge.
  let verificationStatus: VerificationStatus = null;
  try {
    const { data: vr } = await supabase
      .from('skill_runs').select('verification_status').eq('id', params.id).maybeSingle();
    verificationStatus = ((vr as { verification_status?: VerificationStatus } | null)?.verification_status) ?? null;
  } catch { /* column not present yet — badge simply doesn't render */ }

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

  // This run stalled/failed with NOTHING to show. The real result often already
  // exists on a SIBLING run for the same agent (a retry, or a hands-off
  // continuation that produced the deliverable) — surface it inline so the user
  // doesn't have to Open agent → Runs → hunt for it (the exact friction the
  // founder hit). Most-recent completed sibling WITH output, any time (the
  // stalled ghost is often NEWER than the run that actually delivered). Defensive
  // own-query; never regress the page to "not found" on error.
  let siblingRun: { id: string; review_status: string | null } | null = null;
  if (info.attention && !r.output_markdown) {
    try {
      let q = supabase
        .from('skill_runs')
        .select('id, review_status')
        .neq('id', r.id)
        .eq('run_state', 'completed')
        .not('output_markdown', 'is', null)
        .order('ran_at', { ascending: false })
        .limit(1);
      q = r.scheduled_skill_id
        ? q.eq('scheduled_skill_id', r.scheduled_skill_id)
        : q.eq('skill_slug', r.skill_slug);
      const { data: sib } = await q;
      siblingRun = (sib?.[0] as { id: string; review_status: string | null } | undefined) ?? null;
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
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50">{name}</h1>
          <div className="flex items-center gap-2.5 mt-2 flex-wrap">
            <RunStateBadge info={info} size="xs" />
            <RunVerificationBadge status={verificationStatus} size="xs" />
            <span className="text-xs text-ink-500">{rel(r.ran_at)}</span>
            <span className="text-xs text-ink-600 font-mono">{r.skill_slug}</span>
            {wf && (
              <Link
                href={`/workflows/${encodeURIComponent(r.skill_slug)}?source=${encodeURIComponent(wf.source)}`}
                className="text-xs text-brand-500 hover:underline"
              >
                open agent
              </Link>
            )}
            {desktopAppLive() && (
              <NotInApp>
                <a href={appRunUrl(r.id)} className="text-xs text-brand-500 hover:underline">
                  open in the Implexa app ↗
                </a>
              </NotInApp>
            )}
          </div>
        </header>

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
            <p className="text-sm font-medium text-ink-100">This agent needs browser access on this Mac</p>
            <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
              It drives a browser/your screen, but Computer Use (Screen Recording + Accessibility) or the Claude for
              Chrome extension isn&apos;t granted yet — so it froze waiting on a permission. Grant it once and re-run; it
              runs hands-free from then on. Implexa never sees your logins.
            </p>
            <div className="mt-3">
              <GrantPermissionsButton />
            </div>
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
        ) : info.attention ? (
          // A stalled/failed run has no deliverable. Don't dead-end at a blank
          // "no deliverable" line: say what happened + give the one action.
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-5">
            <div className="text-sm font-semibold text-ink-50 mb-1">
              {info.label === 'Failed' ? 'This run did not finish' : 'This run stalled'}
            </div>
            <p className="text-sm text-ink-300 leading-relaxed">{info.reason}</p>
            {info.permissionBlocked && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2 leading-relaxed">
                It was blocked on a permission it could not auto-approve (often a file write or a tool outside the
                pre-approved set). Open the agent, grant it on the setup card, then run it again.
              </p>
            )}
            {siblingRun && (
              <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/[0.07] px-3 py-2.5 text-sm">
                <span className="text-ink-200">Good news — this agent already has a finished run. </span>
                <Link
                  href={`/runs/${siblingRun.id}`}
                  className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                >
                  View the latest result{siblingRun.review_status === 'needs_input' || siblingRun.review_status === 'pending' ? ' (needs you)' : ''} →
                </Link>
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
        ) : (
          <p className="text-sm text-ink-400 italic">No deliverable recorded for this run.</p>
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
