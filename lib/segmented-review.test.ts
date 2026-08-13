import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReviewArtifact, ReviewProduction } from './review.ts';
import {
  finalRenderControl,
  preferredReviewArtifact,
  previewRequestIdentity,
  reviewableArtifacts,
  segmentForArtifact,
  segmentPlaybackClock,
} from './segmented-review.ts';

const proxy: ReviewArtifact = {
  id: 'proxy-1', runId: 'worker-run-1', relativePath: '.implexa/segments/segment-01.mp4',
  role: 'review_proxy', status: 'validated', sha256: 'a'.repeat(64), sizeBytes: 100,
  mtime: null, validatedAt: null,
};

const production: NonNullable<ReviewProduction> = {
  id: 'production-1', qualityMode: 'professional', planDigest: 'b'.repeat(64), fps: 30, totalFrames: 25566,
  finalRender: { ready: false, reasons: ['segment-02 is unresolved'] },
  segments: [
    {
      id: 'segment-01', label: 'Opening', ordinal: 0, state: 'preview_ready',
      writableRange: { startFrame: 0, endFrameExclusive: 3600 },
      previewRange: { startFrame: 0, endFrameExclusive: 3660 }, writableOffsetFrames: 0, artifact: proxy,
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `segment-0${index + 2}`, label: `Segment ${index + 2}`, ordinal: index + 1, state: 'pending' as const,
      writableRange: { startFrame: 3600 + (index * 4393), endFrameExclusive: 7993 + (index * 4393) },
      previewRange: null, writableOffsetFrames: null, artifact: null,
    })),
  ],
};

test('the segment proxy is preferred and previewed through its worker run identity', () => {
  const parent: ReviewArtifact = { ...proxy, id: 'final', runId: 'parent-run', role: 'final_output' };
  const selected = preferredReviewArtifact([parent], production);
  assert.equal(selected?.id, 'proxy-1');
  assert.deepEqual(previewRequestIdentity(selected!), { runId: 'worker-run-1', artifactId: 'proxy-1' });
  assert.equal(segmentForArtifact(production, selected!.id)?.id, 'segment-01');
});

test('supporting attachments accompany submission context but never become review or reference targets', () => {
  const target: ReviewArtifact = { ...proxy, id: 'local-target', role: 'review_input' };
  const support: ReviewArtifact = { ...proxy, id: 'support-zip', role: 'review_attachment' };
  assert.deepEqual(
    reviewableArtifacts([target, support], null).map((artifact) => artifact.id),
    ['local-target'],
  );
});

test('preview time exposes the writable offset and maps to global and segment-relative time', () => {
  const segment = { ...production.segments[0], writableRange: { startFrame: 3600, endFrameExclusive: 7200 }, previewRange: { startFrame: 3540, endFrameExclusive: 7260 }, writableOffsetFrames: 60 };
  assert.deepEqual(segmentPlaybackClock(production, segment, 3000), {
    globalMs: 121000,
    segmentMs: 1000,
    writableOffsetMs: 2000,
  });
});

test('five unresolved segments keep final render refused', () => {
  assert.deepEqual(finalRenderControl(production), { enabled: false, reason: 'segment-02 is unresolved' });
});
