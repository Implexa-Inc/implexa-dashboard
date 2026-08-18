/**
 * /runs/productions/[id] — THE canonical view of a multi-agent job.
 *
 * This page used to show only the parent plus a state word per child, so the
 * only way to learn what an agent actually did was to leave for a run
 * permalink. On a rerouted node that permalink could be a queued execution
 * SHELL reading "stalled" while the failover run had finished and validated its
 * output — the production succeeded and the UI said otherwise.
 *
 * So the parent is now where the whole account lives: header, one expandable
 * section per selected agent (its real engine, its own steps, its own trace,
 * its own validated outputs), the typed handoff between them, and one
 * chronological production trace. The run pages remain, as diagnostics.
 *
 * ONE bounded server read (`/detail`) feeds all of it — no client waterfall,
 * no query per trace row. Fail-closed: an unreadable or drifted answer renders
 * "we can't show this production" (role="status"), never an empty monitor that
 * could read as "nothing is running".
 */

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadOutcomeProductionDetail } from '@/lib/outcome-production-load';
import OutcomeProductionMonitor from '../../../_components/outcome-production-monitor';
import OutcomeNodeSection from '../../../_components/outcome-node-section';
import OutcomeHandoffRow from '../../../_components/outcome-handoff-row';
import OutcomeProductionTrace from '../../../_components/outcome-production-trace';
import OutcomeWorkItem from '../../../_components/outcome-work-item';

export const dynamic = 'force-dynamic';

export default async function OutcomeProductionPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const load = await loadOutcomeProductionDetail(params.id, session.access_token);
  if (load.status === 'not_found') notFound();

  return (
    <main className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link href="/work" className="text-xs text-ink-400 hover:text-ink-200 hover:underline">← Work</Link>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50 mt-2">Production</h1>
        </div>

        {load.status === 'unavailable' ? (
          <div role="status" aria-label="Production unavailable" className="card p-6 border-amber-500/40">
            <p className="text-sm text-amber-300">
              We can’t show this production right now — this is not the same as it having stopped or finished.
            </p>
            <p className="text-xs text-ink-500 mt-2">{load.reason}</p>
          </div>
        ) : load.status === 'absent' ? (
          // The monitor read fine; this deployment's backend simply has no
          // detail route yet. The parent still answers "is my money moving",
          // and the page says which part is missing rather than implying the
          // agents did nothing.
          <div className="space-y-6">
            <OutcomeProductionMonitor production={load.production} />
            <div role="status" aria-label="Agent detail unavailable" className="card p-5 border-ink-800">
              <p className="text-sm text-ink-300">
                This deployment can’t yet show the per-agent breakdown for a production. The steps, handoffs and
                trace are unread — this is not a claim that none exist.
              </p>
            </div>
            {load.receipt && <OutcomeWorkItem receipt={load.receipt} />}
          </div>
        ) : (
          <div className="space-y-6">
            <OutcomeProductionMonitor
              production={load.detail}
              finalDeliverable={load.detail.finalDeliverable}
              /* The per-agent sections below ARE the child activity; a second,
                 vaguer list of the same children is what sent readers hunting
                 through run pages in the first place. */
              showChildActivity={false}
            />

            {/* Agents in ordinal order, with the handoff INTO each one rendered
                immediately above it, so the direction of the handoff is spatial
                rather than something to reconstruct from ordinals. */}
            {load.detail.nodes.map((node) => (
              <div key={node.ordinal} className="space-y-3">
                {load.detail.handoffs
                  .filter((handoff) => handoff.consumerOrdinal === node.ordinal)
                  .map((handoff) => (
                    <OutcomeHandoffRow
                      key={`${handoff.producerOrdinal}->${handoff.consumerOrdinal}`}
                      handoff={handoff}
                    />
                  ))}
                <OutcomeNodeSection node={node} />
              </div>
            ))}

            {/* A production with a plan but no dispatched agents yet. Saying so
                beats a silent gap between the header and the trace. */}
            {load.detail.nodes.length === 0 && (
              <div role="status" aria-label="No agents dispatched" className="card p-5">
                <p className="text-sm text-ink-300">
                  No agent has been dispatched for this production yet.
                </p>
              </div>
            )}

            <OutcomeProductionTrace trace={load.detail.trace} truncated={load.detail.traceTruncated} />

            {load.receipt && <OutcomeWorkItem receipt={load.receipt} />}

            {/* A settled production whose receipt we could not show. The
                production above is real and already says what happened; what
                is missing is the accounting, and saying so beats both hiding
                the page and implying there was nothing to account for.

                It deliberately does NOT say the receipt is on its way: a 404
                here means both "not written yet" and "this backend has no
                receipt route", and we cannot tell which. */}
            {load.receiptStatus === 'unavailable' && (
              <div role="status" aria-label="Receipt unavailable" className="card p-5 border-amber-500/40">
                <p className="text-sm text-amber-300">
                  This production has settled, but we couldn’t read its receipt. Its costs and artifacts are unread — this is not a claim that none exist.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
