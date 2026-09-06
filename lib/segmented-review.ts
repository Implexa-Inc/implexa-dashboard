import type { ReviewArtifact, ReviewProduction, ReviewProductionSegment } from './review.ts';

export function reviewableArtifacts(
  parentArtifacts: ReviewArtifact[],
  production: ReviewProduction,
  supportingArtifactIds: ReadonlySet<string> = new Set(),
  historicalCandidateArtifactIds: ReadonlySet<string> = new Set(),
  historicalSelectionRestricted = historicalCandidateArtifactIds.size > 0,
): ReviewArtifact[] {
  const proxies = production?.segments
    .map((segment) => segment.artifact)
    .filter((artifact): artifact is ReviewArtifact => artifact !== null) ?? [];
  // Supporting attachments travel with the immutable submission as executor context,
  // but they are not review targets.  Keeping them out of this shared selector also
  // keeps them out of the reference-target picker used by Review Room.
  return [...proxies, ...parentArtifacts].filter((artifact) => {
    if (artifact.role === 'review_attachment' || supportingArtifactIds.has(artifact.id)) return false;
    if (!historicalSelectionRestricted) return true;
    return historicalCandidateArtifactIds.has(artifact.id)
      || ['review_proxy', 'final_output', 'review_input', 'output'].includes(String(artifact.role));
  });
}

export function preferredReviewArtifact(
  parentArtifacts: ReviewArtifact[],
  production: ReviewProduction,
  supportingArtifactIds: ReadonlySet<string> = new Set(),
  historicalCandidateArtifactIds: ReadonlySet<string> = new Set(),
  historicalSelectionRestricted = historicalCandidateArtifactIds.size > 0,
): ReviewArtifact | null {
  const all = reviewableArtifacts(
    parentArtifacts, production, supportingArtifactIds, historicalCandidateArtifactIds, historicalSelectionRestricted,
  )
    .filter((artifact) => artifact.status === 'validated');
  return (historicalCandidateArtifactIds.size > 0
    ? all.find((artifact) => historicalCandidateArtifactIds.has(artifact.id))
    : null)
    ?? all.find((artifact) => artifact.role === 'review_proxy')
    ?? all.find((artifact) => artifact.role === 'final_output')
    ?? all[0]
    ?? null;
}

export function segmentForArtifact(
  production: ReviewProduction,
  artifactId: string | null,
): ReviewProductionSegment | null {
  if (!production || !artifactId) return null;
  return production.segments.find((segment) => segment.artifact?.id === artifactId) ?? null;
}

export function previewRequestIdentity(artifact: ReviewArtifact): { runId: string; artifactId: string } {
  return { runId: artifact.runId, artifactId: artifact.id };
}

export function segmentPlaybackClock(
  production: NonNullable<ReviewProduction>,
  segment: ReviewProductionSegment,
  previewMs: number,
): { globalMs: number; segmentMs: number; writableOffsetMs: number } | null {
  if (!segment.previewRange || segment.writableOffsetFrames === null) return null;
  const frameMs = 1000 / production.fps;
  const globalMs = Math.round((segment.previewRange.startFrame * frameMs) + previewMs);
  return {
    globalMs,
    segmentMs: Math.round(globalMs - (segment.writableRange.startFrame * frameMs)),
    writableOffsetMs: Math.round(segment.writableOffsetFrames * frameMs),
  };
}

export function finalRenderControl(production: ReviewProduction): { enabled: boolean; reason: string | null } {
  if (!production) return { enabled: false, reason: null };
  return {
    enabled: production.finalRender.ready,
    reason: production.finalRender.ready ? null : (production.finalRender.reasons[0] ?? 'Segments remain unresolved.'),
  };
}
