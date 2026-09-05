import type { HistoricalReviewCandidate } from '@/lib/historical-review-candidate';

export default function HistoricalReviewCandidateNotice({ candidate, unavailable, carriedIssueCount = 0 }: {
  candidate: HistoricalReviewCandidate | null; unavailable: boolean; carriedIssueCount?: number;
}) {
  if (unavailable) return <p role="status" className="mb-4 rounded border border-amber-800 p-3 text-sm text-amber-200">Historical candidate provenance is unavailable. Completion has not been established.</p>;
  if (!candidate) return null;
  return <section aria-label="Historical partial candidate" className="mb-4 rounded border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-100">
    <h2 className="font-medium">Historical partial candidate</h2>
    <p>{candidate.implementedCount} correction{candidate.implementedCount === 1 ? '' : 's'} reported implemented; {candidate.deferredCount} deferred.</p>
    <p className="mt-1 text-xs">Technical QA passed. This does not establish that all corrections were completed, a Judge verdict, or Manager proof. The original attempt is unchanged.</p>
    <p className="mt-1 text-xs">{carriedIssueCount > 0
      ? `${carriedIssueCount} exact same-video change${carriedIssueCount === 1 ? '' : 's'} from the failed revision are carried in this draft. Unrelated older anchors were not transferred.`
      : 'Previous feedback anchors were not transferred. Add feedback against this video in a separate draft; opening it does not start a revision.'}</p>
  </section>;
}
