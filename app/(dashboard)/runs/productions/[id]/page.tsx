/**
 * /runs/productions/[id] — the monitor for one outcome production.
 *
 * Lives under Work's /runs prefix (lib/navigation.ts) so it needs no new
 * primary navigation item. The page shows the PARENT first — one accountable
 * production — with child activity expandable beneath it, and once the parent
 * settles, the one Work item with artifacts, provenance, review state, and
 * the plan receipt.
 *
 * Fail-closed: an unreadable or drifted backend answer renders "we can't show
 * this production" (role="status"), never an empty monitor that could read as
 * "nothing is running".
 */

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadOutcomeProduction } from '@/lib/outcome-production-load';
import OutcomeProductionMonitor from '../../../_components/outcome-production-monitor';
import OutcomeWorkItem from '../../../_components/outcome-work-item';

export const dynamic = 'force-dynamic';

export default async function OutcomeProductionPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const load = await loadOutcomeProduction(params.id, session.access_token);
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
        ) : (
          <div className="space-y-6">
            <OutcomeProductionMonitor production={load.production} />
            {load.receipt && <OutcomeWorkItem receipt={load.receipt} />}
          </div>
        )}
      </div>
    </main>
  );
}
