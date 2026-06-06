/**
 * <FirstRunMagic /> — the dashboard's first-signup magic moment.
 *
 * A brand-new user (no routines, no runs) would otherwise land on an empty
 * mission control. Instead we show THE OFFER: a shelf of ready-to-run workflows
 * (prompt -> outcome, with proof), plus the one path to their first run — connect
 * Claude, pick a workflow, paste the command. Server component; the copy button
 * is the client <CopyRunCommand/> bridge into Claude Code / Codex.
 */

import Link from 'next/link';
import type { WorkflowCard } from '@/lib/workflow-catalog';
import CopyRunCommand from './copy-run-command';

function popularScore(w: WorkflowCard) {
  return (w.scheduled_count ?? 0) * 3 + (w.run_count ?? 0);
}
function proofLine(w: WorkflowCard): string | null {
  if ((w.scheduled_count ?? 0) > 0) return `${w.scheduled_count} on autopilot`;
  if ((w.run_count ?? 0) > 0) return `run ${w.run_count}×`;
  return null;
}

function OfferCard({ w }: { w: WorkflowCard }) {
  const proof = proofLine(w);
  return (
    <div className="card flex flex-col gap-3 p-4 h-full">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/workflows/${w.slug}`} className="text-sm font-semibold text-ink-50 hover:underline leading-snug">
          {w.name}
        </Link>
        {w.cadence ? (
          <span className="flex-none text-[10px] uppercase tracking-wider text-amber-300/90 border border-amber-400/30 rounded px-1.5 py-0.5">
            {w.cadence}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-ink-300 line-clamp-3 flex-1">
        {w.primary_outcome || w.description}
      </p>
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-[11px] text-ink-500">
          {proof ? <span className="text-amber-300/90">{proof}</span> : `${w.step_count} steps`}
        </span>
        <CopyRunCommand slug={w.slug} kind="workflow" />
      </div>
    </div>
  );
}

export default function FirstRunMagic({
  workflows,
  connected,
  firstName,
}: {
  workflows: WorkflowCard[];
  connected: boolean;
  firstName: string;
}) {
  // Featured shelf: most popular + curated first, top 6.
  const featured = [...workflows]
    .sort((a, b) => (b.curated ? 1 : 0) - (a.curated ? 1 : 0) || popularScore(b) - popularScore(a))
    .slice(0, 6);

  return (
    <section className="mb-10">
      <div className="rounded-2xl border border-ink-700 bg-gradient-to-b from-brand-500/10 to-transparent p-6 sm:p-8">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink-50">
          {firstName ? `Welcome, ${firstName}.` : 'Welcome to implexa.'} Pick what AI runs for you.
        </h2>
        <p className="text-ink-300 text-sm mt-2 max-w-2xl">
          Each of these is a whole job, run end to end on your own Claude or Codex, on a schedule, delivered to your inbox. Pick one to get your first one running.
        </p>

        {/* Step 1: connect (only if not yet connected) */}
        {!connected && (
          <Link
            href="/install"
            className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-brand-500/40 bg-brand-500/10 p-4 hover:bg-brand-500/15 transition-colors"
          >
            <div>
              <div className="text-sm font-semibold text-ink-50">Step 1 · Connect Claude Code or Codex</div>
              <div className="text-xs text-ink-300 mt-0.5">One line in your terminal. Then paste any workflow below to run it.</div>
            </div>
            <span className="text-sm text-brand-500 font-medium whitespace-nowrap">Connect →</span>
          </Link>
        )}

        {/* Step 2: pick a workflow */}
        <div className="mt-6">
          <div className="text-xs font-medium text-ink-300 uppercase tracking-wider mb-3">
            {connected ? 'Pick a workflow to run' : 'Step 2 · Pick a workflow'}
          </div>
          {featured.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {featured.map((w) => (
                <OfferCard key={`${w.source}-${w.slug}`} w={w} />
              ))}
            </div>
          ) : (
            <div className="card text-sm text-ink-400">
              The workflow catalog is loading.{' '}
              <Link href="/workflows" className="text-brand-500 hover:underline">Browse all workflows</Link>.
            </div>
          )}
          <div className="mt-4 flex items-center gap-4 text-xs">
            <Link href="/workflows" className="text-brand-500 hover:underline">Browse all workflows →</Link>
            <span className="text-ink-500">
              or just tell Claude what you want automated and it builds one.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
