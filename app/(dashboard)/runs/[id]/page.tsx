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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import { desktopAppLive, appRunUrl } from '@/lib/app-links';
import { listWorkflows } from '@/lib/workflow-catalog';
import { deriveRunState, type RunRow } from '@/lib/run-state';
import { RunStateBadge } from '../../_components/run-state-badge';
import BackLink from '../../_components/back-link';
import OpenInAppPrompt from '../../_components/open-in-app-prompt';
import RunClaudeActions from '../../_components/run-claude-actions';

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
  const pending = r.review_status === 'pending';
  const info = deriveRunState(r);
  const agentHref = wf
    ? `/workflows/${encodeURIComponent(r.skill_slug)}?source=${encodeURIComponent(wf.source)}`
    : `/workflows/${encodeURIComponent(r.skill_slug)}`;

  // The routine's Claude task id (when this agent has a live schedule) powers the
  // "Open the routine in Claude" deep link + the "Continue in Claude" handoff that
  // lets the user actually resume a run paused at a human-approval gate.
  const { data: schedRows } = await supabase
    .from('scheduled_skills')
    .select('claude_task_id')
    .eq('skill_slug', r.skill_slug)
    .limit(1);
  const claudeTaskId = schedRows?.[0]?.claude_task_id || null;

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <BackLink fallback="/inbox" label="Results" className="text-xs text-ink-500 hover:text-ink-200 inline-flex items-center gap-1.5" />

        {/* web→app handoff: the https email link lands here; offer the bounce into
            the desktop app. Dormant until the app ships (desktopAppLive). */}
        {desktopAppLive() && (
          <div className="mt-4">
            <OpenInAppPrompt runId={r.id} />
          </div>
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
              <a href={appRunUrl(r.id)} className="text-xs text-brand-500 hover:underline">
                open in the Implexa app ↗
              </a>
            )}
          </div>
        </header>

        {/* Get back to Claude: continue a run paused at an approval gate, or open
            the routine that produced it. */}
        <div className="mb-6">
          <RunClaudeActions runId={r.id} agentName={name} claudeTaskId={claudeTaskId} pending={pending} />
        </div>

        {pending && (
          <Link
            href={`/inbox?run=${r.id}`}
            className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-brand-500/40 bg-brand-500/10 p-4 hover:bg-brand-500/15 transition-colors"
          >
            <div>
              <div className="text-sm font-semibold text-ink-50">This deliverable is waiting for your review</div>
              <div className="text-xs text-ink-300 mt-0.5">Approve what it produced, or dismiss it. Nothing posts without you.</div>
            </div>
            <span className="text-sm text-brand-500 font-medium whitespace-nowrap">Review →</span>
          </Link>
        )}

        {r.output_markdown ? (
          <div className="prose prose-sm max-w-none rounded-lg border border-ink-800 bg-ink-950/60 p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {r.output_markdown}
            </ReactMarkdown>
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
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={agentHref} className="btn-success text-sm px-4 py-2">Open agent &amp; run again</Link>
              <Link href="/inbox" className="btn-outline text-sm px-4 py-2">Back to results</Link>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-400 italic">No deliverable recorded for this run.</p>
        )}
      </div>
    </main>
  );
}
