'use client';

/**
 * <OutcomeNodeSection /> — ONE agent of a Production, expandable.
 *
 * This is the component the Production page exists for. Before it, the page
 * showed only a child's state word, so understanding what an agent actually
 * did meant navigating out to a run permalink — and on a rerouted node that
 * permalink could be a queued execution shell that read "stalled" while the
 * failover run had quietly finished and validated its output.
 *
 * So everything a reader needs to trust the node renders HERE, from the parent's
 * own read model: which agent and version, which engine ACTUALLY executed it
 * (never the pin), status, timings, credits, its own steps, its own trace, and
 * its own validated outputs. The link out is labelled as a diagnostic, because
 * it is no longer where the answer lives.
 *
 * Steps and trace are collapsed by default and render through the SAME
 * components as the run page (<RunStepsList>, <RunStepTrace>) — compact
 * variants of one implementation, not a second one.
 */

import { useState } from 'react';
import Link from 'next/link';
import RunStepsList from './run-steps-list';
import RunStepTrace from './run-step-trace';
import { EngineTruthBadge } from './engine-truth-badge';
import { RunVerificationBadge, type VerificationStatus } from './run-verification-badge';
import VerifiedArtifacts, { type VerifiedArtifact } from './verified-artifacts';
import { NODE_STATE_LABELS, nodeNeedsAttention, type ProductionNode } from '@/lib/outcome-production-detail';

function stateTone(state: string): string {
  if (state === 'succeeded') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
  if (state === 'running' || state === 'dispatched' || state === 'completing') return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30';
  if (state === 'failed' || state === 'stalled' || state === 'partial') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
  return 'bg-ink-800 text-ink-300 border-ink-700';
}

function clock(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : null;
}

function duration(ms: number | null): string | null {
  if (ms === null || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default function OutcomeNodeSection({ node }: { node: ProductionNode }) {
  const { execution } = node;
  // A live or failed node earns the reader's attention on arrival; a quietly
  // completed one does not, or a two-agent production opens as a wall of steps.
  const [open, setOpen] = useState(nodeNeedsAttention(node));
  const label = NODE_STATE_LABELS[execution.state] || execution.state;

  // Only VALIDATED artifacts reach here, and only ones the backend resolved to
  // an absolute path, which is exactly what the Open/Reveal bridge acts on. A
  // file without one is listed by name and never as a local path.
  const openable: VerifiedArtifact[] = execution.artifacts
    .filter((artifact) => artifact.relativePath && artifact.validatedPath)
    .map((artifact) => ({
      relativePath: artifact.relativePath as string,
      validatedPath: artifact.validatedPath as string,
      role: artifact.role,
      sizeBytes: artifact.sizeBytes,
    }));
  const unopenable = execution.artifacts.filter((artifact) => !artifact.validatedPath);

  return (
    <section
      aria-label={`Agent ${node.ordinal + 1} — ${node.agentName}`}
      className="card p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-ink-500">
            Agent {node.ordinal + 1}{node.role ? ` · ${node.role.replace(/_/g, ' ')}` : ''}
          </p>
          <h3 className="text-base font-semibold text-ink-50 mt-0.5">{node.agentName}</h3>
          <p className="text-xs text-ink-500 mt-0.5">
            version {node.versionNumber}
            {node.taskLabel ? ` · ${node.taskLabel}` : ''}
          </p>
        </div>
        <span className={`flex-none inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${stateTone(execution.state)}`}>
          {label}
        </span>
      </div>

      {/* Engine truth sits directly under the identity: it is the field a
          reader has to check before believing anything else on this card. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <EngineTruthBadge
          requestedEngine={execution.requestedEngine}
          selectedExecutor={execution.selectedExecutor}
          actualEngine={execution.actualEngine}
          failover={execution.failover}
          failoverReason={execution.failoverReason}
        />
        <RunVerificationBadge status={execution.verificationStatus as VerificationStatus} />
      </div>

      <dl className="mt-4 grid sm:grid-cols-3 gap-x-4 gap-y-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-500">Started</dt>
          <dd className="text-xs text-ink-200 mt-0.5">{clock(execution.startedAt) || 'Not dispatched'}</dd>
        </div>
        <div>
          {/* A RELEASED node never ran, so its settled_at is the moment the
              parent released it — calling that "Completed" would imply work
              happened. */}
          <dt className="text-[11px] uppercase tracking-wide text-ink-500">
            {execution.grantState === 'released' ? 'Released' : 'Completed'}
          </dt>
          <dd className="text-xs text-ink-200 mt-0.5">
            {clock(execution.completedAt) || '—'}
            {execution.grantState !== 'released' && duration(execution.durationMs) && (
              <span className="block text-ink-500">ran {duration(execution.durationMs)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-500">Credits</dt>
          <dd className="text-xs text-ink-200 mt-0.5">
            {execution.creditsSpent === null
              ? 'Not settled'
              : `${execution.creditsSpent.toLocaleString()} spent`}
            {execution.budgetCredits !== null && (
              <span className="block text-ink-500">of {execution.budgetCredits.toLocaleString()} allocated</span>
            )}
          </dd>
        </div>
      </dl>

      {execution.failureReason && (
        <p role="status" className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          {execution.failureReason}
        </p>
      )}

      {/* Steps: summary always, the list on demand. A 40-step render must not
          push the second agent below the fold on arrival. */}
      {execution.stepSummary && (
        <details className="mt-4 group" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer select-none text-xs text-ink-300 hover:text-ink-100">
            Steps — {execution.stepSummary.done}/{execution.stepSummary.total}
          </summary>
          <div className="mt-2.5 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
            <RunStepsList steps={execution.steps} compact heading={null} />
          </div>
        </details>
      )}

      {execution.trace.length > 0 && (
        <details className="mt-2.5">
          <summary className="cursor-pointer select-none text-xs text-ink-300 hover:text-ink-100">
            Step trace — {execution.trace.length} {execution.trace.length === 1 ? 'note' : 'notes'}
          </summary>
          <div className="mt-2.5 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
            <RunStepTrace
              entries={execution.trace}
              compact
              heading={null}
              live={execution.state === 'running'}
              stalled={execution.state === 'stalled'}
            />
          </div>
        </details>
      )}

      {execution.truncated.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-500">
          This agent reported more {execution.truncated.join(' and ')} than shown here — open the run for the full record.
        </p>
      )}

      {openable.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wide text-ink-500 mb-2">Validated outputs</p>
          <VerifiedArtifacts artifacts={openable} />
        </div>
      )}
      {unopenable.length > 0 && (
        <ul className="mt-3 space-y-1">
          {unopenable.map((artifact) => (
            <li key={artifact.id || artifact.digest || artifact.name} className="text-xs text-ink-400">
              {artifact.name || 'Validated output'}
              {artifact.digest && <span className="text-ink-600 font-mono ml-2">{artifact.digest.slice(0, 12)}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* The run page is now a DIAGNOSTIC, not the answer. Saying so stops a
          reader treating a queued shell there as this node's real outcome. */}
      {execution.runId && (
        <Link
          href={`/runs/${execution.runId}`}
          className="mt-4 inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-200 hover:underline"
        >
          Open this agent&apos;s run for diagnostics <span aria-hidden="true">→</span>
        </Link>
      )}
    </section>
  );
}
