import type { TasteFitReview } from '@/lib/review';

export default function TasteFitReviewCard({ review }: { review?: TasteFitReview }) {
  if (!review) return null;
  const f = review.assessment;
  return <section aria-label="Taste fit" className="mb-6 rounded-lg border border-ink-800 bg-ink-950/40 p-4 space-y-2">
    <h2 className="text-sm font-semibold text-ink-100">Taste fit: {f?.status === 'assessed' ? f.fit : 'unavailable'}</h2>
    <p className="text-xs text-ink-400">An independent comparison with this stage’s selected training examples. Separate from technical checks and the general quality grade.</p>
    <p className="text-sm text-ink-200">{f?.explanation ?? 'The selected output’s taste assessment could not be verified.'}</p>
    {f?.status === 'unavailable' && <p className="text-xs text-amber-300">Not assessed: {f.reason?.replaceAll('_', ' ')}</p>}
    {!!f?.gaps.length && <ul className="list-disc pl-5 text-sm text-ink-300 space-y-1">{f.gaps.map((g, i) =>
      <li key={i}>{(g.timestampMs / 1000).toFixed(1)}s — {g.observation} {g.suggestion}</li>)}</ul>}
    {review.selection && <p className="text-xs text-ink-300">Selection: {review.selection.reason === 'pairwise_preferred_revision'
      ? 'The revised video was preferred in both comparison orders within the same grade band.'
      : review.selection.reason === 'pairwise_preferred_original' ? 'The original video was preferred in both comparison orders within the same grade band.'
      : review.selection.reason.replaceAll('_', ' ')} This is an uncalibrated model preference, not a higher letter grade.</p>}
    <p className="text-xs text-ink-500">This comparison does not establish that training caused the result.</p>
  </section>;
}
