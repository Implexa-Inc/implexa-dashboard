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
import { deriveRunState, type RunRow, type RunProgress } from '@/lib/run-state';
import { RunStateBadge } from '../../_components/run-state-badge';
import BackLink from '../../_components/back-link';
import OpenInAppPrompt from '../../_components/open-in-app-prompt';
import NotInApp from '../../_components/not-in-app';
import RunClaudeActions from '../../_components/run-claude-actions';
import RunContinueBox from '../../_components/run-continue-box';
import ClearAlertButton from '../../_components/clear-alert-button';
import NextAgentCards, { type Recommendation } from '../../_components/next-agent-cards';
import RunFeedback, { type FeedbackQuestion } from '../../_components/run-feedback';

export const dynamic = 'force-dynamic';

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
          <BackLink fallback="/inbox" label="Results" className="text-xs text-ink-500 hover:text-ink-200 inline-flex items-center gap-1.5" />
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
                <Link href="/inbox" className="text-brand-500 hover:underline">results</Link>.</p>
            </div>
          )}
        </div>
      </main>
    );
  }

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
    .select('claude_task_id, status')
    .limit(1);
  const { data: schedRows } = r.scheduled_skill_id
    ? await schedQuery.eq('id', r.scheduled_skill_id)
    : await schedQuery.eq('skill_slug', r.skill_slug);
  const claudeTaskId = schedRows?.[0]?.claude_task_id || null;
  const routinePaused = schedRows?.[0]?.status === 'paused';

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
        <BackLink fallback="/inbox" label="Results" className="text-xs text-ink-500 hover:text-ink-200 inline-flex items-center gap-1.5" />

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

        {pending && (
          <div className="mb-4 rounded-lg border border-brand-500/40 bg-brand-500/10 p-4">
            <div className="text-sm font-semibold text-ink-50">This deliverable is held for your approval</div>
            <div className="text-xs text-ink-300 mt-0.5">
              Read it below, then <span className="text-ink-100 font-medium">Approve &amp; finish</span> to ship the staged option hands-off — or use <span className="text-ink-100 font-medium">Continue this run</span> to add changes or the inputs it still needs. Nothing posts without you.
            </div>
          </div>
        )}

        {needsInput && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <div className="text-sm font-semibold text-ink-50">This run needs your input to continue</div>
            <div className="text-xs text-ink-300 mt-0.5">
              It paused with a question and can&apos;t finish on its own — read it below, then use <span className="text-ink-100 font-medium">Continue this run</span> to answer or add the missing inputs. There&apos;s nothing finished to ship yet, so there&apos;s no approve step.
            </div>
          </div>
        )}

        {/* Continue this run — the universal per-run action. Held runs keep
            "Approve & finish" prominent (RunClaudeActions); the general prompt-+-files
            box sits right under it. Available on ANY run (held, needs-inputs, finished)
            so the user can iterate without opening Claude. The small "continue in
            Claude ↗" stays as the watch-it opt-in. */}
        <div className="mb-6 space-y-3">
          {/* Approve & finish ONLY for an approve-ready hold (a shippable deliverable).
              A needs-input hold has nothing to ship — approving would finish the wrong
              thing — so it gets Continue only. */}
          {pending && (
            <RunClaudeActions runId={r.id} agentName={name} claudeTaskId={claudeTaskId} pending={pending} />
          )}
          <RunContinueBox runId={r.id} agentName={name} pending={held} />
        </div>

        {/* Deliberate, labeled clear (replaces the one-click ✕ on the Alerts card).
            Shown only while this run is actually an alert (held / stalled / failed). */}
        {(held || info.attention || info.state === 'failed') && (
          <div className="mb-6">
            <ClearAlertButton runId={r.id} pending={pending} />
          </div>
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
          <div className="prose prose-sm max-w-none rounded-lg border border-ink-800 bg-ink-950/60 p-5">
            <RunMarkdown markdown={r.output_markdown} workspaceRoot={workspaceRoot} />
          </div>
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
              <Link href={agentHref} className="btn-success text-sm px-4 py-2">Open agent &amp; run again</Link>
              <Link href="/inbox" className="btn-outline text-sm px-4 py-2">Back to results</Link>
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
            />
          </div>
        )}

        {/* Next agents to build — the run's own recommendations, right under its
            output (recommendation engine v1). Renders nothing when there are none. */}
        <NextAgentCards runId={r.id} recommendations={recommendations} />
      </div>
    </main>
  );
}
