import Link from 'next/link';
import type { ChainOffering } from '@/lib/agent-chain-offerings';

/**
 * Chain offerings on the Agents surface — one catalog, no separate
 * marketplace page. A private-preview buyer sees the offering(s) their
 * organization was explicitly granted; everyone else sees nothing here, and
 * cannot tell the difference between "none exist" and "none are yours to see".
 *
 * Discovery by ordinary language ("make a YouTube video from a presenter
 * recording") is the backend matcher's job at production-prepare time; this
 * section is the browsable face of the same offering, and each card links to
 * the full resume with the ordered chain, evidence, and disclosures.
 */
export default function ChainOfferingsSection({ offerings }: { offerings: ChainOffering[] }) {
  if (!offerings.length) return null;
  return (
    <section className="mt-10" aria-label="Agent chains">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Agent chains</h2>
      <p className="mt-1 text-xs text-ink-500">One outcome, several agents run in order. You choose the result; the chain composes the steps.</p>
      <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {offerings.map((offering) => (
          <li key={offering.slug} className="rounded-lg border border-ink-800 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-ink-100">{offering.name}</p>
              {offering.privatePreview && <span className="rounded border border-violet-500/40 px-2 py-0.5 text-xs text-violet-300">Private preview</span>}
            </div>
            <p className="mt-2 text-xs text-ink-400">
              {offering.orderedChain.map((node, index) => (
                <span key={node.ordinal}>
                  {index > 0 ? ' → ' : ''}
                  {node.name}
                </span>
              ))}
            </p>
            <p className="mt-2 text-xs text-ink-500">
              Requires a {offering.requiredInput.label.toLowerCase()} · delivers a {offering.finalArtifactKind.replace('_', ' ')} ·{' '}
              {offering.consequentialCeiling.zeroDefault ? 'zero provider calls by default' : 'uses your connected providers'} ·
              up to {offering.creditPolicy.maxTotalCredits} credits
            </p>
            <Link href={`/workflows/chains/${encodeURIComponent(offering.slug)}`} className="mt-3 inline-block text-sm text-brand-400 hover:underline">
              View &amp; use this chain
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
