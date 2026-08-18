/**
 * <OutcomeHandoffRow /> — what one agent handed to the next, and whether it
 * actually arrived.
 *
 * A sequential production's most confusing moment is the seam: agent 1 finished,
 * agent 2 started, and nothing on the page said what moved between them or
 * whether it was checked. This row is that missing sentence, and it is rendered
 * BETWEEN the two agent sections so the direction of the handoff is spatial and
 * not something the reader has to reconstruct from ordinals.
 *
 * Producer and consumer come from the backend's handoff row, never from
 * adjacency, and the artifact identity comes with them — which is what stops a
 * filename or digest being attributed to the agent that received it rather than
 * the one that made it.
 */

import type { ProductionHandoff } from '@/lib/outcome-production-detail';

const STATE_TONE: Record<ProductionHandoff['state'], string> = {
  accepted: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  validated: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  pending: 'border-ink-800 bg-ink-950/40',
  blocked: 'border-amber-500/40 bg-amber-500/[0.06]',
  failed: 'border-amber-500/40 bg-amber-500/[0.06]',
};

function clock(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : null;
}

export default function OutcomeHandoffRow({ handoff }: { handoff: ProductionHandoff }) {
  const producer = `Agent ${handoff.producerOrdinal + 1}`;
  const consumer = `Agent ${handoff.consumerOrdinal + 1}`;
  const validated = handoff.validationStatus === 'validated';

  return (
    <section
      aria-label={`Handoff from agent ${handoff.producerOrdinal + 1} to agent ${handoff.consumerOrdinal + 1}`}
      className={`rounded-lg border px-4 py-3 ${STATE_TONE[handoff.state]}`}
    >
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <li className="text-ink-200">
          {producer}{handoff.producerAgentName ? ` — ${handoff.producerAgentName}` : ''}
          {' '}
          <span className="text-ink-400">
            {handoff.state === 'pending' ? 'still running' : handoff.state === 'blocked' ? 'did not succeed' : 'completed'}
          </span>
        </li>

        <li aria-hidden="true" className="text-ink-600">→</li>
        <li className="text-ink-200">
          {handoff.artifactName || (handoff.artifactKind ? handoff.artifactKind.replace(/_/g, ' ') : 'output')}
          {handoff.digestPrefix && (
            <span className="font-mono text-ink-500 ml-1.5">{handoff.digestPrefix}</span>
          )}
        </li>

        <li aria-hidden="true" className="text-ink-600">→</li>
        <li className={validated ? 'text-emerald-700 dark:text-emerald-300' : 'text-ink-400'}>
          {validated ? 'digest verified' : handoff.validationStatus === 'not_reached' ? 'never produced' : 'not validated'}
        </li>

        <li aria-hidden="true" className="text-ink-600">→</li>
        <li className="text-ink-200">
          {handoff.state === 'accepted'
            ? `handed to ${consumer}${handoff.consumerAgentName ? ` — ${handoff.consumerAgentName}` : ''}`
            : handoff.state === 'validated'
              ? `waiting for ${consumer}`
              : `${consumer} ${handoff.state === 'pending' ? 'not dispatched yet' : 'released'}`}
        </li>

        {handoff.state === 'accepted' && (
          <>
            <li aria-hidden="true" className="text-ink-600">→</li>
            <li className="text-ink-400">
              {consumer} dispatched{clock(handoff.dispatchedAt) ? ` ${clock(handoff.dispatchedAt)}` : ''}
            </li>
          </>
        )}
      </ol>

      {/* The typed reason a handoff did not happen. Rendered verbatim — the
          parent already decided what went wrong and why. */}
      {handoff.failureReason && (
        <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          {handoff.failureReason}
        </p>
      )}
      {validated && handoff.validatedAt && (
        <p className="mt-1.5 text-[11px] text-ink-500">Validated {clock(handoff.validatedAt)}</p>
      )}
    </section>
  );
}
