/**
 * <FirstRunMagic />: the first-signup example shelf.
 *
 * A brand-new user (no agents, no runs) leads with the same "Build your first
 * agent" hero as everyone else (rendered by the page above this). Beneath it we
 * offer a calm shelf of proven example agents as inspiration: pick one to open
 * its detail and run or schedule it. No terminal-paste "connect / paste command"
 * framing; connecting + handing off is the hero's job now. Server component;
 * the cards match the neutral "Your agents" styling so first-run does not look
 * like a different product.
 */

import Link from 'next/link';
import type { WorkflowCard } from '@/lib/workflow-catalog';

function popularScore(w: WorkflowCard) {
  return (w.scheduled_count ?? 0) * 3 + (w.run_count ?? 0);
}
function proofLine(w: WorkflowCard): string | null {
  if ((w.scheduled_count ?? 0) > 0) return `${w.scheduled_count} on autopilot`;
  if ((w.run_count ?? 0) > 0) return `run ${w.run_count}×`;
  return null;
}

function ExampleCard({ w }: { w: WorkflowCard }) {
  const proof = proofLine(w);
  return (
    <Link href={`/workflows/${w.slug}`} className="card p-5 hover:border-ink-600 transition-colors block">
      <div className="text-sm font-medium text-ink-50 truncate">{w.name}</div>
      <div className="text-xs text-ink-400 mt-1.5 line-clamp-2">{w.primary_outcome || w.description}</div>
      <div className="text-[11px] text-ink-500 mt-3 flex items-center gap-2">
        <span className="capitalize">{w.cadence || `${w.step_count} step${w.step_count === 1 ? '' : 's'}`}</span>
        {proof && (
          <>
            <span aria-hidden>·</span>
            <span>{proof}</span>
          </>
        )}
      </div>
    </Link>
  );
}

export default function FirstRunMagic({ workflows }: { workflows: WorkflowCard[] }) {
  // Featured shelf: curated + most popular first, top 6.
  const featured = [...workflows]
    .sort((a, b) => (b.curated ? 1 : 0) - (a.curated ? 1 : 0) || popularScore(b) - popularScore(a))
    .slice(0, 6);

  if (featured.length === 0) return null;

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">Or start from an example</h2>
        <Link href="/workflows" className="text-xs text-ink-400 hover:text-ink-200">all agents</Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {featured.map((w) => (
          <ExampleCard key={`${w.source}-${w.slug}`} w={w} />
        ))}
      </div>
    </section>
  );
}
